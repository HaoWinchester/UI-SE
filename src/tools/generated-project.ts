// 这个文件负责把当前 job 的前后端/数据库产物收敛成一个可运行的项目骨架。
// 目标不是只展示代码片段，而是生成一个真的能启动、能返回 API、能展示页面的最小全栈项目。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readDatabaseRuntimeEnv } from "../config/env.js";
import type {
  FeatureSpec,
  GeneratedProjectArtifact,
  UiArtifact,
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
    const runtimeHtmlPath = path.posix.join(publicDirPath, "runtime.html");
    const catalogHtmlPath = path.posix.join(publicDirPath, "catalog.html");
    const detailHtmlPath = path.posix.join(publicDirPath, "detail.html");
    const appJsPath = path.posix.join(publicDirPath, "app.js");
    const appCssPath = path.posix.join(publicDirPath, "app.css");
    const runtimeIndexHtml = buildAppPageHtml(job, "home");
    const catalogIndexHtml = buildAppPageHtml(job, "catalog");
    const detailIndexHtml = buildAppPageHtml(job, "detail");
    const linkedApprovedSite = await buildLinkedApprovedUiPages(this.baseDir, job.uiArtifact);
    const landingHtml =
      linkedApprovedSite?.landingHtml ??
      (acceptedUiHtmlFile && job.uiArtifact?.runtime === "real"
        ? await buildApprovedUiLanding(path.join(absolutePublicDir, acceptedUiHtmlFile), job)
        : runtimeIndexHtml);

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
    await writeFile(path.join(this.baseDir, indexHtmlPath), landingHtml, "utf8");
    if (linkedApprovedSite) {
      for (const page of linkedApprovedSite.pages) {
        await writeFile(path.join(this.baseDir, publicDirPath, page.fileName), page.content, "utf8");
      }
    }
    await writeFile(path.join(this.baseDir, runtimeHtmlPath), runtimeIndexHtml, "utf8");
    await writeFile(path.join(this.baseDir, catalogHtmlPath), catalogIndexHtml, "utf8");
    await writeFile(path.join(this.baseDir, detailHtmlPath), detailIndexHtml, "utf8");
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
      summary: `Generated a runnable full-stack website with ${manifest.features.length} feature-driven content slice(s).`,
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
    "这个目录是 `UI-SE` 为当前需求自动生成的可运行网站项目。",
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
    "- `/api/project` 项目与需求摘要接口",
    "- `/api/features` 功能与数据接口",
    "- `/` 与批准设计稿一致的前台首页",
    "- `/catalog.html` 网站浏览页",
    "- `/detail.html?feature=<featureId>` 网站详情页",
    "",
    "网站页面会优先读取当前 job 已执行到 PostgreSQL 的种子数据。",
  ].join("\n");
}

function buildAppPageHtml(job: WorkflowJob, pageKind: "home" | "catalog" | "detail"): string {
  const titleSuffix =
    pageKind === "catalog"
      ? "内容浏览"
      : pageKind === "detail"
        ? "内容详情"
        : job.requirement.title;
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(titleSuffix)}</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body data-page="${pageKind}">
    <div id="app">正在加载 ${escapeHtml(job.requirement.title)} ...</div>
    <script type="module" src="./app.js"></script>
  </body>
</html>`;
}

async function buildLinkedApprovedUiPages(
  baseDir: string,
  uiArtifact: UiArtifact | undefined,
): Promise<
  | {
      landingHtml: string;
      pages: Array<{ fileName: string; content: string }>;
    }
  | undefined
> {
  if (uiArtifact?.runtime !== "real" || !uiArtifact.screens?.length) {
    return undefined;
  }

  const htmlScreens = uiArtifact.screens.filter((screen) => screen.htmlPath);
  if (htmlScreens.length === 0) {
    return undefined;
  }

  const routeMap = htmlScreens.map((screen, index) => ({
    ...screen,
    fileName: index === 0 ? "index.html" : `screen-${index + 1}.html`,
    label: `页面 ${index + 1}`,
  }));

  const pages = await Promise.all(
    routeMap.map(async (screen, index) => {
      const htmlPath = path.isAbsolute(screen.htmlPath!)
        ? screen.htmlPath!
        : path.join(baseDir, screen.htmlPath!);
      const sourceHtml = await readFile(htmlPath, "utf8");
      return {
        fileName: screen.fileName,
        content: injectScreenNavigation(sourceHtml, {
          currentIndex: index,
          screenCount: routeMap.length,
          routes: routeMap.map((item) => ({
            label: item.label,
            href: `./${item.fileName}`,
          })),
        }),
      };
    }),
  );

  return {
    landingHtml: pages[0].content,
    pages: pages.slice(1),
  };
}

function injectScreenNavigation(
  sourceHtml: string,
  input: {
    currentIndex: number;
    screenCount: number;
    routes: Array<{ label: string; href: string }>;
  },
): string {
  const previous = input.currentIndex > 0 ? input.routes[input.currentIndex - 1] : undefined;
  const next =
    input.currentIndex < input.routes.length - 1 ? input.routes[input.currentIndex + 1] : undefined;
  const navHtml = `
