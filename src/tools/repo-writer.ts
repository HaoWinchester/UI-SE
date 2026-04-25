// 这个文件负责把 agent 返回的代码改动真正写进工作区。
// 这样 orchestrator 不需要关心底层文件系统细节，只要把 fileEdits 交给这里即可。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CodeFileEdit, CodeWorkspace } from "../types/domain.js";

export interface RepoWriter {
  ensureWorkspace(workspace: CodeWorkspace): Promise<void>;
  applyFileEdits(edits: CodeFileEdit[]): Promise<string[]>;
}

export class FileSystemRepoWriter implements RepoWriter {
  constructor(private readonly baseDir: string) {}

  async ensureWorkspace(workspace: CodeWorkspace): Promise<void> {
    await Promise.all([
      mkdir(this.toAbsolutePath(workspace.rootDir), { recursive: true }),
      mkdir(path.join(this.toAbsolutePath(workspace.frontendDir), "src", "features"), {
        recursive: true,
      }),
      mkdir(path.join(this.toAbsolutePath(workspace.backendDir), "src", "features"), {
        recursive: true,
      }),
      mkdir(path.join(this.toAbsolutePath(workspace.databaseDir), "src", "features"), {
        recursive: true,
      }),
      mkdir(path.join(this.toAbsolutePath(workspace.databaseDir), "prisma", "migrations"), {
        recursive: true,
      }),
      mkdir(path.join(this.toAbsolutePath(workspace.databaseDir), "prisma", "seeds"), {
        recursive: true,
      }),
      mkdir(this.toAbsolutePath(workspace.testsDir), { recursive: true }),
    ]);

    const readmePath = path.posix.join(workspace.rootDir, "README.md");
    if (await this.fileExists(readmePath)) {
      return;
    }

    await this.applyFileEdits([
      {
        path: readmePath,
        content: [
          "# Generated delivery workspace",
          "",
          "This directory stores generated frontend, backend, database, and test artifacts for a single workflow job.",
          "Files here are produced by the orchestrator and can be replaced on subsequent runs.",
        ].join("\n"),
        description: "Generated workspace introduction",
      },
    ]);
  }

  async applyFileEdits(edits: CodeFileEdit[]): Promise<string[]> {
    const changedFiles: string[] = [];

    for (const edit of edits) {
      const absolutePath = this.toAbsolutePath(edit.path);
      await mkdir(path.dirname(absolutePath), { recursive: true });

      const currentContent = await this.readFileIfExists(edit.path);
      if (currentContent === edit.content) {
        continue;
      }

      await writeFile(absolutePath, edit.content, "utf8");
      changedFiles.push(edit.path);
    }

    return changedFiles;
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    return (await this.readFileIfExists(relativePath)) !== undefined;
  }

  private async readFileIfExists(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(this.toAbsolutePath(relativePath), "utf8");
    } catch {
      return undefined;
    }
  }

  private toAbsolutePath(relativePath: string): string {
    return path.join(this.baseDir, relativePath);
  }
}

// 每个任务都有自己独立的代码工作区，避免不同任务生成的代码互相污染。
export function createCodeWorkspace(jobId: string): CodeWorkspace {
  const rootDir = path.posix.join("artifacts", "code-workspace", jobId);

  return {
    rootDir,
    frontendDir: path.posix.join(rootDir, "frontend"),
    backendDir: path.posix.join(rootDir, "backend"),
    databaseDir: path.posix.join(rootDir, "database"),
    testsDir: path.posix.join(rootDir, "tests"),
  };
}
