// 这个文件定义 UI 生成 agent。
// 它负责把澄清后的需求转换成更适合 Stitch 使用的设计 prompt。
import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { ProductRequirement, SpecArtifact } from "../types/domain.js";

// ui-agent 的职责是整理 prompt，而不是自己直接操作 Stitch 网站。
export interface UiAgentInput {
  requirement: ProductRequirement;
  specArtifact?: SpecArtifact;
  designFeedback?: string;
}

export interface UiAgentOutput {
  prompt: string;
  targetUrl: string;
  checklist: string[];
}

export class UiAgent implements Agent<UiAgentInput, UiAgentOutput> {
  readonly definition = agentRegistry["ui-agent"];

  async run({
    requirement,
    specArtifact,
    designFeedback,
  }: UiAgentInput): Promise<AgentResult<UiAgentOutput>> {
    // 把澄清后的 spec、feature 和验收标准整理成一段更适合 UI 生成工具理解的描述。
    const featureList = requirement.features
      .map((feature, index) => `${index + 1}. ${feature.name}`)
      .join("\n");

    const acceptanceList = requirement.acceptanceCriteria
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n");

    const clarificationList = requirement.clarifications
      .map(
        (clarification, index) =>
          `${index + 1}. ${clarification.topic}: ${clarification.answer}`,
      )
      .join("\n");

    const scenarioList = requirement.userScenarios
      .map((scenario, index) => `${index + 1}. ${scenario}`)
      .join("\n");

    const prompt = [
      `Project title: ${requirement.title}`,
      `Summary: ${requirement.summary}`,
      "",
      "Use this clarified product spec as the grounding reference:",
      specArtifact?.markdown ?? "(No persisted spec markdown available.)",
      "",
      designFeedback
        ? `Revise the previous UI concept using this customer feedback: ${designFeedback}`
        : "This is the first UI concept for the clarified requirement.",
      "",
      "Generate an initial UI concept that supports the following features:",
      featureList,
      "",
      "Ground the layout in these user scenarios:",
      scenarioList,
      "",
      "Use these clarified decisions:",
      clarificationList,
      "",
      "Respect these acceptance criteria:",
      acceptanceList,
    ].join("\n");

    return {
      status: "completed",
      summary: `Prepared a Stitch submission prompt from the clarified spec for ${requirement.features.length} features.`,
      nextAction: "submit_to_stitch",
      changedFiles: [],
      artifacts: [],
      risks: [],
      data: {
        prompt,
        targetUrl: "https://stitch.withgoogle.com/",
        checklist: [
          "Submit only after the requirement has been clarified into a concrete spec.",
          "Preserve the approved user flow and feature boundaries.",
          "Carry the clarification decisions into the generated layout, not just the raw one-line request.",
          "Save the generated artifact into the UI artifacts directory.",
        ],
      },
    };
  }
}
