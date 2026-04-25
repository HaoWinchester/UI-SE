// 这个文件定义测试分析 agent。
// 它不直接执行测试命令，而是根据测试结果决定是否进入修复流程。
import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FailureMemory, FeatureSpec, TestRun } from "../types/domain.js";

// test-agent 不负责真正跑测试命令，它负责解释测试结果并决定下一步。
export interface TestAgentInput {
  feature: FeatureSpec;
  testRun: TestRun;
}

export interface TestAgentOutput {
  shouldFix: boolean;
  summary: string;
  failingBugIds: string[];
  repeatedFailure: boolean;
  rememberedFailureIds: string[];
}

export class TestAgent implements Agent<TestAgentInput, TestAgentOutput> {
  readonly definition = agentRegistry["test-agent"];

  async run({ feature, testRun }: TestAgentInput): Promise<AgentResult<TestAgentOutput>> {
    const rememberedFailures = findRememberedFailures(feature.failureHistory, testRun.bugs.map((bug) => bug.title));
    const repeatedFailure = rememberedFailures.length > 1;
    const summary = testRun.passed
      ? `Feature "${feature.name}" passed and can continue to the next step.`
      : repeatedFailure
        ? `Feature "${feature.name}" failed again with a previously seen problem and should enter a focused repair loop.`
        : `Feature "${feature.name}" failed and should enter the repair loop.`;

    return {
      status: "completed",
      summary,
      nextAction: testRun.passed
        ? "mark_feature_done"
        : repeatedFailure
          ? "repair_feature_with_failure_memory"
          : "repair_feature",
      changedFiles: [],
      fileEdits: [],
      artifacts: [],
      risks: repeatedFailure
        ? ["The latest failure matches an earlier failure record and should be treated as a repeated issue."]
        : [],
      data: {
        shouldFix: !testRun.passed,
        summary,
        failingBugIds: testRun.bugs.map((bug) => bug.id),
        repeatedFailure,
        rememberedFailureIds: rememberedFailures.map((failure) => failure.id),
      },
    };
  }
}

function findRememberedFailures(
  failureHistory: FailureMemory[],
  currentBugTitles: string[],
): FailureMemory[] {
  const currentSignature = toBugSignature(currentBugTitles);
  if (!currentSignature) {
    return [];
  }

  return failureHistory.filter((failure) => toBugSignature(failure.bugTitles) === currentSignature);
}

function toBugSignature(bugTitles: string[]): string {
  return [...bugTitles]
    .map((title) => title.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}
