import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec, TestRun } from "../types/domain.js";

// test-agent 不负责真正跑测试命令，它负责解释测试结果并决定下一步。
export interface TestAgentInput {
  feature: FeatureSpec;
  testRun: TestRun;
}

export interface TestAgentOutput {
  shouldFix: boolean;
  summary: string;
  failingBugIds: string[];
}

export class TestAgent implements Agent<TestAgentInput, TestAgentOutput> {
  readonly definition = agentRegistry["test-agent"];

  async run({ feature, testRun }: TestAgentInput): Promise<AgentResult<TestAgentOutput>> {
    return {
      status: "completed",
      summary: testRun.passed
        ? `Feature "${feature.name}" passed and can continue to the next step.`
        : `Feature "${feature.name}" failed and should enter the repair loop.`,
      nextAction: testRun.passed ? "mark_feature_done" : "repair_feature",
      changedFiles: [],
      artifacts: [],
      risks: [],
      data: {
        shouldFix: !testRun.passed,
        summary: testRun.passed
          ? `Feature "${feature.name}" passed and can continue to the next step.`
          : `Feature "${feature.name}" failed and should enter the repair loop.`,
        failingBugIds: testRun.bugs.map((bug) => bug.id),
      },
    };
  }
}
