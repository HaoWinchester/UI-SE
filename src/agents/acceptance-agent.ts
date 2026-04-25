// 这个文件定义验收 agent。
// 它负责把当前任务的实现状态整理成一份“是否适合给客户预览”的结论。
import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { WorkflowJob } from "../types/domain.js";

// acceptance-agent 负责整理最终客户预览前的验收结论。
export interface AcceptanceAgentInput {
  job: WorkflowJob;
}

export interface AcceptanceAgentOutput {
  readyForCustomerReview: boolean;
  previewPath?: string;
  summary: string;
}

export class AcceptanceAgent implements Agent<AcceptanceAgentInput, AcceptanceAgentOutput> {
  readonly definition = agentRegistry["acceptance-agent"];

  async run({ job }: AcceptanceAgentInput): Promise<AgentResult<AcceptanceAgentOutput>> {
    const previewPath = job.uiArtifact?.htmlPath ?? job.uiArtifact?.imagePath ?? job.uiArtifact?.downloadPath;
    const openBugs = job.bugReports.filter((bug) => bug.status === "open");
    const unfinishedFeatures = job.requirement.features.filter((feature) => feature.status !== "done");
    const readyForCustomerReview = Boolean(previewPath) && openBugs.length === 0 && unfinishedFeatures.length === 0;

    return {
      status: readyForCustomerReview ? "completed" : "blocked",
      summary: readyForCustomerReview
        ? "The workflow is ready for customer preview before deployment."
        : "The workflow is not ready for customer preview yet.",
      nextAction: readyForCustomerReview ? "request_release_approval" : "resolve_acceptance_gaps",
      changedFiles: [],
      fileEdits: [],
      artifacts: previewPath ? [previewPath] : [],
      risks: [
        ...(previewPath ? [] : ["No preview artifact is available for customer review."]),
        ...(openBugs.length > 0 ? [`${openBugs.length} open bugs still remain before release.`] : []),
        ...(unfinishedFeatures.length > 0
          ? [`${unfinishedFeatures.length} feature slices are not finished yet.`]
          : []),
      ],
      data: {
        readyForCustomerReview,
        previewPath,
        summary: readyForCustomerReview
          ? "The workflow is ready for customer preview before deployment."
          : "The workflow is not ready for customer preview yet.",
      },
    };
  }
}
