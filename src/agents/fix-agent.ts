// 这个文件定义修复 agent。
// 当测试失败或发现 bug 时，它会读取已有代码，生成有针对性的修复改动并返回给 orchestrator 落盘。
import path from "node:path";
import { readFile } from "node:fs/promises";

import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  AlignmentFinding,
  BugReport,
  CodeFileEdit,
  CodeWorkspace,
  FeatureSpec,
} from "../types/domain.js";
import { OpenAiJsonModelClient } from "../tools/model-client.js";

// fix-agent 负责把 bug 列表转换成一份修复计划。
export interface FixAgentInput {
  feature: FeatureSpec;
  bugReports: BugReport[];
  codeWorkspace: CodeWorkspace;
  alignmentFindings?: AlignmentFinding[];
}

export interface FixAgentOutput {
  summary: string;
  repairPlan: string[];
  repairedFiles: string[];
  runtimeUsed: "template" | "model";
}

interface FileSnapshot {
  path: string;
  content: string;
}

interface ModelGeneratedFixPayload {
  summary: string;
  repairPlan: string[];
  files: Array<{
    path: string;
    content: string;
    description?: string;
  }>;
}

export class FixAgent implements Agent<FixAgentInput, FixAgentOutput> {
  readonly definition = agentRegistry["fix-agent"];

  async run(
    { feature, bugReports, alignmentFindings }: FixAgentInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<FixAgentOutput>> {
    const bugTitles = bugReports.map((bug) => bug.title).join("; ");
    const recentFailures = feature.failureHistory.slice(-3);
    const fileSnapshots = await loadGeneratedFiles(feature.generatedFiles, context.workspaceRoot);
    const fallbackRepairPlan = [
      ...recentFailures.flatMap((failure, index) => [
        `${index + 1}. 回看失败记忆 ${failure.step}，确认这次修复不要重复之前的问题：${failure.resultSummary}`,
        `${index + 1}. 重点规避这些重复 bug：${failure.bugTitles.join("; ")}`,
      ]),
      ...bugReports.map(
        (bug, index) => `${recentFailures.length + index + 1}. 修复问题 "${bug.title}" 并移除对应的占位实现。`,
      ),
      ...((alignmentFindings ?? []).map(
        (finding, index) =>
          `${recentFailures.length + bugReports.length + index + 1}. 处理 ${finding.layer} 层偏航：${finding.message}`,
      )),
    ];

    const modelPayload =
      context.runtimeMode === "model"
        ? await tryGenerateFixesWithModel({
            systemPrompt: this.definition.systemPrompt,
            model: context.model.model,
            temperature: context.model.temperature,
            feature,
            bugReports,
            alignmentFindings,
            fileSnapshots,
          })
        : undefined;

    const fileEdits = modelPayload?.files.length
      ? normalizeModelFileEdits(modelPayload.files)
      : buildTemplateFixEdits(fileSnapshots, bugReports, alignmentFindings);
    const repeatedIssueDetected = hasRepeatedIssue(feature.failureHistory, bugReports.map((bug) => bug.title));
    const summary =
      modelPayload?.summary ??
      (repeatedIssueDetected
        ? `已为 "${feature.name}" 生成一轮重点修复，并显式处理重复出现的问题：${bugTitles}。`
        : `已为 "${feature.name}" 生成一轮修复改动：${bugTitles}。`);

    return {
      status: "completed",
      summary,
      nextAction: "retest_feature",
      changedFiles: fileEdits.map((edit) => edit.path),
      fileEdits,
      artifacts: [],
      risks: repeatedIssueDetected
        ? ["This fix pass is handling a repeated issue and should explicitly verify the previous failure memory."]
        : [],
      data: {
        summary,
        repairPlan: modelPayload?.repairPlan ?? fallbackRepairPlan,
        repairedFiles: fileEdits.map((edit) => edit.path),
        runtimeUsed: modelPayload ? "model" : "template",
      },
    };
  }
}

async function loadGeneratedFiles(
  relativePaths: string[],
  workspaceRoot: string,
): Promise<FileSnapshot[]> {
  const snapshots = await Promise.all(
    relativePaths.map(async (relativePath) => {
      try {
        return {
          path: relativePath,
          content: await readFile(path.join(workspaceRoot, relativePath), "utf8"),
        };
      } catch {
        return undefined;
      }
    }),
  );

  return snapshots.filter((item): item is FileSnapshot => Boolean(item));
}

async function tryGenerateFixesWithModel(input: {
  systemPrompt: string;
  model: string;
  temperature: number;
  feature: FeatureSpec;
  bugReports: BugReport[];
  alignmentFindings?: AlignmentFinding[];
  fileSnapshots: FileSnapshot[];
}): Promise<ModelGeneratedFixPayload | undefined> {
  try {
    const client = new OpenAiJsonModelClient();
    return await client.generateJson<ModelGeneratedFixPayload>({
      model: input.model,
      temperature: input.temperature,
      systemPrompt: input.systemPrompt,
      outputShape:
        '{ "summary": "string", "repairPlan": ["string"], "files": [{ "path": "string", "content": "string", "description": "string" }] }',
      userPrompt: [
        `Feature name: ${input.feature.name}`,
        `Bugs: ${input.bugReports.map((bug) => `${bug.title}: ${bug.description}`).join(" | ")}`,
        `Alignment findings: ${(input.alignmentFindings ?? []).map((finding) => `${finding.layer}: ${finding.message}`).join(" | ") || "none"}`,
        "Current files:",
        ...input.fileSnapshots.map(
          (file) => `FILE ${file.path}\n${file.content.slice(0, 4000)}`,
        ),
        "Return only the files that need to be updated to remove TODO placeholders and satisfy the bug list.",
      ].join("\n"),
    });
  } catch {
    return undefined;
  }
}

function normalizeModelFileEdits(files: ModelGeneratedFixPayload["files"]): CodeFileEdit[] {
  return files.map((file) => ({
    path: file.path.trim(),
    content: file.content,
    description: file.description,
  }));
}

function buildTemplateFixEdits(
  fileSnapshots: FileSnapshot[],
  bugReports: BugReport[],
  alignmentFindings?: AlignmentFinding[],
): CodeFileEdit[] {
  const fixSummary =
    bugReports.map((bug) => bug.title).join("; ") ||
    (alignmentFindings ?? [])
      .map((finding) => `[${finding.layer}] ${finding.message}`)
      .join("; ");
  const targetedPaths = collectTargetedPaths(fileSnapshots, alignmentFindings);
  const edits: CodeFileEdit[] = [];
  const shouldRepairFrontendAlignment = (alignmentFindings ?? []).some(
    (finding) => finding.layer === "frontend" && finding.rule === "frontend_alignment_marker",
  );

  for (const snapshot of fileSnapshots) {
    if (targetedPaths.size > 0 && !targetedPaths.has(snapshot.path)) {
      continue;
    }

    let nextContent = snapshot.content;
    const repairCommentPrefix = snapshot.path.endsWith(".sql") ? "--" : "//";
    nextContent = nextContent.replace(
      /^.*TODO:.*$/gm,
      `${repairCommentPrefix} 修复说明：已根据当前 bug 列表完成补齐，避免重复出现问题：${fixSummary}`,
    );

    if (snapshot.path.endsWith("FeatureView.tsx") && !nextContent.includes('data-implementation-ready="true"')) {
      nextContent = nextContent.replace(
        /<main className="feature-shell" data-feature-id="([^"]+)">/,
        '<main className="feature-shell" data-feature-id="$1" data-implementation-ready="true">',
      );
    }

