import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { WorkflowJob } from "../types/domain.js";

// monitor-agent 用来检查“实现是否偏离了原始需求”。
export interface MonitorAgentInput {
  job: WorkflowJob;
}

export interface MonitorAgentOutput {
  aligned: boolean;
  findings: string[];
  summary: string;
}

export class MonitorAgent implements Agent<MonitorAgentInput, MonitorAgentOutput> {
  readonly definition = agentRegistry["monitor-agent"];

  async run({ job }: MonitorAgentInput): Promise<AgentResult<MonitorAgentOutput>> {
    const findings: string[] = [];

    if (!job.uiArtifact) {
      findings.push("The workflow has no downloaded UI artifact.");
    }

    const unfinishedFeatures = job.requirement.features.filter(
      (feature) => feature.status !== "done",
    );
    if (unfinishedFeatures.length > 0) {
      findings.push(`${unfinishedFeatures.length} features are still not marked as done.`);
    }

    const aligned = findings.length === 0;

    return {
      status: aligned ? "completed" : "blocked",
      summary: aligned
        ? "Implementation still matches the approved requirement."
        : `Alignment check found gaps: ${findings.join(" ")}`,
      nextAction: aligned ? "run_acceptance_tests" : "investigate_alignment_gap",
      changedFiles: [],
      artifacts: [],
      risks: findings,
      data: {
        aligned,
        findings,
        summary: aligned
          ? "Implementation still matches the approved requirement."
          : `Alignment check found gaps: ${findings.join(" ")}`,
      },
    };
  }
}
