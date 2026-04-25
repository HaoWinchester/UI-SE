import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec, ProductRequirement } from "../types/domain.js";

// backend-agent 专门负责后端侧的实现拆解。
export interface BackendAgentInput {
  feature: FeatureSpec;
  requirement: ProductRequirement;
}

export interface BackendAgentOutput {
  summary: string;
  implementationPlan: string[];
}

export class BackendAgent implements Agent<BackendAgentInput, BackendAgentOutput> {
  readonly definition = agentRegistry["backend-agent"];

  async run({ feature, requirement }: BackendAgentInput): Promise<AgentResult<BackendAgentOutput>> {
    const implementationPlan = [
      `Map the backend responsibilities needed for "${feature.name}".`,
      `Keep the implementation aligned with the requirement summary: ${requirement.summary}`,
      "Define the data contracts, validation rules, and service interactions needed for the current feature slice.",
    ];

    return {
      status: "completed",
      summary: `Prepared the backend implementation plan for "${feature.name}".`,
      nextAction: "run_feature_tests",
      changedFiles: [],
      artifacts: [],
      risks: [],
      data: {
        summary: `Backend plan prepared for "${feature.name}" and aligned with the clarified requirement.`,
        implementationPlan,
      },
    };
  }
}
