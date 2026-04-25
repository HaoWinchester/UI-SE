import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { ProductRequirement } from "../types/domain.js";

// ui-agent 的职责是整理 prompt，而不是自己直接操作 Stitch 网站。
export interface UiAgentInput {
  requirement: ProductRequirement;
}

export interface UiAgentOutput {
  prompt: string;
  targetUrl: string;
  checklist: string[];
}

export class UiAgent implements Agent<UiAgentInput, UiAgentOutput> {
  readonly definition = agentRegistry["ui-agent"];

  async run({ requirement }: UiAgentInput): Promise<AgentResult<UiAgentOutput>> {
    // 把 feature 和验收标准整理成一段更适合 UI 生成工具理解的描述。
    const featureList = requirement.features
      .map((feature, index) => `${index + 1}. ${feature.name}`)
      .join("\n");

    const acceptanceList = requirement.acceptanceCriteria
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n");

    const prompt = [
      `Project title: ${requirement.title}`,
      `Summary: ${requirement.summary}`,
      "",
      "Generate an initial UI concept that supports the following features:",
      featureList,
      "",
      "Respect these acceptance criteria:",
      acceptanceList,
    ].join("\n");

    return {
      status: "completed",
      summary: `Prepared a Stitch submission prompt for ${requirement.features.length} features.`,
      nextAction: "submit_to_stitch",
      changedFiles: [],
      artifacts: [],
      risks: [],
      data: {
        prompt,
        targetUrl: "https://stitch.withgoogle.com/",
        checklist: [
          "Submit only after the requirement has been approved.",
          "Preserve the approved user flow and feature boundaries.",
          "Save the generated artifact into the UI artifacts directory.",
        ],
      },
    };
  }
}
