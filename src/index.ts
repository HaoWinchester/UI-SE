// 这个文件是命令行入口。
// 用户从这里输入一句话需求，随后整个 orchestrator 流程会被启动。
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { UiArtifact } from "./types/domain.js";
import type {
  OrchestratorRuntimeHooks,
  ReleaseApprovalDecision,
  ReleaseApprovalRequest,
  UiApprovalDecision,
  UiApprovalRequest,
} from "./workflow/orchestrator.js";
import { createDefaultOrchestrator } from "./workflow/orchestrator.js";

const DEFAULT_REQUIREMENT_FILE = "requirement.md";
const FALLBACK_REQUIREMENT = `
Build a delivery workflow for an AI-assisted product team.
- Generate an initial UI draft from an approved requirement through Stitch.
- Implement one feature at a time in frontend and backend.
- Run automated tests after each feature and enter a fix loop when tests fail.
- Verify the final implementation still matches the approved requirement.
- Deploy the accepted build to staging.
`.trim();

interface CliOptions {
  requirementFilePath?: string;
  inlinePrompt?: string;
  autoApprove: boolean;
  autoOpenPreview: boolean;
  showHelp: boolean;
}

interface RequirementInput {
  rawRequirement: string;
  sourceLabel: string;
}

interface InteractionHooks extends OrchestratorRuntimeHooks {
  close: () => void;
}

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd());
  const cliOptions = parseCliArgs(process.argv.slice(2), workspaceRoot);
  if (cliOptions.showHelp) {
    printHelp();
    return;
  }

  const requirementInput = await loadRequirementInput(cliOptions, workspaceRoot);
  const interactionHooks = createInteractionHooks(cliOptions);

  try {
    const orchestrator = createDefaultOrchestrator(workspaceRoot, {
      onProgress: createConsoleProgressLogger(),
      requestUiApproval: interactionHooks.requestUiApproval,
      requestReleaseApproval: interactionHooks.requestReleaseApproval,
    });

    console.log(`已接收需求输入，来源：${requirementInput.sourceLabel}`);

    const job = await orchestrator.createJob(requirementInput.rawRequirement);
    const result = await orchestrator.run(job.id);

    console.log(`Requirement source: ${requirementInput.sourceLabel}`);
    console.log(`Job: ${result.id}`);
    console.log(`Stage: ${result.stage}`);
    console.log(`Spec: ${result.specArtifact?.markdownPath ?? "none"}`);
    console.log(`Clarifications: ${result.requirement.clarifications.length}`);
    console.log(`Features: ${result.requirement.features.length}`);
    console.log(`UI versions: ${result.uiArtifacts.length}`);
    console.log(`Selected UI version: ${result.uiArtifact?.versionNumber ?? "none"}`);
    console.log(`Agent runs: ${result.agentRuns.length}`);
    console.log(`Open bugs: ${result.bugReports.filter((bug) => bug.status === "open").length}`);
    console.log(`Workflow log: ${path.join(workspaceRoot, result.logFilePath)}`);
    console.log(`Alignment reports: ${result.alignmentReports.length}`);
    console.log(`Code workspace: ${path.join(workspaceRoot, result.codeWorkspace.rootDir)}`);
    console.log(
      `Generated code files: ${result.requirement.features.reduce((total, feature) => total + feature.generatedFiles.length, 0)}`,
    );
    console.log(`UI artifact runtime: ${result.uiArtifact?.runtime ?? "none"}`);
    if (result.uiArtifact?.note) {
      console.log(`UI note: ${result.uiArtifact.note}`);
    }
    console.log(`UI image: ${result.uiArtifact?.imagePath ?? result.uiArtifact?.downloadPath ?? "none"}`);
    console.log(`UI html: ${result.uiArtifact?.htmlPath ?? "none"}`);
    console.log(`Release approved: ${result.releaseApproval?.approved ?? false}`);
    if (result.releaseApproval?.feedback) {
      console.log(`Release feedback: ${result.releaseApproval.feedback}`);
    }
    console.log(`Deployment: ${result.deployment?.manifestPath ?? "not deployed"}`);
  } finally {
    interactionHooks.close();
  }
}