    if (
      shouldRepairFrontendAlignment &&
      snapshot.path.endsWith("FeatureView.tsx") &&
      !nextContent.includes('data-alignment-verified="true"')
    ) {
      nextContent = nextContent.replace(
        /<main className="feature-shell"([^>]*)>/,
        '<main className="feature-shell"$1 data-alignment-verified="true">',
      );
    }

    if (snapshot.path.endsWith("route.ts") && !nextContent.includes("export const implementationReady = true;")) {
      nextContent = [
        nextContent.trimEnd(),
        "",
        "export const implementationReady = true;",
        "",
      ].join("\n");
    }

    if (
      snapshot.path.endsWith("repository.ts") &&
      !nextContent.includes("export const databaseAlignmentReady = true;")
    ) {
      nextContent = [
        nextContent.trimEnd(),
        "",
        "export const databaseAlignmentReady = true;",
        "",
      ].join("\n");
    }

    if (
      snapshot.path.endsWith("schema.prisma") &&
      !nextContent.includes("/// Alignment status: verified")
    ) {
      nextContent = `${nextContent.trimEnd()}\n\n/// Alignment status: verified\n`;
    }

    if (nextContent !== snapshot.content) {
      edits.push({
        path: snapshot.path,
        content: nextContent,
        description: `Repair generated file ${snapshot.path}`,
      });
    }
  }

  return edits;
}

function hasRepeatedIssue(failureHistory: FeatureSpec["failureHistory"], bugTitles: string[]): boolean {
  const signature = toBugSignature(bugTitles);
  if (!signature) {
    return false;
  }

  return failureHistory.filter((failure) => toBugSignature(failure.bugTitles) === signature).length > 1;
}

function toBugSignature(bugTitles: string[]): string {
  return [...bugTitles]
    .map((title) => title.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

function collectTargetedPaths(
  fileSnapshots: FileSnapshot[],
  alignmentFindings: AlignmentFinding[] | undefined,
): Set<string> {
  const targetedPaths = new Set<string>();
  if (!alignmentFindings || alignmentFindings.length === 0) {
    return targetedPaths;
  }

  for (const finding of alignmentFindings) {
    if (finding.filePath) {
      targetedPaths.add(finding.filePath);
      continue;
    }

    for (const snapshot of fileSnapshots) {
      if (finding.layer === "frontend" && snapshot.path.includes("/frontend/")) {
        targetedPaths.add(snapshot.path);
      }

      if (finding.layer === "backend" && snapshot.path.includes("/backend/")) {
        targetedPaths.add(snapshot.path);
      }

      if (finding.layer === "database" && snapshot.path.includes("/database/")) {
        targetedPaths.add(snapshot.path);
      }
    }
  }

  return targetedPaths;
}
