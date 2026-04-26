// 这个文件封装 Stitch 的调用细节。
// orchestrator 只关心“提交设计、轮询状态、下载产物”，不需要了解底层 SDK 细节。
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Stitch, StitchToolClient } from "@google/stitch-sdk";

import {
  hasRealStitchCredentials,
  readStitchRuntimeEnv,
  type StitchDeviceType,
  type StitchModelId,
} from "../config/env.js";
import { configureNodeHttpProxy } from "../config/proxy.js";

// StitchClient 是“生成 UI”这一步的执行层抽象。
// orchestrator 只关心 submit / getStatus / downloadResult 这三个动作。
export type StitchJobStatus = "queued" | "running" | "completed" | "failed";

export interface StitchSubmission {
  // stitchJobId 是 orchestrator 后续轮询状态时用的主键。
  stitchJobId: string;
  projectId?: string;
  screenId?: string;
  runtime: "real" | "mock";
  note?: string;
}

export interface StitchDownloadResult {
  // downloadPath 统一表示“当前阶段最主要的可消费产物路径”。
  downloadPath: string;
  htmlPath?: string;
  imagePath?: string;
  metadataPath?: string;
  screens?: Array<{
    order: number;
    screenId: string;
    htmlPath?: string;
    imagePath?: string;
  }>;
  note?: string;
}

export interface StitchClient {
  submit(prompt: string): Promise<StitchSubmission>;
  getStatus(stitchJobId: string): Promise<StitchJobStatus>;
  downloadResult(stitchJobId: string, targetDir: string): Promise<StitchDownloadResult>;
}

interface MockStitchRecord {
  prompt: string;
  polls: number;
}

interface RealStitchClientOptions {
  apiKey?: string;
  accessToken?: string;
  googleCloudProject?: string;
  projectId?: string;
  baseUrl?: string;
  timeoutMs: number;
  deviceType: StitchDeviceType;
  modelId?: StitchModelId;
}

interface RealStitchRecord {
  prompt: string;
  status: StitchJobStatus;
  projectId?: string;
  screenId?: string;
  htmlUrl?: string;
  imageUrl?: string;
}

export class MockStitchClient implements StitchClient {
  private readonly jobs = new Map<string, MockStitchRecord>();

  constructor(private readonly note?: string) {}

  async submit(prompt: string): Promise<StitchSubmission> {
    // mock 模式下只记录 prompt，不会真的请求 Stitch。
    const stitchJobId = `stitch-${randomUUID()}`;
    this.jobs.set(stitchJobId, { prompt, polls: 0 });
    return { stitchJobId, runtime: "mock", note: this.note };
  }

  async getStatus(stitchJobId: string): Promise<StitchJobStatus> {
    const job = this.jobs.get(stitchJobId);
    if (!job) {
      throw new Error(`Unknown Stitch job: ${stitchJobId}`);
    }

    job.polls += 1;

    if (job.polls === 1) {
      return "queued";
    }

    if (job.polls === 2) {
      return "running";
    }

    return "completed";
  }

  async downloadResult(stitchJobId: string, targetDir: string): Promise<StitchDownloadResult> {
    const job = this.jobs.get(stitchJobId);
    if (!job) {
      throw new Error(`Unknown Stitch job: ${stitchJobId}`);
    }

    await mkdir(targetDir, { recursive: true });

    const htmlPath = path.join(targetDir, `${stitchJobId}.html`);
    const imagePath = path.join(targetDir, `${stitchJobId}.png`);
    const metadataPath = path.join(targetDir, `${stitchJobId}.json`);
    const mockHtml = [
      "<!doctype html>",
      "<html lang=\"en\">",
      "  <head>",
      "    <meta charset=\"utf-8\" />",
      `    <title>${stitchJobId}</title>`,
      "  </head>",
      "  <body>",
      "    <main>",
      "      <h1>Mock Stitch UI Result</h1>",
      `      <pre>${job.prompt}</pre>`,
      "    </main>",
      "  </body>",
      "</html>",
    ].join("\n");

    // mock 产物格式尽量和真实 Stitch 保持一致，
    // 这样 orchestrator 就不用区分两套流程。
    await writeFile(htmlPath, mockHtml, "utf8");
    await writeFile(imagePath, ONE_PIXEL_PNG);
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          runtime: "mock",
          stitchJobId,
          prompt: job.prompt,
          htmlPath,
          imagePath,
          note: this.note,
        },
        null,
        2,
      ),
      "utf8",
    );

    return {
      downloadPath: imagePath,
      htmlPath,
      imagePath,
      metadataPath,
      screens: [
        {
          order: 1,
          screenId: stitchJobId,
          htmlPath,
          imagePath,
        },
      ],
      note: this.note,
    };
  }
}

export class RealStitchClient implements StitchClient {
  private readonly sdk: Stitch;
  private readonly jobs = new Map<string, RealStitchRecord>();

  constructor(private readonly options: RealStitchClientOptions) {
    // 这里通过官方 Stitch SDK 创建真实客户端。
    const client = new StitchToolClient({
      apiKey: options.apiKey,
      accessToken: options.accessToken,
      projectId: options.googleCloudProject,
      baseUrl: options.baseUrl,
      timeout: options.timeoutMs,
    });

    this.sdk = new Stitch(client);
  }