// 解析命令行参数，当前支持：
// `--prompt "一句话需求"`
// `--file path/to/requirement.md`
// `--yes`
// `--no-open`
// `--help`
function parseCliArgs(args: string[], workspaceRoot: string): CliOptions {
  const options: CliOptions = {
    autoApprove: false,
    autoOpenPreview: true,
    showHelp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.showHelp = true;
      continue;
    }

    if (arg === "--yes") {
      options.autoApprove = true;
      continue;
    }

    if (arg === "--no-open") {
      options.autoOpenPreview = false;
      continue;
    }

    if (arg === "--file") {
      const filePath = args[index + 1];
      if (!filePath || filePath.startsWith("-")) {
        throw new Error("Missing value for --file. Example: npm run dev -- --file ./requirement.md");
      }

      options.requirementFilePath = path.resolve(workspaceRoot, filePath);
      index += 1;
      continue;
    }

    if (arg === "--prompt") {
      const prompt = args[index + 1];
      if (!prompt || prompt.startsWith("-")) {
        throw new Error('Missing value for --prompt. Example: npm run dev -- --prompt "Build a dashboard"');
      }

      options.inlinePrompt = prompt.trim();
      index += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      options.inlinePrompt = args.slice(index).join(" ").trim();
      break;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

// 读取需求输入：
// 1. 先读一句话 prompt
// 2. 再读 --file
// 3. 再读项目根目录下默认的 requirement.md
// 4. 最后才回退到内置演示需求
async function loadRequirementInput(
  cliOptions: CliOptions,
  workspaceRoot: string,
): Promise<RequirementInput> {
  if (cliOptions.inlinePrompt) {
    return {
      rawRequirement: cliOptions.inlinePrompt,
      sourceLabel: "inline prompt",
    };
  }

  if (cliOptions.requirementFilePath) {
    return {
      rawRequirement: await readRequirementFile(cliOptions.requirementFilePath),
      sourceLabel: path.relative(workspaceRoot, cliOptions.requirementFilePath),
    };
  }

  const defaultRequirementPath = path.join(workspaceRoot, DEFAULT_REQUIREMENT_FILE);
  try {
    return {
      rawRequirement: await readRequirementFile(defaultRequirementPath),
      sourceLabel: DEFAULT_REQUIREMENT_FILE,
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    return {
      rawRequirement: FALLBACK_REQUIREMENT,
      sourceLabel: "built-in demo requirement",
    };
  }
}

async function readRequirementFile(filePath: string): Promise<string> {
  const rawRequirement = (await readFile(filePath, "utf8")).trim();
  if (!rawRequirement) {
    throw new Error(`Requirement file is empty: ${filePath}`);
  }

  return rawRequirement;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  npm run dev");
  console.log('  npm run dev -- --prompt "Build a project dashboard"');
  console.log('  npm run dev -- "Build a project dashboard"');
  console.log("  npm run dev -- --file ./requirement.md");
  console.log("  npm run dev -- --yes --no-open");
  console.log("");
  console.log("Behavior:");
  console.log("  1. Read the inline prompt when provided.");
  console.log("  2. Otherwise read the file passed through --file.");
  console.log(`  3. Otherwise read ${DEFAULT_REQUIREMENT_FILE} from the project root when it exists.`);
  console.log("  4. Finally fall back to the built-in demo requirement when no file exists.");
  console.log("  5. Ask whether each generated UI version is acceptable before development.");
  console.log("  6. Ask whether the final preview can be released before deployment.");
  console.log("  7. Use --yes to auto-approve both confirmation steps.");
  console.log("  8. Automatically open previews unless --no-open is provided.");
}

function createConsoleProgressLogger(): (message: string) => void {
  return (message: string) => {
    console.log(`[progress] ${message}`);
  };
}

// 交互层负责把 orchestrator 里的“确认节点”变成终端问答。
function createInteractionHooks(cliOptions: CliOptions): InteractionHooks {
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !cliOptions.autoApprove;
  const rl = interactive ? createInterface({ input, output }) : undefined;

  return {
    requestUiApproval: async (request: UiApprovalRequest): Promise<UiApprovalDecision> => {
      await openPreviewPathIfNeeded(
        request.uiArtifact.htmlPath ?? request.uiArtifact.imagePath ?? request.uiArtifact.downloadPath,
        cliOptions.autoOpenPreview,
        `UI v${request.uiArtifact.versionNumber}`,
      );

      if (!rl) {
        console.log(`[review] 自动通过 UI v${request.uiArtifact.versionNumber}。`);
        return { approved: true };
      }

      console.log("");
      console.log(`当前是第 ${request.uiArtifact.versionNumber} 版 UI。`);
      console.log(`预览目录：${request.uiArtifact.directoryPath}`);
      const answer = (await rl.question("是否满意当前页面设计？(y/n): ")).trim().toLowerCase();
      if (isAffirmative(answer)) {
        return { approved: true };
      }

      const feedback = (await rl.question("请描述需要调整的地方：")).trim();
      return {
        approved: false,
        feedback: feedback || "请重新生成一版明显不同的设计，同时保持需求主线不变。",
      };
    },
    requestReleaseApproval: async (
      request: ReleaseApprovalRequest,
    ): Promise<ReleaseApprovalDecision> => {
      await openPreviewPathIfNeeded(
        request.previewPath,
        cliOptions.autoOpenPreview,
        "final release preview",
      );

      if (!rl) {
        console.log("[review] 自动通过最终预览，允许发布。");
        return { approved: true };
      }

      console.log("");
      console.log(`最终预览路径：${request.previewPath ?? "none"}`);
      const answer = (await rl.question("客户是否满意当前页面并允许发布？(y/n): ")).trim().toLowerCase();
      if (isAffirmative(answer)) {
        return { approved: true };
      }

      const feedback = (await rl.question("请记录客户不满意的原因：")).trim();
      return {
        approved: false,
        feedback: feedback || "客户暂不同意发布，需要继续修改。",
      };
    },
    close: () => {
      rl?.close();
    },
  };
}

function isAffirmative(answer: string): boolean {
  return ["y", "yes", "ok", "true", "1", "是", "满意"].includes(answer);
}

async function openPreviewPathIfNeeded(
  previewPath: string | undefined,
  autoOpenPreview: boolean,
  label: string,
): Promise<void> {
  if (!autoOpenPreview || !previewPath) {
    return;
  }

  const command = resolveOpenCommand(previewPath);
  if (!command) {
    console.log(`Preview: current platform does not support automatically opening ${label}.`);
    return;
  }

  console.log(`Preview: opening ${label} at ${previewPath}`);

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    console.warn(`Preview: failed to open automatically. ${formatError(error)}`);
  }
}

function resolveOpenCommand(targetPath: string):
  | {
      command: string;
      args: string[];
    }
  | undefined {
  if (process.platform === "darwin") {
    return {
      command: "open",
      args: [targetPath],
    };
  }

  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", targetPath],
    };
  }

  if (process.platform === "linux") {
    return {
      command: "xdg-open",
      args: [targetPath],
    };
  }

  return undefined;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
