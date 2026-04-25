import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec } from "../types/domain.js";

export interface DevAgentInput {
  feature: FeatureSpec;
  uiArtifactPath: string;
}

export interface DevAgentOutput {
  summary: string;
  implementationPlan: string[];
}

export class DevAgent implements Agent<DevAgentInput, DevAgentOutput> {
  readonly definition = agentRegistry["dev-agent"];

  async run({ feature, uiArtifactPath }: DevAgentInput): Promise<AgentResult<DevAgentOutput>> {
    const implementationPlan = [
      `Review the feature acceptance criteria for "${feature.name}".`,
      "Map frontend and backend work for the current feature slice.",
      `Use the UI artifact at ${uiArtifactPath} as the visual reference during implementation.`,
    ];

    return {
      status: "completed",
      summary: `Prepared an implementation plan for "${feature.name}" using the downloaded UI artifact as the visual reference.`,
      nextAction: "run_feature_tests",
      changedFiles: [],
      artifacts: [],
      risks: uiArtifactPath ? [] : ["No UI artifact was provided to the development stage."],
      data: {
        summary: [
          `Implement feature "${feature.name}" using the downloaded UI artifact as the visual reference.`,
          `Reference UI artifact: ${uiArtifactPath}`,
        ].join(" "),
        implementationPlan,
      },
    };
  }
}
