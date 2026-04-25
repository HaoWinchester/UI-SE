// 这个文件负责生成“给客户看”的最终预览页，并启动一个本地静态服务器。
// 这样 orchestrator 在进入最终验收时，拿到的就是一个可直接打开的网址，而不只是文件路径。
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { CustomerPreviewArtifact, WorkflowJob } from "../types/domain.js";

export interface CustomerPreviewManager {
  prepare(job: WorkflowJob): Promise<CustomerPreviewArtifact>;
}

export class StaticCustomerPreviewManager implements CustomerPreviewManager {
  constructor(private readonly baseDir: string) {}

  async prepare(job: WorkflowJob): Promise<CustomerPreviewArtifact> {
    const generatedAt = new Date().toISOString();
    const relativeDir = path.posix.join("artifacts", "customer-preview", job.id);
    const absoluteDir = path.join(this.baseDir, relativeDir);
    await mkdir(absoluteDir, { recursive: true });

    const approvedUiHtmlPath = await this.copyIfPresent(job.uiArtifact?.htmlPath, absoluteDir, "approved-ui.html");
    const approvedUiImagePath = await this.copyIfPresent(job.uiArtifact?.imagePath, absoluteDir, "approved-ui.png");
    const dashboardCopyPath = await this.copyIfPresent(
      job.dashboardArtifact?.htmlPath,
      absoluteDir,
      "workflow-dashboard.html",
    );

    const port = await findAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}/index.html`;
    const htmlPath = path.posix.join(relativeDir, "index.html");
    const html = await buildCustomerPreviewHtml({
      baseDir: this.baseDir,
      job,
      generatedAt,
      serverUrl,
      approvedUiHtmlFile: approvedUiHtmlPath ? path.posix.basename(approvedUiHtmlPath) : undefined,
      approvedUiImageFile: approvedUiImagePath ? path.posix.basename(approvedUiImagePath) : undefined,
      dashboardFile: dashboardCopyPath ? path.posix.basename(dashboardCopyPath) : undefined,
    });

    await writeFile(path.join(this.baseDir, htmlPath), html, "utf8");
    this.startPreviewServer(absoluteDir, port);

    return {
      directoryPath: relativeDir,
      htmlPath,
      serverUrl,
      port,
      generatedAt,
      approvedUiHtmlPath,
      approvedUiImagePath,
    };
  }

  private async copyIfPresent(
    sourceRelativePath: string | undefined,
    targetDir: string,
    fileName: string,
  ): Promise<string | undefined> {
    if (!sourceRelativePath) {
      return undefined;
    }

    const sourceAbsolutePath = path.isAbsolute(sourceRelativePath)
      ? sourceRelativePath
      : path.join(this.baseDir, sourceRelativePath);
    const targetAbsolutePath = path.join(targetDir, fileName);
    try {
      await copyFile(sourceAbsolutePath, targetAbsolutePath);
      return path.posix.join(path.relative(this.baseDir, targetDir).split(path.sep).join(path.posix.sep), fileName);
    } catch {
      return undefined;
    }
  }

  private startPreviewServer(rootDir: string, port: number): void {
    const scriptPath = path.join(this.baseDir, "scripts", "preview-server.mjs");
    const child = spawn(process.execPath, [scriptPath, "--root", rootDir, "--port", String(port)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

async function buildCustomerPreviewHtml(input: {
  baseDir: string;
  job: WorkflowJob;
  generatedAt: string;
  serverUrl: string;
  approvedUiHtmlFile?: string;
  approvedUiImageFile?: string;
  dashboardFile?: string;
}): Promise<string> {
  const previewSections = await Promise.all(
    input.job.requirement.features.map(async (feature) => {
      const frontendFile = feature.generatedFiles.find((file) => file.endsWith("FeatureView.tsx"));
      const backendFile = feature.generatedFiles.find((file) => file.endsWith("route.ts"));
      const frontendSnippet = frontendFile
        ? await readSnippet(input.baseDir, frontendFile, 220)
        : "当前没有前端片段。";
      const backendSnippet = backendFile
        ? await readSnippet(input.baseDir, backendFile, 220)
        : "当前没有后端片段。";
      const databaseRuns = input.job.databaseRuns.filter((run) => run.featureId === feature.id);
      const latestDatabaseRun = databaseRuns.at(-1);

      return `
        <article class="feature-card">
          <div class="feature-head">
            <div>
              <p class="feature-kicker">功能点</p>
              <h3>${escapeHtml(feature.name)}</h3>
            </div>
            <span class="badge ${feature.status === "done" ? "success" : "warning"}">${escapeHtml(feature.status)}</span>
          </div>
          <p class="feature-description">${escapeHtml(feature.description)}</p>
          <div class="meta-row">
            <span>前端 ${escapeHtml(feature.frontendStatus)}</span>
            <span>后端 ${escapeHtml(feature.backendStatus)}</span>
            <span>数据库 ${escapeHtml(feature.databaseStatus)}</span>
          </div>
          <ul class="criteria-list">
            ${feature.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}
          </ul>
          <div class="snippet-grid">
            <div>
              <p class="snippet-label">前端片段</p>
              <pre>${escapeHtml(frontendSnippet)}</pre>
            </div>
            <div>
              <p class="snippet-label">后端片段</p>
              <pre>${escapeHtml(backendSnippet)}</pre>
            </div>
          </div>
          <p class="db-note">数据库执行：${latestDatabaseRun ? escapeHtml(latestDatabaseRun.summary) : "尚未执行。"}</p>
        </article>
      `;
    }),
  );

  const uiPreviewSection = input.approvedUiHtmlFile
    ? `
      <div class="preview-frame">
        <iframe src="./${input.approvedUiHtmlFile}" title="Approved UI Preview"></iframe>
      </div>
    `
    : input.approvedUiImageFile
      ? `
        <div class="preview-frame">
          <img src="./${input.approvedUiImageFile}" alt="Approved UI Preview" />
        </div>
      `
      : `<div class="empty-preview">当前没有可嵌入的 UI 预览。</div>`;

  const openBugCount = input.job.bugReports.filter((bug) => bug.status === "open").length;
  const latestAcceptance = [...input.job.testRuns].reverse().find((run) => run.scope === "acceptance");

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>客户预览 - ${escapeHtml(input.job.requirement.title)}</title>
    <style>
      :root {
        --bg: #f4f6fb;
        --panel: #ffffff;
        --line: #d8dfeb;
        --text: #1d2736;
        --muted: #596579;
        --primary: #2457f5;
        --success: #0f8a5f;
        --warning: #b7791f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: radial-gradient(circle at top right, #eef3ff 0, #f4f6fb 46%, #edf1f7 100%);
        color: var(--text);
      }
      .page {
        max-width: 1320px;
        margin: 0 auto;
        padding: 28px 20px 48px;
      }
      .hero,
      .panel,
      .feature-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
      }
      .hero {
        padding: 28px;
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 24px;
        align-items: start;
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--primary);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1, h2, h3, p { margin: 0; }
      h1 {
        font-size: 36px;
        line-height: 1.15;
        margin-bottom: 14px;
      }
      .hero p {
        line-height: 1.7;
      }
      .hero-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(160px, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      .meta-card {
        padding: 14px 16px;
        border-radius: 16px;
        background: #f8faff;
        border: 1px solid var(--line);
      }
      .meta-label {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }
      .meta-value {
        font-size: 20px;
        font-weight: 700;
      }
      .preview-frame {
        min-height: 420px;
        overflow: hidden;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #f7f9fd;
      }
      .preview-frame iframe,
      .preview-frame img {
        display: block;
        width: 100%;
        min-height: 420px;
        border: 0;
        object-fit: cover;
      }
      .empty-preview {
        min-height: 420px;
        display: grid;
        place-items: center;
        border-radius: 18px;
        border: 1px dashed var(--line);
        color: var(--muted);
      }
      .panel {
        padding: 22px;
        margin-top: 20px;
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: #eaf0ff;
        color: var(--primary);
        font-size: 12px;
        font-weight: 700;
      }
      .badge.success {
        background: #e6f6ee;
        color: var(--success);
      }
      .badge.warning {
        background: #fff3df;
        color: var(--warning);
      }
      .link-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
      }
      a {
        color: var(--primary);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .feature-grid {
        display: grid;
        gap: 18px;
      }
      .feature-card {
        padding: 20px;
      }
      .feature-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 10px;
      }
      .feature-kicker {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 6px;
      }
      .feature-description,
      .db-note {
        color: var(--muted);
        line-height: 1.7;
      }
      .meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 14px 0;
        font-size: 13px;
        color: var(--muted);
      }
      .criteria-list {
        margin: 0;
        padding-left: 20px;
        line-height: 1.7;
      }
      .snippet-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .snippet-label {
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--muted);
      }
      pre {
        margin: 0;
        padding: 14px;
        border-radius: 16px;
        background: #f7f9fc;
        border: 1px solid var(--line);
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.6;
      }
      @media (max-width: 1024px) {
        .hero {
          grid-template-columns: 1fr;
        }
        .snippet-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <p class="eyebrow">Customer Preview</p>
          <h1>${escapeHtml(input.job.requirement.title)}</h1>
          <p>${escapeHtml(input.job.requirement.summary)}</p>
          <div class="hero-meta">
            <div class="meta-card">
              <div class="meta-label">当前阶段</div>
              <div class="meta-value">${escapeHtml(input.job.stage)}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">功能点</div>
              <div class="meta-value">${input.job.requirement.features.length}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">打开缺陷</div>
              <div class="meta-value">${openBugCount}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">数据库执行</div>
              <div class="meta-value">${input.job.databaseRuns.length}</div>
            </div>
          </div>
          <div class="link-row">
            <a href="${escapeHtml(input.serverUrl)}">当前预览地址</a>
            ${
              input.dashboardFile
                ? `<a href="./${escapeHtml(input.dashboardFile)}">打开工作流面板</a>`
                : ""
            }
            ${
              input.approvedUiHtmlFile
                ? `<a href="./${escapeHtml(input.approvedUiHtmlFile)}">查看原始 UI HTML</a>`
                : ""
            }
          </div>
        </div>
        ${uiPreviewSection}
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>客户可见功能清单</h2>
          <span class="badge ${input.job.releaseApproval?.approved ? "success" : "warning"}">
            ${input.job.releaseApproval?.approved ? "已允许发布" : "待客户确认"}
          </span>
        </div>
        <div class="feature-grid">
          ${previewSections.join("")}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>验收摘要</h2>
          <span class="badge ${latestAcceptance?.passed ? "success" : "warning"}">
            ${latestAcceptance?.passed ? "验收通过" : "待进一步检查"}
          </span>
        </div>
        <p>最近一次验收结果：${escapeHtml(latestAcceptance?.summary ?? "当前还没有验收记录。")}</p>
        <p style="margin-top: 10px; color: #596579;">生成时间：${escapeHtml(input.generatedAt)}</p>
      </section>
    </main>
  </body>
</html>`;
}

async function readSnippet(baseDir: string, relativePath: string, limit: number): Promise<string> {
  try {
    const absolutePath = path.join(baseDir, relativePath);
    const content = await readFile(absolutePath, "utf8");
    return content.replace(/\s+/g, " ").trim().slice(0, limit);
  } catch {
    return "无法读取当前片段。";
  }
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to determine preview port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