<style>
  .ui-se-screen-nav {
    position: fixed;
    right: 24px;
    top: 24px;
    z-index: 120;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    max-width: min(92vw, 720px);
    padding: 12px 14px;
    border-radius: 20px;
    background: rgba(10, 10, 14, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  }
  .ui-se-screen-nav__title {
    color: #ffffff;
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 800;
    margin-right: 4px;
    white-space: nowrap;
  }
  .ui-se-screen-nav a {
    color: rgba(255, 255, 255, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 8px 12px;
    text-decoration: none;
    font-size: 12px;
    white-space: nowrap;
  }
  .ui-se-screen-nav a.is-active {
    background: rgba(155, 168, 255, 0.18);
    border-color: rgba(155, 168, 255, 0.48);
    color: #ffffff;
  }
  @media (max-width: 720px) {
    .ui-se-screen-nav {
      left: 12px;
      right: 12px;
      top: 12px;
    }
  }
</style>
<nav class="ui-se-screen-nav" aria-label="Generated screen navigation">
  <span class="ui-se-screen-nav__title">Stitch 页面流</span>
  ${input.routes
    .map(
      (route, index) =>
        `<a href="${route.href}" class="${index === input.currentIndex ? "is-active" : ""}">${route.label}</a>`,
    )
    .join("")}
  ${previous ? `<a href="${previous.href}">上一页</a>` : ""}
  ${next ? `<a href="${next.href}">下一页</a>` : ""}
</nav>`;

  if (sourceHtml.includes("</body>")) {
    return sourceHtml.replace("</body>", `${navHtml}\n</body>`);
  }

  return `${sourceHtml}\n${navHtml}`;
}

async function buildApprovedUiLanding(
  absoluteApprovedUiPath: string,
  job: WorkflowJob,
): Promise<string> {
  const sourceHtml = await readFile(absoluteApprovedUiPath, "utf8");
  const primaryFeature = job.requirement.features[0];
  const bridgeConfig = JSON.stringify({
    primaryFeatureId: primaryFeature?.id,
    runtimeHome: "./runtime.html#home",
    runtimeCatalog: "./runtime.html#catalog",
  });
  const bridgeScript = `
<style>
  #ui-se-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
  }
  #ui-se-overlay-root[data-open="true"] {
    pointer-events: auto;
  }
  .ui-se-overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(5, 6, 10, 0.72);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }
  .ui-se-overlay-panel {
    position: absolute;
    inset: 5vh 4vw;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid rgba(155, 168, 255, 0.18);
    background:
      linear-gradient(180deg, rgba(17, 17, 23, 0.98), rgba(8, 8, 12, 0.98));
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.46);
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .ui-se-overlay-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    padding: 24px 26px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .ui-se-overlay-eyebrow {
    margin: 0 0 8px;
    color: #81ecff;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    font-weight: 800;
    font-family: 'Space Grotesk', sans-serif;
  }
  .ui-se-overlay-title {
    margin: 0;
    color: #ffffff;
    font-size: clamp(28px, 4vw, 42px);
    font-style: italic;
    line-height: 1.02;
    letter-spacing: -0.04em;
    font-weight: 900;
    font-family: 'Space Grotesk', sans-serif;
  }
  .ui-se-overlay-subtitle {
    margin: 10px 0 0;
    color: rgba(255, 255, 255, 0.72);
    max-width: 760px;
    line-height: 1.72;
    font-size: 14px;
  }
  .ui-se-overlay-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .ui-se-overlay-button {
    border: 1px solid rgba(155, 168, 255, 0.22);
    border-radius: 999px;
    padding: 12px 18px;
    background: rgba(255, 255, 255, 0.04);
    color: #ffffff;
    font: inherit;
    cursor: pointer;
  }
  .ui-se-overlay-button.is-primary {
    background: linear-gradient(90deg, rgba(155, 168, 255, 0.95), rgba(73, 99, 255, 0.95));
    color: #0b0c12;
    border-color: transparent;
    font-weight: 800;
  }
  .ui-se-overlay-body {
    overflow: auto;
    padding: 24px 26px 30px;
  }
  .ui-se-overlay-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
  .ui-se-feature-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(30, 30, 38, 0.95), rgba(14, 14, 18, 0.95));
    overflow: hidden;
  }
  .ui-se-feature-poster {
    min-height: 200px;
    padding: 18px;
    display: flex;
    align-items: flex-end;
    background:
      radial-gradient(circle at top left, rgba(129, 236, 255, 0.22), transparent 48%),
      radial-gradient(circle at top right, rgba(155, 168, 255, 0.28), transparent 42%),
      linear-gradient(135deg, rgba(12, 12, 18, 1), rgba(29, 24, 51, 1));
  }
  .ui-se-feature-rank {
    width: 42px;
    height: 42px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 900;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(4, 4, 7, 0.48);
  }
  .ui-se-feature-content {
    padding: 18px;
  }
  .ui-se-feature-meta {
    margin: 0 0 8px;
    color: #81ecff;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 800;
  }
  .ui-se-feature-title {
    margin: 0;
    color: #ffffff;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 22px;
    font-style: italic;
    line-height: 1.1;
    letter-spacing: -0.03em;
    font-weight: 800;
  }
  .ui-se-feature-copy {
    margin: 12px 0 0;
    color: rgba(255, 255, 255, 0.74);
    line-height: 1.72;
    font-size: 14px;
  }
  .ui-se-feature-tags,
  .ui-se-detail-tags {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .ui-se-feature-tags span,
  .ui-se-detail-tags span {
    border-radius: 999px;
    padding: 8px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
  }
  .ui-se-detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 22px;
  }
  .ui-se-detail-panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(28, 28, 34, 0.96), rgba(12, 12, 16, 0.96));
    padding: 20px;
  }
  .ui-se-detail-panel h3 {
    margin: 0;
    font-family: 'Space Grotesk', sans-serif;
    color: #ffffff;
    font-size: 20px;
    font-style: italic;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  .ui-se-detail-panel ul {
    margin: 14px 0 0;
    padding-left: 18px;
    color: rgba(255, 255, 255, 0.78);
    line-height: 1.9;
  }
  .ui-se-record-list {
    display: grid;
    gap: 14px;
    margin-top: 16px;
  }
  .ui-se-record-item {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.03);
    padding: 16px;
  }
  .ui-se-record-item strong {
    display: block;
    color: #ffffff;
    font-size: 16px;
    margin-bottom: 6px;
  }
  .ui-se-record-item p {
    margin: 0;
    color: rgba(255, 255, 255, 0.68);
    line-height: 1.7;
  }
  .ui-se-inline-link {
    color: #9ba8ff;
    font-weight: 700;
    cursor: pointer;
  }
  @media (max-width: 980px) {
    .ui-se-overlay-panel {
      inset: 3vh 3vw;
    }
    .ui-se-overlay-grid,
    .ui-se-detail-layout {
      grid-template-columns: 1fr;
    }
    .ui-se-overlay-head {
      flex-direction: column;
    }
  }
