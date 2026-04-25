import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { BugReport, FeatureSpec } from "../types/domain.js";

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
    const repairPlan = bugReports.map(
      (bug, index) => `${index + 1}. Fix issue "${bug.title}" for feature "${feature.name}".`,
    );

    return {
      status: "completed",
      summary: `Prepared a fix pass for "${feature.name}" based on the following issues: ${bugTitles}.`,
      nextAction: "retest_feature",
      changedFiles: [],
      artifacts: [],
      risks: [],
      data: {
        summary: `Prepare a fix pass for "${feature.name}" based on the following issues: ${bugTitles}.`,
        repairPlan,
      },
    };
  }
}
