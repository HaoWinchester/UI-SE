// 这个文件负责把当前 job 的前后端/数据库产物收敛成一个可运行的项目骨架。
// 目标不是只展示代码片段，而是生成一个真的能启动、能返回 API、能展示页面的最小全栈项目。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readDatabaseRuntimeEnv } from "../config/env.js";
import type {
  FeatureSpec,
  GeneratedProjectArtifact,
  WorkflowJob,
} from "../types/domain.js";
import { getFeatureCodePaths, getPrismaFeatureNames } from "../utils/feature-paths.js";

export interface GeneratedProjectBuilder {
  prepare(job: WorkflowJob): Promise<GeneratedProjectArtifact>;
}

interface RuntimeFeatureManifest {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  tableName: string;
  frontendComponentPath?: string;
  backendRoutePath?: string;
  databaseRepositoryPath?: string;
}

interface RuntimeProjectManifest {
  jobId: string;
  title: string;
  summary: string;
  generatedAt: string;
  clarifications: Array<{ topic: string; answer: string }>;
  userScenarios: string[];
  assumptions: string[];
  acceptedUi: {
    htmlFile?: string;
    imageFile?: string;
  };
  database: {
    name?: string;
    mode: "configured" | "unavailable";
  };
  features: RuntimeFeatureManifest[];
}

export class WorkspaceGeneratedProjectBuilder implements GeneratedProjectBuilder {
  constructor(private readonly baseDir: string) {}