  async submit(prompt: string): Promise<StitchSubmission> {
    // 真实模式下，submit 会真正去创建项目/生成 screen。
    const stitchJobId = `stitch-${randomUUID()}`;
    this.jobs.set(stitchJobId, { prompt, status: "queued" });

    try {
      const project = await this.resolveProject(prompt);
      this.jobs.set(stitchJobId, {
        prompt,
        status: "running",
        projectId: project.projectId,
      });

      const screen = await project.generate(prompt, this.options.deviceType, this.options.modelId);
      const [htmlUrl, imageUrl] = await Promise.all([screen.getHtml(), screen.getImage()]);

      this.jobs.set(stitchJobId, {
        prompt,
        status: "completed",
        projectId: project.projectId,
        screenId: screen.screenId,
        htmlUrl,
        imageUrl,
      });

      return {
        stitchJobId,
        projectId: project.projectId,
        screenId: screen.screenId,
        runtime: "real",
      };
    } catch (error) {
      this.jobs.set(stitchJobId, {
        prompt,
        status: "failed",
      });
      throw new Error(`Stitch submission failed: ${formatError(error)}`);
    }
  }

  async getStatus(stitchJobId: string): Promise<StitchJobStatus> {
    // 真实模式下，这里直接读取本地缓存的状态；
    // 当前 demo 把 submit 设计成同步完成生成，所以状态转换已经在 submit 里发生。
    return this.requireJob(stitchJobId).status;
  }

  async downloadResult(stitchJobId: string, targetDir: string): Promise<StitchDownloadResult> {
    const job = this.requireJob(stitchJobId);
    if (job.status !== "completed" || !job.htmlUrl || !job.imageUrl) {
      throw new Error(`Stitch job ${stitchJobId} is not ready for download.`);
    }

    await mkdir(targetDir, { recursive: true });
    const screensDir = path.join(targetDir, "screens");
    await mkdir(screensDir, { recursive: true });

    const project = job.projectId ? this.sdk.project(job.projectId) : undefined;
    const discoveredScreens = project ? await project.screens().catch(() => []) : [];
    const orderedScreens = sortScreensWithPrimaryFirst(discoveredScreens, job.screenId);
    const downloadedScreens =
      orderedScreens.length > 0
        ? await Promise.all(
            orderedScreens.map(async (screen, index) => {
              const [htmlUrl, imageUrl] = await Promise.all([
                screen.screenId === job.screenId && job.htmlUrl ? job.htmlUrl : screen.getHtml(),
                screen.screenId === job.screenId && job.imageUrl ? job.imageUrl : screen.getImage(),
              ]);
              const baseName = `${String(index + 1).padStart(2, "0")}-${sanitizeArtifactName(screen.screenId)}`;
              const htmlPath = await downloadUrlToDirectory(htmlUrl, screensDir, `${baseName}.html`);
              const imagePath = await downloadUrlToDirectory(imageUrl, screensDir, `${baseName}.png`);
              return {
                order: index + 1,
                screenId: screen.screenId,
                htmlPath,
                imagePath,
              };
            }),
          )
        : [
            {
              order: 1,
              screenId: job.screenId ?? stitchJobId,
              htmlPath: await downloadUrlToDirectory(
                job.htmlUrl,
                screensDir,
                `01-${sanitizeArtifactName(job.screenId ?? stitchJobId)}.html`,
              ),
              imagePath: await downloadUrlToDirectory(
                job.imageUrl,
                screensDir,
                `01-${sanitizeArtifactName(job.screenId ?? stitchJobId)}.png`,
              ),
            },
          ];

    const primaryScreen = downloadedScreens[0];
    const htmlPath = primaryScreen.htmlPath;
    const imagePath = primaryScreen.imagePath;
    const metadataBaseName = sanitizeArtifactName(primaryScreen.screenId);
    const metadataPath = path.join(targetDir, `${metadataBaseName}.json`);

    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          runtime: "real",
          stitchJobId,
          projectId: job.projectId,
          screenId: job.screenId,
          htmlUrl: job.htmlUrl,
          imageUrl: job.imageUrl,
          htmlPath,
          imagePath,
          screens: downloadedScreens,
        },
        null,
        2,
      ),
      "utf8",
    );

    return {
      downloadPath: imagePath,
      htmlPath,
      imagePath,
      metadataPath,
      screens: downloadedScreens,
    };
  }

  private async resolveProject(prompt: string) {
    // 如果配置了 projectId，就复用它；否则为当前需求创建一个新项目。
    if (this.options.projectId) {
      return this.sdk.project(this.options.projectId);
    }

    return this.sdk.createProject(deriveProjectTitle(prompt));
  }

  private requireJob(stitchJobId: string): RealStitchRecord {
    const job = this.jobs.get(stitchJobId);
    if (!job) {
      throw new Error(`Unknown Stitch job: ${stitchJobId}`);
    }

    return job;
  }
}

