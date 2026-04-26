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

    const assumptionsList = requirement.assumptions
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n");

    const clarifiedSpec = [
      `产品名称：${requirement.title}`,
      `项目摘要：${requirement.summary}`,
      "",
      "已澄清的关键决策：",
      clarificationList || "1. 当前没有额外澄清项。",
      "",
      "核心用户场景：",
      scenarioList,
      "",
      "首版功能切片：",
      featureList,
      "",
      "必须满足的验收标准：",
      acceptanceList,
      "",
      "当前默认假设：",
      assumptionsList,
    ].join("\n");

    const prompt = [
      "You are generating a product UI concept from a clarified, approved requirement.",
      "Only use the clarified specification below as the source of truth. Do not fall back to the original one-line request.",
      "",
      "Clarified specification:",
      clarifiedSpec,
      "",
      designFeedback
        ? `Revision feedback from the latest rejected design: ${designFeedback}`
        : "This is the first UI concept for the clarified requirement.",
      "",
      "Design constraints:",
      "- The UI must reflect the clarified feature boundaries exactly.",
      "- The main journey should be obvious from the landing screen and primary navigation.",
      "- Provide a realistic, buildable product layout instead of a vague mood board.",
      "- Keep the output aligned with the approved first-release scope.",
    ].join("\n");

    return {
      status: "completed",
      summary: `Prepared a Stitch submission prompt from the clarified spec for ${requirement.features.length} features.`,
      nextAction: "submit_to_stitch",
      changedFiles: [],
      fileEdits: [],
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