  async prepare(job: WorkflowJob): Promise<GeneratedProjectArtifact> {
    const generatedAt = new Date().toISOString();
    const directoryPath = path.posix.join(job.codeWorkspace.rootDir, "app");
    const publicDirPath = path.posix.join(directoryPath, "public");
    const absoluteProjectDir = path.join(this.baseDir, directoryPath);
    const absolutePublicDir = path.join(this.baseDir, publicDirPath);

    await mkdir(absoluteProjectDir, { recursive: true });
    await mkdir(absolutePublicDir, { recursive: true });

    const acceptedUiHtmlFile = await this.copyIfPresent(
      job.uiArtifact?.htmlPath,
      absolutePublicDir,
      "approved-ui.html",
    );
    const acceptedUiImageFile = await this.copyIfPresent(
      job.uiArtifact?.imagePath,
      absolutePublicDir,
      "approved-ui.png",
    );

    const manifest = this.buildManifest(job, {
      generatedAt,
      acceptedUiHtmlFile,
      acceptedUiImageFile,
    });
    const runtimeDatabaseUrl = await this.resolveRuntimeDatabaseUrl(job);

    const manifestPath = path.posix.join(directoryPath, "manifest.json");
    const runtimeConfigPath = path.posix.join(directoryPath, "runtime-config.json");
    const serverEntryPath = path.posix.join(directoryPath, "server.mjs");
    const packageJsonPath = path.posix.join(directoryPath, "package.json");
    const readmePath = path.posix.join(directoryPath, "README.md");
    const indexHtmlPath = path.posix.join(publicDirPath, "index.html");
    const appJsPath = path.posix.join(publicDirPath, "app.js");
    const appCssPath = path.posix.join(publicDirPath, "app.css");

    await writeFile(
      path.join(this.baseDir, manifestPath),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.baseDir, runtimeConfigPath),
      JSON.stringify(
        {
          databaseUrl: runtimeDatabaseUrl,
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(path.join(this.baseDir, serverEntryPath), buildServerEntry(), "utf8");
    await writeFile(
      path.join(this.baseDir, packageJsonPath),
      JSON.stringify(
        {
          name: `ui-se-generated-${job.id}`,
          private: true,
          type: "module",
          scripts: {
            start: "node server.mjs",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(path.join(this.baseDir, readmePath), buildProjectReadme(job, directoryPath), "utf8");
    await writeFile(path.join(this.baseDir, indexHtmlPath), buildIndexHtml(job), "utf8");
    await writeFile(path.join(this.baseDir, appJsPath), buildBrowserEntry(), "utf8");
    await writeFile(path.join(this.baseDir, appCssPath), buildBrowserStyles(), "utf8");

    return {
      directoryPath,
      serverEntryPath,
      manifestPath,
      runtimeConfigPath,
      packageJsonPath,
      publicDirPath,
      generatedAt,
      startCommand: `cd ${directoryPath} && npm start`,
      summary: `Generated a runnable full-stack project shell with ${manifest.features.length} feature API slice(s).`,
    };
  }

  private buildManifest(
    job: WorkflowJob,
    input: {
      generatedAt: string;
      acceptedUiHtmlFile?: string;
      acceptedUiImageFile?: string;
    },
  ): RuntimeProjectManifest {
    const latestDatabaseRun = [...job.databaseRuns].reverse().find((run) => run.status === "applied");

    return {
      jobId: job.id,
      title: job.requirement.title,
      summary: job.requirement.summary,
      generatedAt: input.generatedAt,
      clarifications: job.requirement.clarifications.map((item) => ({
        topic: item.topic,
        answer: item.answer,
      })),
      userScenarios: [...job.requirement.userScenarios],
      assumptions: [...job.requirement.assumptions],
      acceptedUi: {
        htmlFile: input.acceptedUiHtmlFile,
        imageFile: input.acceptedUiImageFile,
      },
      database: {
        name: latestDatabaseRun?.databaseName,
        mode: latestDatabaseRun ? "configured" : "unavailable",
      },
      features: job.requirement.features.map((feature) => this.buildRuntimeFeature(job, feature)),
    };
  }

  private async resolveRuntimeDatabaseUrl(job: WorkflowJob): Promise<string | undefined> {
    const latestDatabaseRun = [...job.databaseRuns].reverse().find((run) => run.status === "applied");
    if (latestDatabaseRun?.logPath) {
      try {
        const raw = await readFile(path.join(this.baseDir, latestDatabaseRun.logPath), "utf8");
        const payload = JSON.parse(raw) as { rawDatabaseUrl?: string };
        if (payload.rawDatabaseUrl) {
          return payload.rawDatabaseUrl;
        }
      } catch {
        // fall through to environment-based fallback
      }
    }

    return readDatabaseRuntimeEnv().url;
  }

  private buildRuntimeFeature(job: WorkflowJob, feature: FeatureSpec): RuntimeFeatureManifest {
    const paths = getFeatureCodePaths(job.codeWorkspace, feature);
    const prismaNames = getPrismaFeatureNames(paths.featureSlug);

    return {
      id: feature.id,
      name: feature.name,
      description: feature.description,
      acceptanceCriteria: [...feature.acceptanceCriteria],
      tableName: prismaNames.tableName,
      frontendComponentPath: paths.frontendComponentPath,
      backendRoutePath: paths.backendRoutePath,
      databaseRepositoryPath: paths.databaseRepositoryPath,
    };
  }

  private async copyIfPresent(
    sourceRelativePath: string | undefined,
    targetDir: string,
    targetFileName: string,
  ): Promise<string | undefined> {
    if (!sourceRelativePath) {
      return undefined;
    }

    const sourceAbsolutePath = path.isAbsolute(sourceRelativePath)
      ? sourceRelativePath
      : path.join(this.baseDir, sourceRelativePath);
    const targetAbsolutePath = path.join(targetDir, targetFileName);

    try {
      await copyFile(sourceAbsolutePath, targetAbsolutePath);
      return targetFileName;
    } catch {
      return undefined;
    }
  }
}

function buildProjectReadme(job: WorkflowJob, directoryPath: string): string {
  return [
    `# ${job.requirement.title}`,
    "",
    "这个目录是 `UI-SE` 为当前需求自动生成的可运行项目骨架。",
    "",
    "## 启动方式",
    "",
    "```bash",
    `cd ${directoryPath}`,
    "npm start",
    "```",
    "",
    "启动后会得到：",
    "",
    "- `/api/health` 健康检查接口",
    "- `/api/project` 项目摘要接口",
    "- `/api/features` 功能与数据接口",
    "- `/` 最终前端页面",
    "",
    "页面数据会优先读取当前 job 已执行到 PostgreSQL 的种子数据。",
  ].join("\n");
}

function buildIndexHtml(job: WorkflowJob): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(job.requirement.title)}</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="app">正在加载 ${escapeHtml(job.requirement.title)} ...</div>
    <script type="module" src="./app.js"></script>
  </body>
</html>`;
}

function buildBrowserEntry(): string {
  return [
    'const root = document.getElementById("app");',
    "",
    "async function loadJson(path) {",
    "  const response = await fetch(path);",
    "  if (!response.ok) {",
    "    throw new Error(`Request failed: ${path} (${response.status})`);",
    "  }",
    "  return response.json();",
    "}",
    "",
    "function renderProject(project, features) {",
    "  const clarificationItems = project.clarifications.length",
    "    ? project.clarifications.map((item) => `<li><strong>${item.topic}</strong>：${item.answer}</li>`).join(\"\")",
    "    : '<li>当前没有额外澄清项。</li>';",
    "  const scenarioItems = project.userScenarios.map((item) => `<li>${item}</li>`).join(\"\");",
    "  const featureCards = features.map((feature) => {",
    "    const records = feature.records.length",
    "      ? feature.records.map((record) => `",
    "          <li class=\"record-item\">",
    "            <div>",
    "              <strong>${record.title}</strong>",
    "              <p>${record.status}</p>",
    "            </div>",
    "            <span>${record.actions.join(' / ')}</span>",
    "          </li>",
    "        `).join(\"\")",
    "      : '<li class=\"record-item empty\">当前还没有数据库记录。</li>';",
    "    return `",
    "      <article class=\"feature-card\">",
    "        <div class=\"feature-head\">",
    "          <div>",
    "            <p class=\"feature-kicker\">功能点</p>",
    "            <h3>${feature.name}</h3>",
    "          </div>",
    "          <span class=\"feature-count\">${feature.records.length} 条记录</span>",
    "        </div>",
    "        <p class=\"feature-description\">${feature.description}</p>",
    "        <ul class=\"criteria-list\">${feature.acceptanceCriteria.map((item) => `<li>${item}</li>`).join(\"\")}</ul>",
    "        <ul class=\"record-list\">${records}</ul>",
    "      </article>",
    "    `;",
    "  }).join(\"\");",
    "",
    "  const uiPreview = project.acceptedUi.htmlFile",
    "    ? `<iframe src=\"./${project.acceptedUi.htmlFile}\" title=\"Approved UI\"></iframe>`",
    "    : project.acceptedUi.imageFile",
    "      ? `<img src=\"./${project.acceptedUi.imageFile}\" alt=\"Approved UI\" />`",
    "      : '<div class=\"empty-preview\">当前没有 UI 预览文件。</div>';",
    "",
    "  root.innerHTML = `",
    "    <main class=\"page-shell\">",
    "      <section class=\"hero-card\">",
    "        <div class=\"hero-copy\">",
    "          <p class=\"eyebrow\">Generated Project</p>",
    "          <h1>${project.title}</h1>",
    "          <p class=\"hero-summary\">${project.summary}</p>",
    "          <div class=\"hero-meta\">",
    "            <div class=\"meta-card\"><span>功能点</span><strong>${project.features.length}</strong></div>",
    "            <div class=\"meta-card\"><span>澄清项</span><strong>${project.clarifications.length}</strong></div>",
    "            <div class=\"meta-card\"><span>数据库</span><strong>${project.database.name ?? '未命名'}</strong></div>",
    "          </div>",
    "        </div>",
    "        <div class=\"hero-preview\">${uiPreview}</div>",
    "      </section>",
    "      <section class=\"panel-grid\">",
    "        <section class=\"panel\">",
    "          <div class=\"panel-head\"><h2>需求澄清</h2></div>",
    "          <ul class=\"simple-list\">${clarificationItems}</ul>",
    "        </section>",
    "        <section class=\"panel\">",
    "          <div class=\"panel-head\"><h2>主路径场景</h2></div>",
    "          <ul class=\"simple-list\">${scenarioItems}</ul>",
    "        </section>",
    "      </section>",
    "      <section class=\"feature-grid\">${featureCards}</section>",
    "    </main>",
    "  `;",
    "}",
    "",
    "async function main() {",
    "  try {",
    "    const [project, featuresPayload] = await Promise.all([",
    "      loadJson('/api/project'),",
    "      loadJson('/api/features'),",
    "    ]);",
    "    renderProject(project, featuresPayload.features);",
    "  } catch (error) {",
    "    root.innerHTML = `<main class=\"page-shell\"><section class=\"panel error\"><h1>项目启动失败</h1><p>${String(error)}</p></section></main>`;",
    "  }",
    "}",
    "",
    "main();",
    "",
  ].join("\n");
}

function buildBrowserStyles(): string {
  return [
    ":root {",
    "  --bg: #f5f7fb;",
    "  --panel: #ffffff;",
    "  --line: #d7deea;",
    "  --text: #1d2736;",
    "  --muted: #5b6678;",
    "  --primary: #2b5cff;",
    "}",
    "* { box-sizing: border-box; }",
    "body {",
    "  margin: 0;",
    "  background: var(--bg);",
    "  color: var(--text);",
    "  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", sans-serif;",
    "}",
    ".page-shell {",
    "  max-width: 1240px;",
    "  margin: 0 auto;",
    "  padding: 32px 20px 56px;",
    "}",
    ".hero-card, .panel, .feature-card {",
    "  background: var(--panel);",
    "  border: 1px solid var(--line);",
    "  border-radius: 20px;",
    "}",
    ".hero-card {",
    "  display: grid;",
    "  grid-template-columns: 1fr 0.9fr;",
    "  gap: 24px;",
    "  padding: 28px;",
    "}",
    ".eyebrow {",
    "  margin: 0 0 10px;",
    "  color: var(--primary);",
    "  font-size: 12px;",
    "  font-weight: 700;",
    "  letter-spacing: 0.08em;",
    "  text-transform: uppercase;",
    "}",
    ".hero-summary {",
    "  margin: 14px 0 0;",
    "  color: var(--muted);",
    "  line-height: 1.75;",
    "}",
    ".hero-meta {",
    "  display: grid;",
    "  grid-template-columns: repeat(3, minmax(120px, 1fr));",
    "  gap: 12px;",
    "  margin-top: 20px;",
    "}",
    ".meta-card {",
    "  padding: 14px 16px;",
    "  border-radius: 16px;",
    "  border: 1px solid var(--line);",
    "  background: #f8faff;",
    "}",
    ".meta-card span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }",
    ".meta-card strong { font-size: 20px; }",
    ".hero-preview iframe, .hero-preview img, .empty-preview {",
    "  width: 100%;",
    "  min-height: 420px;",
    "  border: 1px solid var(--line);",
    "  border-radius: 18px;",
    "  background: #f8faff;",
    "}",
    ".hero-preview iframe { border: 1px solid var(--line); }",
    ".empty-preview { display: grid; place-items: center; color: var(--muted); }",
    ".panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }",
    ".panel, .feature-card { padding: 22px; }",
    ".panel-head { margin-bottom: 14px; }",
    ".simple-list, .criteria-list, .record-list { margin: 0; padding-left: 20px; line-height: 1.8; }",
    ".feature-grid { display: grid; gap: 18px; margin-top: 20px; }",
    ".feature-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }",
    ".feature-kicker { margin: 0 0 8px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }",
    ".feature-description { color: var(--muted); line-height: 1.7; margin: 10px 0 14px; }",
    ".feature-count { color: var(--primary); font-size: 12px; font-weight: 700; }",
    ".record-list { list-style: none; padding: 0; display: grid; gap: 12px; margin-top: 14px; }",
    ".record-item { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: #f8faff; }",
    ".record-item p { margin: 6px 0 0; color: var(--muted); }",
    ".record-item.empty { color: var(--muted); }",
    ".error { color: #b42318; }",
    "@media (max-width: 980px) {",
    "  .hero-card, .panel-grid { grid-template-columns: 1fr; }",
    "  .hero-meta { grid-template-columns: 1fr 1fr; }",
    "}",
    "",
  ].join("\n");
}

function buildServerEntry(): string {
  return [
    'import http from "node:http";',
    'import { readFile } from "node:fs/promises";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import { Pool } from "pg";',
    "",
    "const __filename = fileURLToPath(import.meta.url);",
    "const __dirname = path.dirname(__filename);",
    "const manifest = JSON.parse(await readFile(path.join(__dirname, 'manifest.json'), 'utf8'));",
    "const runtimeConfig = JSON.parse(await readFile(path.join(__dirname, 'runtime-config.json'), 'utf8'));",
    "const publicDir = path.join(__dirname, 'public');",
    "const featuresById = new Map(manifest.features.map((feature) => [feature.id, feature]));",
    "const databaseUrl = process.env.DATABASE_URL || runtimeConfig.databaseUrl;",
    "const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;",
    "const port = Number(process.env.PORT || 4300);",
    "",
    "function json(response, statusCode, payload) {",
    "  response.writeHead(statusCode, {",
    "    'Content-Type': 'application/json; charset=utf-8',",
    "    'Access-Control-Allow-Origin': '*',",
    "  });",
    "  response.end(JSON.stringify(payload));",
    "}",
    "",
    "function sendFile(response, filePath, contentType) {",
    "  return readFile(filePath).then((content) => {",
    "    response.writeHead(200, { 'Content-Type': contentType });",
    "    response.end(content);",
    "  }).catch(() => {",
    "    response.writeHead(404);",
    "    response.end('Not found');",
    "  });",
    "}",
    "",
    "async function readFeatureRecords(feature) {",
    "  if (!pool) {",
    "    return [];",
    "  }",
    "  const allowedTableName = feature.tableName;",
    "  if (!allowedTableName) {",
    "    return [];",
    "  }",
    "  try {",
    "    const query = `SELECT \"id\", \"title\", \"status\", \"actions\", \"createdAt\", \"updatedAt\" FROM \"${allowedTableName}\" ORDER BY \"createdAt\" DESC LIMIT 8`;",
    "    const result = await pool.query(query);",
    "    return result.rows.map((row) => ({",
    "      id: row.id,",
    "      title: row.title,",
    "      status: row.status,",
    "      actions: typeof row.actions === 'string' ? row.actions.split(',').filter(Boolean) : [],",
    "      createdAt: row.createdAt,",
    "      updatedAt: row.updatedAt,",
    "    }));",
    "  } catch (error) {",
    "    return [{",
    "      id: `${feature.id}-runtime-error`,",
    "      title: '数据库读取失败',",
    "      status: 'error',",
    "      actions: [String(error instanceof Error ? error.message : error)],",
    "    }];",
    "  }",
    "}",
    "",
    "async function readAllFeatures() {",
    "  return Promise.all(manifest.features.map(async (feature) => ({",
    "    ...feature,",
    "    records: await readFeatureRecords(feature),",
    "  })));",
    "}",
    "",
    "const server = http.createServer(async (request, response) => {",
    "  if (!request.url) {",
    "    response.writeHead(400);",
    "    response.end('Missing request url');",
    "    return;",
    "  }",
    "  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);",
    "",
    "  if (requestUrl.pathname === '/api/health') {",
    "    json(response, 200, { ok: true, jobId: manifest.jobId, hasDatabase: Boolean(pool) });",
    "    return;",
    "  }",
    "",
    "  if (requestUrl.pathname === '/api/project') {",
    "    json(response, 200, manifest);",
    "    return;",
    "  }",
    "",
    "  if (requestUrl.pathname === '/api/features') {",
    "    json(response, 200, { features: await readAllFeatures() });",
    "    return;",
    "  }",
    "",
    "  if (requestUrl.pathname.startsWith('/api/features/')) {",
    "    const featureId = requestUrl.pathname.split('/').pop();",
    "    const feature = featureId ? featuresById.get(featureId) : undefined;",
    "    if (!feature) {",
    "      json(response, 404, { error: 'Feature not found' });",
    "      return;",
    "    }",
    "    json(response, 200, { ...feature, records: await readFeatureRecords(feature) });",
    "    return;",
    "  }",
    "",
    "  const normalizedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;",
    "  const absolutePath = path.join(publicDir, normalizedPath);",
    "  const extension = path.extname(absolutePath);",
    "  const contentType = extension === '.css'",
    "    ? 'text/css; charset=utf-8'",
    "    : extension === '.js'",
    "      ? 'application/javascript; charset=utf-8'",
    "      : extension === '.png'",
    "        ? 'image/png'",
    "        : 'text/html; charset=utf-8';",
    "  await sendFile(response, absolutePath, contentType);",
    "});",
    "",
    "server.listen(port, '127.0.0.1', () => {",
    "  console.log(`Generated project server listening on http://127.0.0.1:${port}`);",
    "});",
    "",
    "for (const signal of ['SIGINT', 'SIGTERM']) {",
    "  process.on(signal, async () => {",
    "    server.close();",
    "    if (pool) {",
    "      await pool.end().catch(() => undefined);",
    "    }",
    "    process.exit(0);",
    "  });",
    "}",
    "",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
