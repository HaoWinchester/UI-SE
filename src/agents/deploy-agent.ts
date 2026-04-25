import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { WorkflowJob } from "../types/domain.js";

// deploy-agent 负责发布前最后一层判断：当前版本是否允许部署。
export interface DeployAgentInput {
  job: WorkflowJob;
}

export interface DeployAgentOutput {
  approved: boolean;
  environment: string;
  summary: string;
}

export class DeployAgent implements Agent<DeployAgentInput, DeployAgentOutput> {
  readonly definition = agentRegistry["deploy-agent"];

  async run({ job }: DeployAgentInput): Promise<AgentResult<DeployAgentOutput>> {
    const openBugs = job.bugReports.filter((bug) => bug.status === "open");
    const approved = openBugs.length === 0;

    return {
      status: approved ? "completed" : "blocked",
      summary: approved
        ? "Acceptance passed and deployment is approved for staging."
        : `Deployment is blocked by ${openBugs.length} open bugs.`,
      nextAction: approved ? "deploy_release" : "resolve_release_blockers",
      changedFiles: [],
      artifacts: [],
      risks: approved ? [] : [`${openBugs.length} open bugs still block the release.`],
      data: {
        approved,
        environment: "staging",
        summary: approved
          ? "Acceptance passed and deployment is approved for staging."
          : `Deployment is blocked by ${openBugs.length} open bugs.`,
      },
    };
  }
}
