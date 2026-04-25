import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Stitch, StitchToolClient } from "@google/stitch-sdk";

import {
  hasRealStitchCredentials,
  readStitchRuntimeEnv,
  type StitchDeviceType,
  type StitchModelId,
} from "../config/env.js";

export type StitchJobStatus = "queued" | "running" | "completed" | "failed";

export interface StitchSubmission {
  stitchJobId: string;
  projectId?: string;
  screenId?: string;
  runtime: "real" | "mock";
}

export interface StitchDownloadResult {
  downloadPath: string;
  htmlPath?: string;
  imagePath?: string;
  metadataPath?: string;
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

  async submit(prompt: string): Promise<StitchSubmission> {
    const stitchJobId = `stitch-${randomUUID()}`;
    this.jobs.set(stitchJobId, { prompt, polls: 0 });
    return { stitchJobId, runtime: "mock" };
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

    // The mock client keeps the same artifact shape as the real client so the
    // rest of the workflow can switch between both modes without branching.
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
    };
  }
}

export class RealStitchClient implements StitchClient {
  private readonly sdk: Stitch;
  private readonly jobs = new Map<string, RealStitchRecord>();

  constructor(private readonly options: RealStitchClientOptions) {
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
    return this.requireJob(stitchJobId).status;
  }

  async downloadResult(stitchJobId: string, targetDir: string): Promise<StitchDownloadResult> {
    const job = this.requireJob(stitchJobId);
    if (job.status !== "completed" || !job.htmlUrl || !job.imageUrl) {
      throw new Error(`Stitch job ${stitchJobId} is not ready for download.`);
    }

    await mkdir(targetDir, { recursive: true });

    const baseName = sanitizeArtifactName(job.screenId ?? stitchJobId);
    const htmlPath = await downloadUrlToDirectory(job.htmlUrl, targetDir, `${baseName}.html`);
    const imagePath = await downloadUrlToDirectory(job.imageUrl, targetDir, `${baseName}.png`);
    const metadataPath = path.join(targetDir, `${baseName}.json`);

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
    };
  }

  private async resolveProject(prompt: string) {
    if (this.options.projectId) {
      return this.sdk.project(this.options.projectId);
    }

    // Each generated requirement can create an isolated Stitch project unless
    // the caller explicitly chooses to reuse a known project ID.
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

export function createStitchClientFromEnv(): StitchClient {
  const env = readStitchRuntimeEnv();

  if (hasRealStitchCredentials(env)) {
    return new RealStitchClient({
      apiKey: env.apiKey,
      accessToken: env.accessToken,
      googleCloudProject: env.googleCloudProject,
      projectId: env.projectId,
      baseUrl: env.baseUrl,
      timeoutMs: env.timeoutMs,
      deviceType: env.deviceType,
      modelId: env.modelId,
    });
  }

  return new MockStitchClient();
}

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

function deriveProjectTitle(prompt: string): string {
  const title = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return title ? title.slice(0, 80) : `UI-SE ${new Date().toISOString().slice(0, 10)}`;
}

function sanitizeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "-");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6HprQAAAAASUVORK5CYII=",
  "base64",
);
