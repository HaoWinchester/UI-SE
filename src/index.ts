import { readFile } from "node:fs/promises";
import path from "node:path";

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
  showHelp: boolean;
}

interface RequirementInput {
  rawRequirement: string;
  sourceLabel: string;
}

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd());
  const cliOptions = parseCliArgs(process.argv.slice(2), workspaceRoot);
  if (cliOptions.showHelp) {
    printHelp();
    return;
  }

  // 需求优先从 requirement.md 或 --file 指定的文件里读取，
  // 这样演示时就不需要再去手改源码。
  const requirementInput = await loadRequirementInput(cliOptions, workspaceRoot);

  // 创建总调度器。后面所有 agent、测试、部署、Stitch 调用都由它统一安排。
  const orchestrator = createDefaultOrchestrator(workspaceRoot);

  // 第一步：根据原始需求创建一个 job，并先生成结构化 spec。
  const job = await orchestrator.createJob(requirementInput.rawRequirement);
  // 第二步：正式运行整条工作流。
  const result = await orchestrator.run(job.id);

  // 把最终结果打印到终端，方便观察这次任务跑到了哪里。
  console.log(`Requirement source: ${requirementInput.sourceLabel}`);
  console.log(`Job: ${result.id}`);
  console.log(`Stage: ${result.stage}`);
  console.log(`Features: ${result.requirement.features.length}`);
  console.log(`Agent runs: ${result.agentRuns.length}`);
  console.log(`Open bugs: ${result.bugReports.filter((bug) => bug.status === "open").length}`);
  console.log(`UI artifact runtime: ${result.uiArtifact?.runtime ?? "none"}`);
  if (result.uiArtifact?.note) {
    console.log(`UI note: ${result.uiArtifact.note}`);
  }
  console.log(`UI image: ${result.uiArtifact?.imagePath ?? result.uiArtifact?.downloadPath ?? "none"}`);
  console.log(`UI html: ${result.uiArtifact?.htmlPath ?? "none"}`);
  console.log(`Deployment: ${result.deployment?.manifestPath ?? "not deployed"}`);
}

// 解析命令行参数，当前支持：
// `--file path/to/requirement.md`
// `--help`
function parseCliArgs(args: string[], workspaceRoot: string): CliOptions {
  const options: CliOptions = {
    showHelp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.showHelp = true;
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

// 读取需求输入：
// 1. 先读 --file
// 2. 再读项目根目录下默认的 requirement.md
// 3. 最后才回退到内置演示需求
async function loadRequirementInput(
  cliOptions: CliOptions,
  workspaceRoot: string,
): Promise<RequirementInput> {
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

// 读取 markdown 需求文件，并确保内容不是空字符串。
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

// 帮你快速查看 CLI 用法，适合演示时现场提示。
function printHelp(): void {
  console.log("Usage:");
  console.log("  npm run dev");
  console.log("  npm run dev -- --file ./requirement.md");
  console.log("");
  console.log("Behavior:");
  console.log("  1. Read the file passed through --file when provided.");
  console.log(`  2. Otherwise read ${DEFAULT_REQUIREMENT_FILE} from the project root when it exists.`);
  console.log("  3. Finally fall back to the built-in demo requirement when no file exists.");
}

// 统一兜底错误，避免异常直接静默退出。
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
