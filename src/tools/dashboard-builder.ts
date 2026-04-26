// 这个文件负责生成工作流网页面板。
// 面板会汇总日志、偏航报告、数据库执行情况和当前产物，方便直接打开查看。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { agentTeams } from "../config/agent-teams.js";
import type { DashboardArtifact, WorkflowJob, WorkflowLogEntry } from "../types/domain.js";

export interface DashboardBuilder {
  render(job: WorkflowJob): Promise<DashboardArtifact>;
}

export class StaticHtmlDashboardBuilder implements DashboardBuilder {
  constructor(private readonly baseDir: string) {}

  async render(job: WorkflowJob): Promise<DashboardArtifact> {
    const generatedAt = new Date().toISOString();
    const htmlPath = path.posix.join("artifacts", "dashboard", job.id, "index.html");
    const absoluteHtmlPath = path.join(this.baseDir, htmlPath);
    const workflowLogs = await this.readWorkflowLogs(job.logFilePath);
    const html = buildDashboardHtml(this.baseDir, job, workflowLogs, generatedAt);

    await mkdir(path.dirname(absoluteHtmlPath), { recursive: true });
    await writeFile(absoluteHtmlPath, html, "utf8");

    return {
      htmlPath,
      generatedAt,
    };
  }

  private async readWorkflowLogs(relativeLogPath: string): Promise<WorkflowLogEntry[]> {
    try {
      const raw = await readFile(path.join(this.baseDir, relativeLogPath), "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as WorkflowLogEntry);
    } catch {
      return [];
    }
  }
}

function buildDashboardHtml(
  baseDir: string,
  job: WorkflowJob,
  workflowLogs: WorkflowLogEntry[],
  generatedAt: string,
): string {
  const featureRows = job.requirement.features
    .map((feature) => {
      const databaseRuns = job.databaseRuns.filter((run) => run.featureId === feature.id);
      const latestDatabaseRun = databaseRuns.at(-1);
      const openFailures = feature.failureHistory.filter((failure) => failure.status !== "resolved").length;
      const fileCount = feature.generatedFiles.length;

      return `
        <tr>
          <td>${escapeHtml(feature.name)}</td>
          <td><span class="badge">${escapeHtml(feature.status)}</span></td>
          <td>前端 ${escapeHtml(feature.frontendStatus)} / 后端 ${escapeHtml(feature.backendStatus)} / 数据库 ${escapeHtml(feature.databaseStatus)}</td>
          <td>${fileCount}</td>
          <td>${openFailures}</td>
          <td>${latestDatabaseRun ? escapeHtml(latestDatabaseRun.status) : "未执行"}</td>
        </tr>
      `;
    })
    .join("");

  const logItems = workflowLogs
    .map(
      (entry) => `
        <li class="timeline-item">
          <div class="timeline-head">
            <span class="badge level-${entry.level}">${escapeHtml(entry.level)}</span>
            <span class="stage">${escapeHtml(entry.stage)}</span>
            ${entry.teamLabel ? `<span class="badge">${escapeHtml(entry.teamLabel)}</span>` : ""}
            <time>${escapeHtml(entry.createdAt)}</time>
          </div>
          <div class="timeline-body">${escapeHtml(entry.message)}</div>
          ${
            entry.details
              ? `<pre>${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>`
              : ""
          }
        </li>
      `,
    )
    .join("");

  const alignmentItems = job.alignmentReports
    .map(
      (report) => `
        <article class="report-card">
          <div class="report-head">
            <strong>${escapeHtml(report.scope === "feature" ? `功能 ${report.featureId}` : "全局检查")}</strong>
            <span class="badge ${report.aligned ? "success" : "danger"}">${report.aligned ? "已对齐" : "偏航"}</span>
          </div>
          <p>${escapeHtml(report.summary)}</p>
          <p class="muted">报告时间：${escapeHtml(report.createdAt)}</p>
          <p class="muted">检查文件：${report.checkedFiles.length}</p>
          ${report.autoFixSummary ? `<p class="muted">自动修复：${escapeHtml(report.autoFixSummary)}</p>` : ""}
          ${
            report.findings.length > 0
              ? `<ul>${report.findings
                  .map(
                    (finding) =>
                      `<li>[${escapeHtml(finding.layer)}] ${escapeHtml(finding.message)}</li>`,
                  )
                  .join("")}</ul>`
              : "<p class=\"muted\">没有发现偏航项。</p>"
          }
          <p><a href="${toFileHref(path.join(baseDir, report.filePath))}">打开报告文件</a></p>
        </article>
      `,
    )
    .join("");

  const databaseItems = job.databaseRuns
    .map(
      (run) => `
        <article class="report-card">
          <div class="report-head">
            <strong>${escapeHtml(run.featureId)}</strong>
            <span class="badge ${run.status === "applied" ? "success" : "danger"}">${escapeHtml(run.status)}</span>
          </div>
          <p>${escapeHtml(run.summary)}</p>
          <p class="muted">数据库：${escapeHtml(run.databaseUrl)}</p>
          <p class="muted">模式：${escapeHtml(run.mode)}${run.containerName ? ` / ${escapeHtml(run.containerName)}` : ""}</p>
          <p class="muted">执行耗时：${run.durationMs}ms</p>
          <p><a href="${toFileHref(path.join(baseDir, run.logPath))}">打开数据库执行记录</a></p>
        </article>
      `,
    )
    .join("");

  const currentTeamLabel = job.currentTeam ? agentTeams[job.currentTeam]?.label ?? job.currentTeam : "未分配";
  const teamHistoryItems = job.teamHistory
    .map(
      (handoff) => `
        <li class="timeline-item">
          <div class="timeline-head">
            <span class="badge">${escapeHtml(agentTeams[handoff.toTeam]?.label ?? handoff.toTeam)}</span>
            <time>${escapeHtml(handoff.createdAt)}</time>
          </div>
          <div class="timeline-body">${escapeHtml(handoff.reason)}</div>
          ${
            handoff.fromTeam
              ? `<div class="muted" style="margin-top: 6px;">来自 ${escapeHtml(agentTeams[handoff.fromTeam]?.label ?? handoff.fromTeam)}</div>`
              : ""
          }
        </li>
      `,
    )
    .join("");

  const previewCard = job.uiArtifact
    ? `
      <section class="card preview-card">
        <div class="section-head">
          <h2>当前 UI 预览</h2>
          <span class="badge ${job.uiArtifact.reviewStatus === "approved" ? "success" : "warning"}">${escapeHtml(job.uiArtifact.reviewStatus)}</span>
        </div>
        <p>版本：v${job.uiArtifact.versionNumber} / 运行模式：${escapeHtml(job.uiArtifact.runtime)}</p>
        ${
          job.uiArtifact.imagePath
            ? `<img src="${toFileHref(job.uiArtifact.imagePath)}" alt="UI preview" class="preview-image" />`
            : "<p class=\"muted\">当前没有图片预览。</p>"
        }
        <div class="link-row">
          ${
            job.customerPreviewArtifact
              ? `<a href="${escapeHtml(job.customerPreviewArtifact.serverUrl)}">打开客户预览页</a>`
              : ""
          }
          ${
            job.uiArtifact.htmlPath
              ? `<a href="${toFileHref(job.uiArtifact.htmlPath)}">打开 HTML 预览</a>`
              : ""
          }
          ${
            job.uiArtifact.imagePath
              ? `<a href="${toFileHref(job.uiArtifact.imagePath)}">打开图片</a>`
              : ""
          }
        </div>
      </section>
    `
    : "";

  const deploymentSummary = job.deployment
    ? `${job.deployment.status} / ${job.deployment.environment}`
    : "尚未部署";

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UI-SE 工作流面板 - ${escapeHtml(job.id)}</title>
    <style>
      :root {
        --bg: #f5f7fb;
        --panel: #ffffff;
        --line: #d7deea;
        --text: #1d2736;
        --muted: #5b6678;
        --primary: #2b5cff;
        --success: #0f8a5f;
        --warning: #b7791f;
        --danger: #c53030;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .page {
        max-width: 1280px;
        margin: 0 auto;
        padding: 32px 20px 60px;
      }
      h1, h2, h3, p { margin: 0; }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        margin-bottom: 24px;
      }
      .hero-meta {
        display: grid;
        grid-template-columns: repeat(5, minmax(120px, 1fr));
        gap: 12px;
        width: 100%;
      }
      .stat, .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      .stat {
        padding: 16px;
      }
      .stat-label {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }
      .stat-value {
        font-size: 22px;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 20px;
        margin-top: 20px;
      }
      .stack {
        display: grid;
        gap: 20px;
      }
      .card {
        padding: 20px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        margin-bottom: 16px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: #e8eefc;
        color: var(--primary);
        font-size: 12px;
        font-weight: 600;
      }
      .badge.success { background: #e5f6ee; color: var(--success); }
      .badge.warning { background: #fff4df; color: var(--warning); }
      .badge.danger { background: #fde8e8; color: var(--danger); }
      .badge.level-warn { background: #fff4df; color: var(--warning); }
      .badge.level-error { background: #fde8e8; color: var(--danger); }
      .muted {
        color: var(--muted);
        font-size: 13px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 12px 10px;
        border-top: 1px solid var(--line);
        vertical-align: top;
        font-size: 14px;
      }
      th {
        color: var(--muted);
        font-weight: 600;
        font-size: 12px;
      }
      .timeline {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 12px;
        max-height: 720px;
        overflow: auto;
      }
      .timeline-item {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 14px;
      }
      .timeline-head {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-bottom: 8px;
      }
      .timeline-body {
        font-size: 14px;
        line-height: 1.6;
      }
      .timeline pre {
        margin: 10px 0 0;
        padding: 12px;
        border-radius: 10px;
        background: #f7f9fc;
        border: 1px solid var(--line);
        overflow: auto;
        font-size: 12px;
      }
      .report-list {
        display: grid;
        gap: 14px;
      }
      .report-card {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 14px;
      }
      .report-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 10px;
      }
      .report-card ul {
        margin: 10px 0;
        padding-left: 20px;
      }
      .preview-card img {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--line);
        margin-top: 14px;
      }
      .link-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 14px;
      }
      a {
        color: var(--primary);
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
      @media (max-width: 980px) {
        .hero, .grid { display: block; }
        .hero-meta {
          grid-template-columns: repeat(2, minmax(140px, 1fr));
          margin-top: 16px;
        }
        .stack { margin-top: 20px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <p class="muted">工作流面板</p>
          <h1>任务 ${escapeHtml(job.id)}</h1>
          <p class="muted" style="margin-top: 10px;">${escapeHtml(job.requirement.title)} · 当前阶段 ${escapeHtml(job.stage)} · 当前 Team ${escapeHtml(currentTeamLabel)} · 更新时间 ${escapeHtml(job.updatedAt)}</p>
          <p style="margin-top: 12px; line-height: 1.7;">${escapeHtml(job.requirement.summary)}</p>
          <p class="muted" style="margin-top: 12px;">面板生成时间：${escapeHtml(generatedAt)}</p>
        </div>
        <div class="hero-meta">
          <div class="stat"><div class="stat-label">功能点</div><div class="stat-value">${job.requirement.features.length}</div></div>
          <div class="stat"><div class="stat-label">Agent 执行</div><div class="stat-value">${job.agentRuns.length}</div></div>
          <div class="stat"><div class="stat-label">Team 交接</div><div class="stat-value">${job.teamHistory.length}</div></div>
          <div class="stat"><div class="stat-label">数据库执行</div><div class="stat-value">${job.databaseRuns.length}</div></div>
          <div class="stat"><div class="stat-label">部署状态</div><div class="stat-value" style="font-size:16px;">${escapeHtml(deploymentSummary)}</div></div>
        </div>
      </section>

      ${previewCard}

      <div class="grid">
        <section class="card">
          <div class="section-head">
            <h2>功能点总览</h2>
            <span class="muted">已生成代码工作区：<a href="${toFileHref(path.join(baseDir, job.codeWorkspace.rootDir))}">打开目录</a></span>
          </div>
          <table>
            <thead>
              <tr>
                <th>功能点</th>
                <th>状态</th>
                <th>交付轨道</th>
                <th>文件数</th>
                <th>未解决失败记忆</th>
                <th>数据库执行</th>
              </tr>
            </thead>
            <tbody>${featureRows}</tbody>
          </table>
        </section>

        <section class="stack">
          <section class="card">
            <div class="section-head">
              <h2>Team 编排</h2>
              <span class="muted">${escapeHtml(currentTeamLabel)}</span>
            </div>
            <ul class="timeline">${teamHistoryItems || '<li class="timeline-item"><div class="timeline-body">当前还没有 team 交接记录。</div></li>'}</ul>
          </section>

          <section class="card">
            <div class="section-head">
              <h2>数据库执行记录</h2>
              <span class="muted">${job.databaseRuns.length} 次</span>
            </div>
            <div class="report-list">${databaseItems || '<p class="muted">当前还没有数据库执行记录。</p>'}</div>
          </section>

          <section class="card">
            <div class="section-head">
              <h2>偏航报告</h2>
              <span class="muted">${job.alignmentReports.length} 份</span>
            </div>
            <div class="report-list">${alignmentItems || '<p class="muted">当前还没有偏航报告。</p>'}</div>
          </section>
        </section>
      </div>

      <section class="card" style="margin-top: 20px;">
        <div class="section-head">
          <h2>工作流日志</h2>
          <a href="${toFileHref(path.join(baseDir, job.logFilePath))}">打开 JSONL 日志</a>
        </div>
        <ul class="timeline">${logItems || '<li class="timeline-item"><div class="timeline-body">当前还没有日志。</div></li>'}</ul>
      </section>
    </main>
  </body>
</html>`;
}

function toFileHref(absolutePath: string): string {
  return encodeURI(`file://${absolutePath}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
