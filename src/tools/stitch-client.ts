import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type StitchJobStatus = "queued" | "running" | "completed" | "failed";

export interface StitchSubmission {
  stitchJobId: string;
}

export interface StitchClient {
  submit(prompt: string): Promise<StitchSubmission>;
  getStatus(stitchJobId: string): Promise<StitchJobStatus>;
  downloadResult(stitchJobId: string, targetDir: string): Promise<string>;
}

interface MockStitchRecord {
  prompt: string;
  polls: number;
}

export class MockStitchClient implements StitchClient {
  private readonly jobs = new Map<string, MockStitchRecord>();

  async submit(prompt: string): Promise<StitchSubmission> {
    const stitchJobId = `stitch-${randomUUID()}`;
    this.jobs.set(stitchJobId, { prompt, polls: 0 });
    return { stitchJobId };
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

  async downloadResult(stitchJobId: string, targetDir: string): Promise<string> {
    const job = this.jobs.get(stitchJobId);
    if (!job) {
      throw new Error(`Unknown Stitch job: ${stitchJobId}`);
    }

    await mkdir(targetDir, { recursive: true });

    const filePath = path.join(targetDir, `${stitchJobId}.html`);
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

    await writeFile(filePath, mockHtml, "utf8");
    return filePath;
  }
}
