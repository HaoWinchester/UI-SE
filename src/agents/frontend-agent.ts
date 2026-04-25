import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec } from "../types/domain.js";

// frontend-agent 专门负责前端侧的实现拆解。
export interface FrontendAgentInput {
  feature: FeatureSpec;
  uiArtifactPath: string;
}

export interface FrontendAgentOutput {
  summary: string;
  implementationPlan: string[];
}

export class FrontendAgent implements Agent<FrontendAgentInput, FrontendAgentOutput> {
  readonly definition = agentRegistry["frontend-agent"];

  async run({ feature, uiArtifactPath }: FrontendAgentInput): Promise<AgentResult<FrontendAgentOutput>> {
    const implementationPlan = [
      `Map the visual sections needed for "${feature.name}".`,
      `Use the approved UI artifact at ${uiArtifactPath} as the styling and layout reference.`,
      "Identify component boundaries, states, and interaction feedback for the frontend slice.",
    ];

    return {
      status: "completed",
      summary: `Prepared the frontend implementation plan for "${feature.name}".`,
      nextAction: "implement_backend_slice",
      changedFiles: [],
      artifacts: [],
      risks: uiArtifactPath ? [] : ["Frontend planning is missing an approved UI artifact reference."],
      data: {
        summary: `Frontend plan prepared for "${feature.name}" using the approved UI design as reference.`,
        implementationPlan,
      },
    };
  }
}
