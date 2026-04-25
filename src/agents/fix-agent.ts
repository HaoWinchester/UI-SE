// 这个文件定义修复 agent。
// 当测试失败或发现 bug 时，它会基于失败记忆生成针对性的修复计划。
import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { BugReport, FeatureSpec } from "../types/domain.js";

// fix-agent 负责把 bug 列表转换成一份修复计划。
export interface FixAgentInput {
  feature: FeatureSpec;
  bugReports: BugReport[];
}

export interface FixAgentOutput {
  summary: string;
  repairPlan: string[];
}

export class FixAgent implements Agent<FixAgentInput, FixAgentOutput> {
  readonly definition = agentRegistry["fix-agent"];

  async run({ feature, bugReports }: FixAgentInput): Promise<AgentResult<FixAgentOutput>> {
    const bugTitles = bugReports.map((bug) => bug.title).join("; ");
    const recentFailures = feature.failureHistory.slice(-3);
    const repairPlan = [
      ...recentFailures.flatMap((failure, index) => [
        `${index + 1}. Review failure memory from step "${failure.step}" with result: ${failure.resultSummary}`,
        `${index + 1}. Avoid repeating remembered issue(s): ${failure.bugTitles.join("; ")}`,
      ]),
      ...bugReports.map(
        (bug, index) =>
          `${recentFailures.length + index + 1}. Fix issue "${bug.title}" for feature "${feature.name}".`,
      ),
    ];
    const repeatedIssueDetected = hasRepeatedIssue(feature.failureHistory, bugReports.map((bug) => bug.title));
    const summary = repeatedIssueDetected
      ? `Prepared a focused fix pass for "${feature.name}" because the same issue appeared again: ${bugTitles}.`
      : `Prepared a fix pass for "${feature.name}" based on the following issues: ${bugTitles}.`;

    return {
      status: "completed",
      summary,
      nextAction: "retest_feature",
      changedFiles: [],
      artifacts: [],
      risks: repeatedIssueDetected
        ? ["This fix pass is handling a repeated issue and should explicitly verify the previous failure memory."]
        : [],
      data: {
        summary,
        repairPlan,
      },
    };
  }
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
