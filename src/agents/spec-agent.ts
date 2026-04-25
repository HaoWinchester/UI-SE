import { randomUUID } from "node:crypto";

import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec, ProductRequirement } from "../types/domain.js";

// spec-agent 负责把一段原始需求整理成结构化 spec。
export interface DraftSpecInput {
  rawRequirement: string;
}

export interface DraftSpecOutput {
  requirement: ProductRequirement;
  notes: string[];
  assumptions: string[];
}

export class SpecAgent implements Agent<DraftSpecInput, DraftSpecOutput> {
  readonly definition = agentRegistry["spec-agent"];

  async run({
    rawRequirement,
  }: DraftSpecInput): Promise<AgentResult<DraftSpecOutput>> {
    // 先从文本里提取功能点，后续开发和测试都会围绕这些 feature 运行。
    const features = extractFeatureNames(rawRequirement).map((name, index) =>
      createFeature(name, index),
    );
    const assumptions = [
      "The incoming requirement is already approved for planning.",
      "Bullet points represent feature-sized work unless clarified otherwise.",
    ];

    const requirement: ProductRequirement = {
      id: randomUUID(),
      title: inferTitle(rawRequirement),
      summary: summarizeRequirement(rawRequirement),
      rawInput: rawRequirement.trim(),
      acceptanceCriteria: [
        "Each feature must have a clear implementation task.",
        "Each feature must pass automated validation before the workflow continues.",
        "The final build must stay aligned with the approved requirement before deployment.",
      ],
      features,
    };

    return {
      status: "completed",
      summary: `Drafted ${features.length} feature items from the incoming requirement.`,
      nextAction: "confirm_spec",
      changedFiles: [],
      artifacts: [],
      risks: [
        "Spec extraction is currently heuristic and should be replaced with a model-backed clarification step.",
      ],
      data: {
        requirement,
        notes: [
          `Drafted ${features.length} feature items from the incoming requirement.`,
          "This is a bootstrap spec. Replace the parser with a real clarification step when you connect a model.",
        ],
        assumptions,
      },
    };
  }
}

// 尝试从需求第一行里提取一个标题。
function inferTitle(rawRequirement: string): string {
  const firstLine = rawRequirement
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Untitled workflow";
  }

  return firstLine.replace(/^[*-]\s*/, "").slice(0, 80);
}

// 生成简短摘要，后面会给 UI 生成和日志展示使用。
function summarizeRequirement(rawRequirement: string): string {
  const normalized = rawRequirement.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 180);
}

// 优先从项目符号中提取功能点；没有项目符号时给一个兜底结果。
function extractFeatureNames(rawRequirement: string): string[] {
  const bulletLines = rawRequirement
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  return [
    "Generate the first UI draft from the approved requirement",
    "Implement the first deliverable feature in frontend and backend",
    "Validate the build and prepare it for deployment",
  ];
}

// 初始化单个 feature 的基础状态。
function createFeature(name: string, index: number): FeatureSpec {
  return {
    id: `feature-${index + 1}`,
    name,
    description: `Deliver the requirement slice: ${name}.`,
    acceptanceCriteria: [
      `The system implements the feature: ${name}.`,
      "Automated tests for the feature pass after development or one repair loop.",
      "The feature remains traceable to the approved requirement.",
    ],
    status: "pending",
    implementationAttempts: 0,
    testAttempts: 0,
  };
}