// FallbackStitchClient 负责“真实 Stitch 优先，失败就降级到 mock”。
// 这样即使网络、权限或外部服务暂时不可用，主流程也仍然能继续演示。
export class FallbackStitchClient implements StitchClient {
  private readonly fallbackReasons = new Map<string, string>();

  constructor(
    private readonly primary: StitchClient,
    private readonly fallback: StitchClient,
  ) {}

  async submit(prompt: string): Promise<StitchSubmission> {
    // 优先尝试真实 Stitch；失败时自动降级为 mock，保证主流程不中断。
    try {
      return await this.primary.submit(prompt);
    } catch (error) {
      const reason = `Real Stitch unavailable, fell back to mock output: ${formatError(error)}`;
      const submission = await this.fallback.submit(prompt);
      this.fallbackReasons.set(submission.stitchJobId, reason);
      return {
        ...submission,
        note: reason,
      };
    }
  }

  async getStatus(stitchJobId: string): Promise<StitchJobStatus> {
    if (this.fallbackReasons.has(stitchJobId)) {
      return this.fallback.getStatus(stitchJobId);
    }

    return this.primary.getStatus(stitchJobId);
  }

  async downloadResult(stitchJobId: string, targetDir: string): Promise<StitchDownloadResult> {
    if (this.fallbackReasons.has(stitchJobId)) {
      const result = await this.fallback.downloadResult(stitchJobId, targetDir);
      const note = this.fallbackReasons.get(stitchJobId);

      if (note && result.metadataPath) {
        await appendNoteToMetadata(result.metadataPath, note);
      }

      return {
        ...result,
        note,
      };
    }

    return this.primary.downloadResult(stitchJobId, targetDir);
  }
}

export function createStitchClientFromEnv(): StitchClient {
  // 这里是 Stitch 客户端的统一工厂：
  // 有真实凭证就走“真实 + fallback”，没有就直接走 mock。
  const env = readStitchRuntimeEnv();

  if (hasRealStitchCredentials(env)) {
    // 真实 Stitch 需要先把 Node 代理配置好，
    // 否则在某些环境里即使系统代理可用，SDK 也可能直连超时。
    configureNodeHttpProxy();

    return new FallbackStitchClient(
      new RealStitchClient({
        apiKey: env.apiKey,
        accessToken: env.accessToken,
        googleCloudProject: env.googleCloudProject,
        projectId: env.projectId,
        baseUrl: env.baseUrl,
        timeoutMs: env.timeoutMs,
        deviceType: env.deviceType,
        modelId: env.modelId,
      }),
      new MockStitchClient(),
    );
  }

  return new MockStitchClient(
    "Real Stitch credentials were not detected for this run, so the workflow used mock UI output only.",
  );
}

// 给 metadata 追加降级说明，方便后面排查为什么这次不是走的真实 Stitch。
async function appendNoteToMetadata(metadataPath: string, note: string): Promise<void> {
  const payload = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  payload.note = note;
  await writeFile(metadataPath, JSON.stringify(payload, null, 2), "utf8");
}

// 从 Stitch 返回的下载链接里把文件真正拉到本地目录。
async function downloadUrlToDirectory(
  url: string,
  targetDir: string,
  fallbackFileName: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Stitch artifact: ${response.status} ${response.statusText}`);
  }

  const extension = extensionFromResponse(url, response.headers.get("content-type"));
  const parsedFallback = path.parse(fallbackFileName);
  const finalPath = path.join(targetDir, `${parsedFallback.name}${extension ?? parsedFallback.ext}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(finalPath, bytes);
  return finalPath;
}

// 尝试根据响应头或 URL 猜测文件后缀，避免保存成错误扩展名。
function extensionFromResponse(url: string, contentType: string | null): string | undefined {
  if (contentType?.includes("text/html")) {
    return ".html";
  }

  if (contentType?.includes("image/png")) {
    return ".png";
  }

  if (contentType?.includes("image/jpeg")) {
    return ".jpg";
  }

  if (contentType?.includes("image/webp")) {
    return ".webp";
  }

  const pathname = new URL(url).pathname;
  const extension = path.extname(pathname);
  return extension || undefined;
}

function sortScreensWithPrimaryFirst(
  screens: Array<{
    screenId: string;
    getHtml(): Promise<string>;
    getImage(): Promise<string>;
  }>,
  primaryScreenId: string | undefined,
) {
  if (!primaryScreenId) {
    return screens;
  }

  return [...screens].sort((left, right) => {
    if (left.screenId === primaryScreenId) {
      return -1;
    }
    if (right.screenId === primaryScreenId) {
      return 1;
    }
    return 0;
  });
}

// 用 prompt 的第一行生成一个项目标题。
function deriveProjectTitle(prompt: string): string {
  const title = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return title ? title.slice(0, 80) : `UI-SE ${new Date().toISOString().slice(0, 10)}`;
}

// 清理文件名，避免非法字符写进本地路径。
function sanitizeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "-");
}

// 把未知异常转成更适合写日志的文本。
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// mock 模式下的截图占位图，保证生成出来的文件真的是 PNG。
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6HprQAAAAASUVORK5CYII=",
  "base64",
);
