import { randomUUID } from "node:crypto";

import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  FeatureSpec,
  ProductRequirement,
  RequirementClarification,
} from "../types/domain.js";

// spec-agent 负责把自然语言需求整理成 Speckit 风格的结构化 spec。
export interface DraftSpecInput {
  rawRequirement: string;
}

export interface DraftSpecOutput {
  requirement: ProductRequirement;
  notes: string[];
  assumptions: string[];
  clarifications: RequirementClarification[];
  specMarkdown: string;
}

export class SpecAgent implements Agent<DraftSpecInput, DraftSpecOutput> {
  readonly definition = agentRegistry["spec-agent"];

  async run({ rawRequirement }: DraftSpecInput): Promise<AgentResult<DraftSpecOutput>> {
    const normalizedRequirement = rawRequirement.trim();
    const title = inferTitle(normalizedRequirement);
    const subjectLabel = deriveSubjectLabel(title);
    const featureNames = extractFeatureNames(normalizedRequirement, subjectLabel);
    const features = featureNames.map((name, index) => createFeature(name, index));
    const assumptions = buildAssumptions(normalizedRequirement);
    const clarifications = buildClarifications(normalizedRequirement, subjectLabel);
    const userScenarios = buildUserScenarios(subjectLabel, featureNames);
    const acceptanceCriteria = buildAcceptanceCriteria(featureNames);
    const successCriteria = buildSuccessCriteria(featureNames);

    const requirement: ProductRequirement = {
      id: randomUUID(),
      title,
      summary: summarizeRequirement(normalizedRequirement, featureNames),
      rawInput: normalizedRequirement,
      userScenarios,
      acceptanceCriteria,
      successCriteria,
      assumptions,
      clarifications,
      features,
    };

    const specMarkdown = createSpecMarkdown(requirement);

    return {
      status: "completed",
      summary: `Clarified the incoming request into a spec with ${features.length} feature slices.`,
      nextAction: "review_clarified_spec",
      changedFiles: [],
      artifacts: [],
      risks: [
        "Clarifications are currently generated from heuristics and should later be upgraded to a model-backed clarify loop.",
      ],
      data: {
        requirement,
        notes: [
          `Converted the raw request into ${features.length} feature slices.`,
          "Applied Speckit-style default clarifications so the UI generator receives a more concrete spec.",
        ],
        assumptions,
        clarifications,
        specMarkdown,
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

// 生成简短摘要，优先突出这次自动澄清后的目标和功能范围。
function summarizeRequirement(rawRequirement: string, featureNames: string[]): string {
  const normalized = rawRequirement.replace(/\s+/g, " ").trim();
  const featurePreview = featureNames.slice(0, 3).join("; ");
  return `${normalized} Core slices: ${featurePreview}`.slice(0, 220);
}

// 优先从项目符号中提取功能点；如果用户只给一句话，就自动扩成 3 个可执行的功能切片。
function extractFeatureNames(rawRequirement: string, subjectLabel: string): string[] {
  const bulletLines = rawRequirement
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  const normalized = rawRequirement.toLowerCase();
  if (normalized.includes("dashboard")) {
    return [
      `Present the primary ${subjectLabel} overview`,
      "Show key metrics, status, and recent activity",
      "Support the main navigation and drill-down actions",
    ];
  }

  if (normalized.includes("landing") || normalized.includes("homepage")) {
    return [
      `Present the core value proposition for ${subjectLabel}`,
      "Show supporting sections, trust signals, and primary actions",
      "Provide a complete visitor journey from entry to conversion",
    ];
  }

  if (normalized.includes("admin") || normalized.includes("management")) {
    return [
      `Present the core management workspace for ${subjectLabel}`,
      "Show key records, filters, and status indicators",
      "Support the primary review and update actions",
    ];
  }

  return [
    `Present the main user journey for ${subjectLabel}`,
    `Show the key information and actions required by ${subjectLabel}`,
    `Provide the important status, feedback, and completion states for ${subjectLabel}`,
  ];
}

// 给当前 spec 自动补一些默认假设，减少一句话需求的歧义。
function buildAssumptions(rawRequirement: string): string[] {
  const normalized = rawRequirement.toLowerCase();
  const platformAssumption = normalized.includes("mobile") || normalized.includes("app")
    ? "The first UI draft should prioritize a mobile-first product experience."
    : "The first UI draft should prioritize a desktop-first web experience.";

  return [
    platformAssumption,
    "The first draft should focus on the primary user flow before covering long-tail edge cases.",
    "Copy can remain concise and placeholder-level as long as the structure and actions are clear.",
  ];
}

// 按 Speckit clarify 的思路，把最关键的模糊点用默认决策先补齐。
function buildClarifications(rawRequirement: string, subjectLabel: string): RequirementClarification[] {
  const normalized = rawRequirement.toLowerCase();
  const platformAnswer = normalized.includes("mobile") || normalized.includes("app")
    ? "Mobile-first application flow"
    : "Desktop-first web flow";
  const visualAnswer = normalized.includes("minimal") || normalized.includes("clean")
    ? "Use the clean visual direction requested by the user"
    : "Use a clean professional product UI suitable for demos";
  const scopeAnswer = normalized.includes("all pages") || normalized.includes("full product")
    ? "Generate the primary overview plus key supporting sections"
    : `Focus the first UI draft on the main screen and supporting sections for ${subjectLabel}`;

  return [
    {
      topic: "Primary platform",
      answer: platformAnswer,
      rationale: "The UI generator needs an explicit target form factor before drafting layouts.",
    },
    {
      topic: "Visual direction",
      answer: visualAnswer,
      rationale: "A default visual direction keeps the first generated concept coherent.",
    },
    {
      topic: "First-pass scope",
      answer: scopeAnswer,
      rationale: "Stitch works better when the first pass focuses on the core journey instead of the entire system.",
    },
  ];
}

// 用户场景会被写进 spec，也会影响 UI prompt 的组织方式。
function buildUserScenarios(subjectLabel: string, featureNames: string[]): string[] {
  return [
    `A primary user opens ${subjectLabel} and immediately understands the main workflow.`,
    `The user can complete the core action path through these slices: ${featureNames.slice(0, 2).join("; ")}.`,
    "The interface clearly communicates status, next actions, and completion feedback.",
  ];
}

// 把“Build/Create/Design ...”这类请求式标题压缩成更适合写 spec 的主题名。
function deriveSubjectLabel(title: string): string {
  return title
    .replace(/^(build|create|design|generate|make|implement)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+for\s+/i, " for ")
    .trim();
}

// 总体验收标准强调“功能明确、结构清晰、可继续进入开发阶段”。
function buildAcceptanceCriteria(featureNames: string[]): string[] {
  return [
    `The UI concept clearly covers these feature slices: ${featureNames.join("; ")}.`,
    "The generated layout exposes a coherent primary user journey and obvious next actions.",
    "The output is concrete enough for downstream frontend and backend planning.",
  ];
}

// 成功标准更偏向 Speckit 风格的可验证结果。
function buildSuccessCriteria(featureNames: string[]): string[] {
  return [
    `Stakeholders can identify all ${featureNames.length} feature slices directly from the first UI draft.`,
    "The generated UI makes the primary journey understandable without additional verbal explanation.",
    "The clarified spec and generated UI can be handed to development without re-writing the requirement from scratch.",
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
    frontendStatus: "pending",
    backendStatus: "pending",
    implementationAttempts: 0,
    testAttempts: 0,
  };
}

// 生成一份适合落盘的 spec markdown，供后续 UI 生成和人工查看。
function createSpecMarkdown(requirement: ProductRequirement): string {
  const featureSection = requirement.features
    .map(
      (feature, index) => [
        `### Feature ${index + 1}: ${feature.name}`,
        `- Description: ${feature.description}`,
        ...feature.acceptanceCriteria.map((criterion) => `- Acceptance: ${criterion}`),
      ].join("\n"),
    )
    .join("\n\n");

  return [
    `# ${requirement.title}`,
    "",
    "## Input",
    requirement.rawInput,
    "",
    "## Summary",
    requirement.summary,
    "",
    "## Clarifications",
    ...requirement.clarifications.map(
      (clarification) =>
        `- ${clarification.topic}: ${clarification.answer} (${clarification.rationale})`,
    ),
    "",
    "## User Scenarios",
    ...requirement.userScenarios.map((scenario) => `- ${scenario}`),
    "",
    "## Functional Requirements",
    ...requirement.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Success Criteria",
    ...requirement.successCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Assumptions",
    ...requirement.assumptions.map((assumption) => `- ${assumption}`),
    "",
    "## Feature Slices",
    featureSection,
    "",
  ].join("\n");
}