</style>
<script>
(() => {
  const config = ${bridgeConfig};
  const state = { project: null, features: null };
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const ensureMount = () => {
    let mount = document.getElementById("ui-se-overlay-root");
    if (!mount) {
      mount = document.createElement("div");
      mount.id = "ui-se-overlay-root";
      mount.dataset.open = "false";
      document.body.appendChild(mount);
    }
    return mount;
  };
  const closeOverlay = () => {
    const mount = ensureMount();
    mount.dataset.open = "false";
    mount.innerHTML = "";
    document.body.style.overflow = "";
  };
  const ensurePayload = async () => {
    if (state.project && state.features) {
      return state;
    }
    const [project, featuresPayload] = await Promise.all([
      fetch("/api/project").then((response) => response.json()),
      fetch("/api/features").then((response) => response.json()),
    ]);
    state.project = project;
    state.features = featuresPayload.features || [];
    return state;
  };
  const renderShell = (title, subtitle, body) => {
    const mount = ensureMount();
    mount.dataset.open = "true";
    document.body.style.overflow = "hidden";
    mount.innerHTML = \`
      <div class="ui-se-overlay-backdrop" data-overlay-close></div>
      <section class="ui-se-overlay-panel" role="dialog" aria-modal="true">
        <header class="ui-se-overlay-head">
          <div>
            <p class="ui-se-overlay-eyebrow">Runtime Content Layer</p>
            <h2 class="ui-se-overlay-title">\${title}</h2>
            <p class="ui-se-overlay-subtitle">\${subtitle}</p>
          </div>
          <div class="ui-se-overlay-actions">
            <button class="ui-se-overlay-button" type="button" data-open-runtime>打开可运行站点</button>
            <button class="ui-se-overlay-button is-primary" type="button" data-overlay-close>关闭</button>
          </div>
        </header>
        <div class="ui-se-overlay-body">\${body}</div>
      </section>
    \`;
    for (const node of mount.querySelectorAll("[data-overlay-close]")) {
      node.addEventListener("click", closeOverlay);
    }
    const runtimeButton = mount.querySelector("[data-open-runtime]");
    if (runtimeButton) {
      runtimeButton.addEventListener("click", () => {
        window.location.href = config.runtimeCatalog;
      });
    }
  };
  const openCatalog = async () => {
    const payload = await ensurePayload();
    const cards = payload.features.map((feature, index) => {
      const primaryRecord = feature.records[0];
      const copy = primaryRecord?.title || feature.description;
      const meta = payload.project.clarifications[index]?.answer || feature.name;
      return \`
        <article class="ui-se-feature-card">
          <div class="ui-se-feature-poster">
            <div class="ui-se-feature-rank">0\${index + 1}</div>
          </div>
          <div class="ui-se-feature-content">
            <p class="ui-se-feature-meta">\${escapeHtml(meta)}</p>
            <h3 class="ui-se-feature-title">\${escapeHtml(feature.name)}</h3>
            <p class="ui-se-feature-copy">\${escapeHtml(copy)}</p>
            <div class="ui-se-feature-tags">
              \${(feature.acceptanceCriteria || []).slice(0, 3).map((item) => \`<span>\${escapeHtml(item)}</span>\`).join("")}
            </div>
            <div class="ui-se-feature-tags">
              <span class="ui-se-inline-link" data-feature-open="\${feature.id}">进入详情</span>
            </div>
          </div>
        </article>
      \`;
    }).join("");
    renderShell(
      "CONTENT INDEX",
      payload.project.summary,
      \`<div class="ui-se-overlay-grid">\${cards}</div>\`,
    );
    for (const node of document.querySelectorAll("[data-feature-open]")) {
      node.addEventListener("click", () => {
        const featureId = node.getAttribute("data-feature-open");
        if (featureId) {
          void openDetail(featureId);
        }
      });
    }
  };
  const openDetail = async (featureId) => {
    const payload = await ensurePayload();
    const feature = payload.features.find((item) => item.id === featureId) || payload.features[0];
    if (!feature) {
      return;
    }
    const records = feature.records?.length
      ? feature.records.map((record) => \`
          <article class="ui-se-record-item">
            <strong>\${escapeHtml(record.title)}</strong>
            <p>\${escapeHtml(record.status || "ready")}</p>
            <div class="ui-se-detail-tags">
              \${(record.actions || []).map((action) => \`<span>\${escapeHtml(action)}</span>\`).join("")}
            </div>
          </article>
        \`).join("")
      : \`<article class="ui-se-record-item"><strong>当前暂无记录</strong><p>数据库中还没有额外状态数据，后续可以继续填充。</p></article>\`;
    renderShell(
      escapeHtml(feature.name).toUpperCase(),
      feature.description,
      \`
        <div class="ui-se-detail-layout">
          <section class="ui-se-detail-panel">
            <h3>Feature Scope</h3>
            <ul>\${(feature.acceptanceCriteria || []).map((item) => \`<li>\${escapeHtml(item)}</li>\`).join("")}</ul>
          </section>
          <section class="ui-se-detail-panel">
            <h3>Runtime Records</h3>
            <div class="ui-se-record-list">\${records}</div>
          </section>
        </div>
      \`,
    );
  };
  const bindNode = (node, handler) => {
    if (!node) {
      return;
    }
    node.style.cursor = "pointer";
    if (node.tagName === "A") {
      node.setAttribute("href", "#");
    }
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
  };
  const catalogKeywords = [
    "browse",
    "trending",
    "new releases",
    "my list",
    "explore full chart",
    "all genres",
    "sci-fi",
    "shonen",
    "seinen",
    "supernatural",
    "action",
    "psychological",
    "sports",
  ];
  const detailKeywords = ["watch now", "view details", "details"];
  for (const node of document.querySelectorAll("a, button")) {
    const text = normalize(node.textContent);
    if (!text) {
      continue;
    }
    if (detailKeywords.some((keyword) => text.includes(keyword))) {
      bindNode(node, async () => {
        const payload = await ensurePayload();
        const fallbackId = payload.features[0]?.id;
        await openDetail(config.primaryFeatureId || fallbackId);
      });
      continue;
    }
    if (catalogKeywords.some((keyword) => text.includes(keyword))) {
      bindNode(node, openCatalog);
    }
  }
  const posterCards = document.querySelectorAll(".group.relative.overflow-hidden.rounded-xl");
  posterCards.forEach((card, index) => {
    bindNode(card, async () => {
      const payload = await ensurePayload();
      const feature = payload.features[index % payload.features.length];
      if (feature) {
        await openDetail(feature.id);
      } else {
        await openCatalog();
      }
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeOverlay();
    }
    if (event.altKey && event.key.toLowerCase() === "r") {
      window.location.href = config.runtimeHome;
    }
  });
})();
</script>`;
  if (sourceHtml.includes("</body>")) {
    return sourceHtml.replace("</body>", `${bridgeScript}\n</body>`);
  }
  return `${sourceHtml}\n${bridgeScript}`;
}

function slugifyBrowserRoute(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u4e00-\u9fa5]/g, "");
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
    "function escapeHtml(value) {",
    "  return String(value ?? '')",
    "    .replaceAll('&', '&amp;')",
    "    .replaceAll('<', '&lt;')",
    "    .replaceAll('>', '&gt;')",
    "    .replaceAll('\"', '&quot;')",
    "    .replaceAll(\"'\", '&#39;');",
    "}",
    "",
    "function slugify(value) {",
    "  return String(value ?? '')",
    "    .trim()",
    "    .toLowerCase()",
    "    .replace(/\\s+/g, '-')",
    "    .replace(/[^\\w\\-\\u4e00-\\u9fa5]/g, '');",
    "}",
    "",
    "function inferTheme(project) {",
    "  const title = `${project.title} ${project.summary}`;",
    "  if (title.includes('动漫') || title.includes('番剧') || title.includes('二次元')) {",
    "    return {",
    "      label: '动漫发现站',",
    "      nav: ['首页', '番剧推荐', '追更日历', '角色档案'],",
    "      heroTag: '本季主打',",
    "      heroLead: '追新番、看详情、记更新，围绕首版主路径快速进入内容。',",
    "      chips: ['热播', '新番', '剧场版', '高分', '追更'],",
    "    };",
    "  }",
    "",
    "  return {",
    "    label: '内容体验站',",
    "    nav: ['首页', '精选内容', '体验流程', '详情'],",
    "    heroTag: '精选体验',",
    "    heroLead: '围绕澄清后的需求，生成一个可以直接浏览与演示的可运行前台。',",
    "    chips: ['精选', '推荐', '详情', '更新'],",
    "  };",
    "}",
    "",
    "function toShowcaseItems(project, features) {",
    "  return features.map((feature, index) => {",
    "    const primaryRecord = feature.records[0];",
    "    const accent = ['星夜档案', '霓虹片单', '追更雷达', '角色笔记'][index % 4];",
    "    const badge = project.clarifications[index]?.answer || feature.name;",
    "    return {",
    "      id: feature.id,",
    "      slug: slugify(feature.name) || feature.id,",
    "      name: feature.name,",
    "      kicker: accent,",
    "      badge,",
    "      summary: primaryRecord?.title || feature.description,",
    "      status: primaryRecord?.status || 'ready',",
    "      actions: primaryRecord?.actions?.length ? primaryRecord.actions : ['查看详情', '加入片单'],",
    "      acceptanceCriteria: feature.acceptanceCriteria,",
    "      recordCount: feature.records.length,",
    "      records: feature.records,",
    "    };",
    "  });",
    "}",
    "",
    "function getCurrentView(items) {",
    "  const staticPage = document.body.dataset.page || 'home';",
    "  if (staticPage === 'catalog') {",
    "    return { page: 'catalog' };",
    "  }",
    "  if (staticPage === 'detail') {",
    "    const search = new URL(window.location.href).searchParams;",
    "    const featureId = search.get('feature');",
    "    const match = items.find((item) => item.id === featureId || item.slug === featureId);",
    "    return { page: 'detail', item: match || items[0] };",
    "  }",
    "  const hash = window.location.hash.replace(/^#/, '');",
    "  if (hash === 'catalog') {",
    "    return { page: 'catalog' };",
    "  }",
    "  if (hash.startsWith('detail/')) {",
    "    const slug = hash.split('/')[1];",
    "    const match = items.find((item) => item.slug === slug || item.id === slug);",
    "    if (match) {",
    "      return { page: 'detail', item: match };",
    "    }",
    "  }",
    "  return { page: 'home' };",
    "}",
    "",
    "function renderTopNav(theme, currentPage, activeItem) {",
    "  const links = [",
    "    { key: 'home', label: theme.nav[0], href: './' },",
    "    { key: 'catalog', label: theme.nav[1], href: './catalog.html' },",
    "    { key: 'timeline', label: theme.nav[2], href: './catalog.html' },",
    "    { key: 'detail', label: theme.nav[3], href: activeItem ? `./detail.html?feature=${encodeURIComponent(activeItem.id)}` : './catalog.html' },",
    "  ];",
    "  return links.map((link) => `",
    "    <a class=\"site-nav-link ${currentPage === link.key ? 'is-active' : ''}\" href=\"${link.href}\">${link.label}</a>",
    "  `).join('');",
    "}",
    "",
    "function renderHero(project, theme, leadItem) {",
    "  const designLink = project.acceptedUi.htmlFile",
    "    ? `./${project.acceptedUi.htmlFile}`",
    "    : project.acceptedUi.imageFile",
    "      ? `./${project.acceptedUi.imageFile}`",
    "      : '';",
    "  const actions = designLink",
    "    ? `<a class=\"hero-secondary\" href=\"${designLink}\" target=\"_blank\" rel=\"noreferrer\">查看设计稿</a>`",
    "    : '';",
    "  return `",
    "    <section class=\"hero-banner\">",
    "      <div class=\"hero-copy\">",
    "        <p class=\"hero-kicker\">${theme.heroTag}</p>",
    "        <h1>${escapeHtml(project.title)}</h1>",
    "        <p class=\"hero-summary\">${escapeHtml(project.summary)}</p>",
    "        <p class=\"hero-lead\">${escapeHtml(theme.heroLead)}</p>",
    "        <div class=\"hero-actions\">",
    "          <a class=\"hero-primary\" href=\"./detail.html?feature=${encodeURIComponent(leadItem.id)}\">进入主路径</a>",
    "          ${actions}",
    "        </div>",
    "      </div>",
    "      <aside class=\"hero-spotlight\">",
    "        <div class=\"spotlight-card\">",
    "          <p class=\"spotlight-label\">推荐入口</p>",
    "          <h2>${escapeHtml(leadItem.name)}</h2>",
    "          <p>${escapeHtml(leadItem.summary)}</p>",
    "          <dl class=\"spotlight-meta\">",
    "            <div><dt>状态</dt><dd>${escapeHtml(leadItem.status)}</dd></div>",
    "            <div><dt>记录</dt><dd>${leadItem.recordCount}</dd></div>",
    "            <div><dt>标签</dt><dd>${escapeHtml(leadItem.badge)}</dd></div>",
    "          </dl>",
    "        </div>",
    "      </aside>",
    "    </section>",
    "  `;",
    "}",
    "",
    "function renderChipRow(theme) {",
    "  return `",
    "    <div class=\"chip-row\">",
    "      ${theme.chips.map((chip, index) => `<button type=\"button\" class=\"chip ${index === 0 ? 'is-selected' : ''}\">${chip}</button>`).join('')}",
    "    </div>",
    "  `;",
    "}",
    "",
    "function renderCatalog(items) {",
    "  return `",
    "    <section class=\"section-block\">",
    "      <div class=\"section-head\">",
    "        <div>",
    "          <p class=\"section-eyebrow\">内容浏览</p>",
    "          <h2>本季推荐片单</h2>",
    "        </div>",
    "        <a class=\"text-link\" href=\"./catalog.html\">查看全部</a>",
    "      </div>",
    "      <div class=\"catalog-grid\">",
    "        ${items.map((item, index) => `",
    "          <article class=\"anime-card\">",
    "            <div class=\"poster-shell\">",
    "              <span class=\"poster-rank\">0${index + 1}</span>",
    "              <div class=\"poster-art\">${escapeHtml(item.kicker)}</div>",
    "            </div>",
    "            <div class=\"anime-card-body\">",
    "              <div class=\"anime-card-head\">",
    "                <div>",
    "                  <p class=\"anime-badge\">${escapeHtml(item.badge)}</p>",
    "                  <h3>${escapeHtml(item.name)}</h3>",
    "                </div>",
    "                <span class=\"status-pill\">${escapeHtml(item.status)}</span>",
    "              </div>",
    "              <p class=\"anime-copy\">${escapeHtml(item.summary)}</p>",
    "              <div class=\"anime-actions\">",
    "                <a class=\"card-link\" href=\"./detail.html?feature=${encodeURIComponent(item.id)}\">查看详情</a>",
    "                <span class=\"record-meta\">${item.recordCount} 条内容</span>",
    "              </div>",
    "            </div>",
    "          </article>",
    "        `).join('')}",
    "      </div>",
    "    </section>",
    "  `;",
    "}",
    "",
    "function renderTimeline(items) {",
    "  return `",
    "    <section class=\"section-block section-split\">",
    "      <div class=\"section-head\">",
    "        <div>",
    "          <p class=\"section-eyebrow\">追更节奏</p>",
    "          <h2>主路径更新节拍</h2>",
    "        </div>",
    "      </div>",
    "      <div class=\"timeline-list\">",
    "        ${items.map((item) => `",
    "          <article class=\"timeline-item\">",
    "            <div class=\"timeline-dot\"></div>",
    "            <div class=\"timeline-copy\">",
    "              <h3>${escapeHtml(item.name)}</h3>",
    "              <p>${escapeHtml(item.summary)}</p>",
    "              <div class=\"timeline-tags\">${item.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join('')}</div>",
    "            </div>",
    "          </article>",
    "        `).join('')}",
    "      </div>",
    "    </section>",
    "  `;",
    "}",
    "",
    "function renderInsightPanel(project) {",
    "  return `",
    "    <section class=\"section-block insight-panel\">",
    "      <div class=\"section-head\">",
    "        <div>",
    "          <p class=\"section-eyebrow\">需求收敛</p>",
    "          <h2>当前版本关键决策</h2>",
    "        </div>",
    "      </div>",
    "      <div class=\"insight-grid\">",
    "        <div class=\"insight-card\">",
    "          <span>澄清项</span>",
    "          <strong>${project.clarifications.length}</strong>",
    "          <p>${escapeHtml(project.clarifications.map((item) => `${item.topic}：${item.answer}`).join(' / '))}</p>",
    "        </div>",
    "        <div class=\"insight-card\">",
    "          <span>主路径</span>",
    "          <strong>${escapeHtml(project.userScenarios[1] || '已配置')}</strong>",
    "          <p>${escapeHtml(project.userScenarios[0] || project.summary)}</p>",
    "        </div>",
    "        <div class=\"insight-card\">",
    "          <span>数据层</span>",
    "          <strong>${escapeHtml(project.database.name || '未连接')}</strong>",
    "          <p>当前页面已连接到运行时数据库记录，用于支撑卡片和详情内容。</p>",
    "        </div>",
    "      </div>",
    "    </section>",
    "  `;",
    "}",
    "",
    "function renderHome(project, items, theme) {",
    "  const leadItem = items[0] || { slug: 'catalog', name: project.title, summary: project.summary, status: 'ready', recordCount: 0, badge: project.database.name || 'ready' };",
    "  return `",
    "    <main class=\"site-shell\">",
    "      <header class=\"topbar\">",
    "        <a class=\"brand\" href=\"./\">${escapeHtml(theme.label)}</a>",
    "        <nav class=\"site-nav\">${renderTopNav(theme, 'home', leadItem)}</nav>",
    "        <a class=\"topbar-link\" href=\"./catalog.html\">开始浏览</a>",
    "      </header>",
    "      ${renderHero(project, theme, leadItem)}",
    "      ${renderChipRow(theme)}",
    "      ${renderCatalog(items)}",
    "      ${renderTimeline(items)}",
    "      ${renderInsightPanel(project)}",
    "    </main>",
    "  `;",
    "}",
    "",
    "function renderCatalogPage(project, items, theme) {",
    "  return `",
    "    <main class=\"site-shell\">",
    "      <header class=\"topbar compact\">",
    "        <a class=\"brand\" href=\"./\">${escapeHtml(theme.label)}</a>",
    "        <nav class=\"site-nav\">${renderTopNav(theme, 'catalog', items[0])}</nav>",
    "        <a class=\"topbar-link\" href=\"./\">返回首页</a>",
    "      </header>",
    "      <section class=\"page-header\">",
    "        <p class=\"section-eyebrow\">片单浏览</p>",
    "        <h1>${escapeHtml(project.title)} 内容索引</h1>",
    "        <p>${escapeHtml(project.summary)}</p>",
    "      </section>",
    "      ${renderCatalog(items)}",
    "    </main>",
    "  `;",
    "}",
    "",
    "function renderDetailPage(project, item, theme) {",
    "  const criteria = item.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join('');",
    "  const records = item.records.length",
    "    ? item.records.map((record) => `",
    "        <article class=\"detail-record\">",
    "          <div>",
    "            <h3>${escapeHtml(record.title)}</h3>",
    "            <p>${escapeHtml(record.status)}</p>",
    "          </div>",
    "          <div class=\"timeline-tags\">${(record.actions || []).map((action) => `<span>${escapeHtml(action)}</span>`).join('')}</div>",
    "        </article>",
    "      `).join('')",
    "    : '<p class=\"empty-copy\">当前还没有额外记录。</p>';",
    "  return `",
    "    <main class=\"site-shell\">",
    "      <header class=\"topbar compact\">",
    "        <a class=\"brand\" href=\"./\">${escapeHtml(theme.label)}</a>",
    "        <nav class=\"site-nav\">${renderTopNav(theme, 'detail', item)}</nav>",
    "        <a class=\"topbar-link\" href=\"./catalog.html\">返回浏览</a>",
    "      </header>",
    "      <section class=\"detail-hero\">",
    "        <div class=\"detail-copy\">",
    "          <p class=\"section-eyebrow\">详情页</p>",
    "          <h1>${escapeHtml(item.name)}</h1>",
    "          <p>${escapeHtml(item.summary)}</p>",
    "          <div class=\"timeline-tags\">${item.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join('')}</div>",
    "        </div>",
    "        <div class=\"detail-summary\">",
    "          <p><strong>当前状态：</strong>${escapeHtml(item.status)}</p>",
    "          <p><strong>记录数量：</strong>${item.recordCount}</p>",
    "          <p><strong>来源标签：</strong>${escapeHtml(item.badge)}</p>",
    "        </div>",
    "      </section>",
    "      <section class=\"detail-layout\">",
    "        <section class=\"detail-panel\">",
    "          <div class=\"section-head\"><div><p class=\"section-eyebrow\">实现边界</p><h2>当前功能要求</h2></div></div>",
    "          <ul class=\"detail-list\">${criteria}</ul>",
    "        </section>",
    "        <section class=\"detail-panel\">",
    "          <div class=\"section-head\"><div><p class=\"section-eyebrow\">运行数据</p><h2>当前数据库内容</h2></div></div>",
    "          <div class=\"detail-records\">${records}</div>",
    "        </section>",
    "      </section>",
    "    </main>",
    "  `;",
    "}",
    "",
    "function renderProject(project, features) {",
    "  const theme = inferTheme(project);",
    "  const items = toShowcaseItems(project, features);",
    "  const view = getCurrentView(items);",
    "  if (view.page === 'catalog') {",
    "    root.innerHTML = renderCatalogPage(project, items, theme);",
    "    return;",
    "  }",
    "  if (view.page === 'detail' && view.item) {",
    "    root.innerHTML = renderDetailPage(project, view.item, theme);",
    "    return;",
    "  }",
    "  root.innerHTML = renderHome(project, items, theme);",
    "}",
    "",
    "let cachedPayload = null;",
    "",
    "async function main() {",
    "  try {",
    "    if (!cachedPayload) {",
    "      const [project, featuresPayload] = await Promise.all([",
    "        loadJson('/api/project'),",
    "        loadJson('/api/features'),",
    "      ]);",
    "      cachedPayload = { project, features: featuresPayload.features };",
    "    }",
    "    renderProject(cachedPayload.project, cachedPayload.features);",
    "  } catch (error) {",
    "    root.innerHTML = `<main class=\"site-shell\"><section class=\"error-panel\"><h1>网站启动失败</h1><p>${String(error)}</p></section></main>`;",
    "  }",
    "}",
    "",
    "if ((document.body.dataset.page || 'home') === 'home') {",
    "  window.addEventListener('hashchange', () => {",
    "    void main();",
    "  });",
    "}",
    "",
    "main();",
    "",
  ].join("\n");
}

function buildBrowserStyles(): string {
  return [
    ":root {",
    "  --bg: #0f1724;",
    "  --surface: #131d2c;",
    "  --surface-2: #18263a;",
    "  --panel: #f7f8fb;",
    "  --line: #22324b;",
    "  --line-light: #dbe4f0;",
    "  --text: #e8edf6;",
    "  --text-dark: #152033;",
    "  --muted: #97a7bf;",
    "  --muted-dark: #607086;",
    "  --primary: #7dd3fc;",
    "  --accent: #f59e0b;",
    "}",
    "* { box-sizing: border-box; }",
    "body {",
    "  margin: 0;",
    "  background: var(--bg);",
    "  color: var(--text);",
    "  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", sans-serif;",
    "}",
    "a { color: inherit; text-decoration: none; }",
    "button { font: inherit; }",
    ".site-shell {",
    "  max-width: 1240px;",
    "  margin: 0 auto;",
    "  padding: 24px 20px 64px;",
    "}",
    ".topbar {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 18px;",
    "  padding: 18px 0 24px;",
    "}",
    ".topbar.compact { padding-bottom: 18px; }",
    ".brand {",
    "  font-size: 18px;",
    "  font-weight: 700;",
    "  letter-spacing: 0.04em;",
    "}",
    ".site-nav {",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 10px;",
    "  flex-wrap: wrap;",
    "}",
    ".site-nav-link, .topbar-link {",
    "  border: 1px solid var(--line);",
    "  color: var(--muted);",
    "  border-radius: 999px;",
    "  padding: 10px 14px;",
    "  background: rgba(255, 255, 255, 0.02);",
    "}",
    ".site-nav-link.is-active, .topbar-link {",
    "  color: var(--text);",
    "  border-color: var(--primary);",
    "}",
    ".hero-banner, .section-block, .detail-hero, .detail-panel, .page-header, .error-panel {",
    "  border: 1px solid var(--line);",
    "  background: linear-gradient(180deg, rgba(24,38,58,0.98), rgba(15,23,36,0.98));",
    "  border-radius: 28px;",
    "}",
    ".hero-banner {",
    "  display: grid;",
    "  grid-template-columns: 1fr 0.9fr;",
    "  gap: 28px;",
    "  padding: 32px;",
    "}",
    ".hero-kicker, .section-eyebrow {",
    "  margin: 0 0 10px;",
    "  color: var(--primary);",
    "  font-size: 12px;",
    "  font-weight: 700;",
    "  letter-spacing: 0.08em;",
    "  text-transform: uppercase;",
    "}",
    ".hero-copy h1, .page-header h1, .detail-copy h1 {",
    "  margin: 0;",
    "  font-size: clamp(36px, 5vw, 56px);",
    "  line-height: 1.05;",
    "}",
    ".hero-summary, .hero-lead, .page-header p, .detail-copy p {",
    "  margin: 16px 0 0;",
    "  color: var(--muted);",
    "  line-height: 1.8;",
    "}",
    ".hero-actions {",
    "  display: flex;",
    "  flex-wrap: wrap;",
    "  gap: 12px;",
    "  margin-top: 24px;",
    "}",
    ".hero-primary, .hero-secondary, .chip, .card-link {",
    "  border: 1px solid var(--line);",
    "  border-radius: 999px;",
    "  padding: 12px 18px;",
    "}",
    ".hero-primary {",
    "  background: var(--panel);",
    "  color: var(--text-dark);",
    "  border-color: var(--panel);",
    "}",
    ".hero-secondary, .chip, .card-link {",
    "  color: var(--text);",
    "  background: transparent;",
    "}",
    ".hero-spotlight { display: grid; align-items: stretch; }",
    ".spotlight-card, .insight-card, .anime-card, .timeline-item, .detail-record, .detail-summary {",
    "  border: 1px solid var(--line);",
    "  border-radius: 22px;",
    "  background: rgba(255, 255, 255, 0.03);",
    "}",
    ".spotlight-card { padding: 24px; display: grid; gap: 14px; }",
    ".spotlight-label, .anime-badge { margin: 0; color: var(--primary); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".spotlight-card h2, .section-head h2, .anime-card h3, .timeline-copy h3, .detail-record h3 { margin: 0; }",
    ".spotlight-card p { margin: 0; color: var(--muted); line-height: 1.7; }",
    ".spotlight-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }",
    ".spotlight-meta div { padding: 12px 14px; border: 1px solid var(--line); border-radius: 16px; }",
    ".spotlight-meta dt { color: var(--muted); font-size: 12px; margin-bottom: 6px; }",
    ".spotlight-meta dd { margin: 0; font-weight: 700; }",
    ".chip-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0 0; }",
    ".chip.is-selected { background: rgba(125, 211, 252, 0.12); border-color: var(--primary); color: var(--text); }",
    ".section-block, .page-header, .detail-panel, .detail-hero { margin-top: 24px; padding: 24px; }",
    ".section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }",
    ".text-link { color: var(--primary); }",
    ".catalog-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }",
    ".anime-card { overflow: hidden; }",
    ".poster-shell { position: relative; padding: 16px 16px 0; }",
    ".poster-rank { position: absolute; top: 20px; left: 20px; z-index: 1; width: 38px; height: 38px; border-radius: 999px; display: grid; place-items: center; background: rgba(15,23,36,0.82); border: 1px solid var(--line); font-weight: 700; }",
    ".poster-art { min-height: 220px; border-radius: 20px; background: linear-gradient(135deg, rgba(125,211,252,0.16), rgba(245,158,11,0.12)); border: 1px solid rgba(255,255,255,0.08); display: grid; place-items: center; color: var(--text); font-size: 22px; font-weight: 700; letter-spacing: 0.06em; }",
    ".anime-card-body { padding: 18px; display: grid; gap: 14px; }",
    ".anime-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }",
    ".status-pill { border-radius: 999px; padding: 8px 12px; background: rgba(125,211,252,0.12); color: var(--primary); font-size: 12px; font-weight: 700; }",
    ".anime-copy { margin: 0; color: var(--muted); line-height: 1.7; min-height: 56px; }",
    ".anime-actions { display: flex; justify-content: space-between; gap: 12px; align-items: center; }",
    ".record-meta { color: var(--muted); font-size: 13px; }",
    ".section-split { display: grid; grid-template-columns: 0.32fr 1fr; gap: 24px; align-items: start; }",
    ".timeline-list { display: grid; gap: 14px; }",
    ".timeline-item, .detail-record { display: grid; grid-template-columns: auto 1fr; gap: 16px; padding: 18px; }",
    ".timeline-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--accent); margin-top: 10px; }",
    ".timeline-copy p, .detail-record p { margin: 8px 0 0; color: var(--muted); line-height: 1.7; }",
    ".timeline-tags { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }",
    ".timeline-tags span { border-radius: 999px; padding: 8px 12px; border: 1px solid var(--line); color: var(--muted); }",
    ".insight-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }",
    ".insight-card { padding: 20px; }",
    ".insight-card span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 8px; }",
    ".insight-card strong { display: block; font-size: 24px; line-height: 1.35; }",
    ".insight-card p { margin: 12px 0 0; color: var(--muted); line-height: 1.7; }",
    ".detail-hero { display: grid; grid-template-columns: 1fr 0.44fr; gap: 24px; }",
    ".detail-summary { padding: 20px; display: grid; gap: 12px; }",
    ".detail-summary p { margin: 0; color: var(--muted); line-height: 1.7; }",
    ".detail-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }",
    ".detail-list { margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.9; }",
    ".detail-records { display: grid; gap: 14px; }",
    ".empty-copy { margin: 0; color: var(--muted); }",
    ".error-panel { padding: 28px; color: #fecaca; }",
    "@media (max-width: 980px) {",
    "  .hero-banner, .section-split, .detail-hero, .detail-layout, .catalog-grid, .insight-grid { grid-template-columns: 1fr; }",
    "  .topbar { flex-direction: column; align-items: flex-start; }",
    "  .spotlight-meta { grid-template-columns: 1fr; }",
    "  .anime-actions { align-items: flex-start; flex-direction: column; }",
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
