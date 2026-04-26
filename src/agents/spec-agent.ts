// 这个文件定义需求澄清 agent。
// 这版不再只是“自动补默认值”，而是改成更接近 Speckit CLI 的方式：
// 先给出高影响澄清问题，再根据用户回答逐步收敛成最终 spec。
import { randomUUID } from "node:crypto";

import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  FeatureSpec,
  ProductRequirement,
  RequirementClarification,
} from "../types/domain.js";

export interface SpecClarificationOption {
  key: string;
  answer: string;
  implication: string;
}

export interface SpecClarificationQuestion {
  id: string;
  topic: string;
  context: string;
  question: string;
  recommendation: string;
  recommendationReason: string;
  answerFormat: "option" | "short";
  options?: SpecClarificationOption[];
  placeholder?: string;
  maxWords?: number;
}

export interface SpecClarificationAnswer {
  questionId: string;
  topic: string;
  answer: string;
  rationale: string;
  source: "recommended" | "user";
}

// spec-agent 负责把自然语言需求整理成 Speckit 风格的结构化 spec。
export interface DraftSpecInput {
  rawRequirement: string;
  clarificationAnswers?: SpecClarificationAnswer[];
}

export interface DraftSpecOutput {
  requirement: ProductRequirement;
  notes: string[];
  assumptions: string[];
  clarifications: RequirementClarification[];
  specMarkdown: string;
  pendingQuestions: SpecClarificationQuestion[];
}

interface DraftContext {
  normalizedRequirement: string;
  title: string;
  subjectLabel: string;
  featureNames: string[];
  assumptions: string[];
  clarifications: RequirementClarification[];
  userScenarios: string[];
  acceptanceCriteria: string[];
  successCriteria: string[];
}

export class SpecAgent implements Agent<DraftSpecInput, DraftSpecOutput> {
  readonly definition = agentRegistry["spec-agent"];

  async run({
    rawRequirement,
    clarificationAnswers = [],
  }: DraftSpecInput): Promise<AgentResult<DraftSpecOutput>> {
    const draftContext = buildDraftContext(rawRequirement, clarificationAnswers);
    const pendingQuestions = buildClarificationQuestions(draftContext, clarificationAnswers);

    const requirement: ProductRequirement = {
      id: randomUUID(),
      title: draftContext.title,
      summary: summarizeRequirement(draftContext.normalizedRequirement, draftContext.featureNames),
      rawInput: draftContext.normalizedRequirement,
      userScenarios: draftContext.userScenarios,
      acceptanceCriteria: draftContext.acceptanceCriteria,
      successCriteria: draftContext.successCriteria,
      assumptions: draftContext.assumptions,
      clarifications: draftContext.clarifications,
      features: draftContext.featureNames.map((name, index) => createFeature(name, index)),
    };

    const specMarkdown = createSpecMarkdown(requirement, pendingQuestions);

    return {
      status: "completed",
      summary:
        pendingQuestions.length > 0
          ? `Drafted a Speckit-style spec and identified ${pendingQuestions.length} clarification question(s) before UI generation.`
          : `Clarified the incoming request into a spec with ${requirement.features.length} feature slices.`,
      nextAction: pendingQuestions.length > 0 ? "clarify_requirement_details" : "review_clarified_spec",
      changedFiles: [],
      fileEdits: [],
      artifacts: [],
      risks:
        pendingQuestions.length > 0
          ? ["High-impact requirement details are still being clarified before Stitch submission."]
          : [],
      data: {
        requirement,
        notes: [
          `Converted the raw request into ${requirement.features.length} feature slices.`,
          pendingQuestions.length > 0
            ? "Waiting for Speckit-style clarification answers before the spec is finalized."
            : "Resolved the current clarification set and finalized the spec for downstream UI generation.",
        ],
        assumptions: draftContext.assumptions,
        clarifications: draftContext.clarifications,
        specMarkdown,
        pendingQuestions,
      },
    };
  }
}

function buildDraftContext(
  rawRequirement: string,
  clarificationAnswers: SpecClarificationAnswer[],
): DraftContext {
  const normalizedRequirement = rawRequirement.trim();
  const title = inferTitle(normalizedRequirement);
  const subjectLabel = deriveSubjectLabel(title);
  const resolvedAnswers = new Map(clarificationAnswers.map((answer) => [answer.topic, answer]));
  const featureNames = extractFeatureNames(
    normalizedRequirement,
    subjectLabel,
    resolvedAnswers.get("scope")?.answer,
  );
  const assumptions = buildAssumptions(
    normalizedRequirement,
    resolvedAnswers.get("platform")?.answer,
    resolvedAnswers.get("visual-style")?.answer,
  );
  const clarifications = clarificationAnswers.map((answer) => ({
    topic: answer.topic,
    answer: answer.answer,
    rationale: answer.rationale,
  }));
  const userScenarios = buildUserScenarios(
    subjectLabel,
    featureNames,
    resolvedAnswers.get("primary-journey")?.answer,
  );
  const acceptanceCriteria = buildAcceptanceCriteria(
    featureNames,
    resolvedAnswers.get("scope")?.answer,
  );
  const successCriteria = buildSuccessCriteria(
    featureNames,
    resolvedAnswers.get("primary-journey")?.answer,
  );

  return {
    normalizedRequirement,
    title,
    subjectLabel,
    featureNames,
    assumptions,
    clarifications,
    userScenarios,
    acceptanceCriteria,
    successCriteria,
  };
}

function buildClarificationQuestions(
  draftContext: DraftContext,
  clarificationAnswers: SpecClarificationAnswer[],
): SpecClarificationQuestion[] {
  const answeredTopics = new Set(clarificationAnswers.map((answer) => answer.topic));
  const rawRequirement = draftContext.normalizedRequirement.toLowerCase();
  const questions: SpecClarificationQuestion[] = [];

  if (!answeredTopics.has("platform") && !mentionsPlatform(rawRequirement)) {
    questions.push({
      id: "platform",
      topic: "platform",
      context: "当前需求没有明确首版是桌面 Web、响应式 Web 还是移动端优先，这会直接影响 UI 结构和后续开发切片。",
      question: "首版应该优先面向哪个终端形态？",
      recommendation: "B",
      recommendationReason: "对大多数演示型产品来说，响应式 Web 能兼顾桌面展示和移动访问，后续扩展成本也最低。",
      answerFormat: "option",
      options: [
        {
          key: "A",
          answer: "桌面 Web 优先",
          implication: "首屏信息密度更高，适合演示复杂布局。",
        },
        {
          key: "B",
          answer: "响应式 Web",
          implication: "同时考虑桌面与移动浏览，是最稳妥的默认选择。",
        },
        {
          key: "C",
          answer: "移动端优先",
          implication: "布局会偏向卡片化和单列流。",
        },
      ],
    });
  }

  if (!answeredTopics.has("scope") && !mentionsScope(rawRequirement)) {
    questions.push({
      id: "scope",
      topic: "scope",
      context: "当前需求只说明了产品主题，但没有明确首版要做“单页展示”还是“带浏览与详情的核心流程”，这会影响 spec 边界和 Stitch prompt。",
      question: "首版范围应该收敛到哪一级？",
      recommendation: "B",
      recommendationReason: "先做“首页 + 列表/分区 + 核心详情入口”的主流程，既比单页更完整，也不会一下子扩到整站。",
      answerFormat: "option",
      options: [
        {
          key: "A",
          answer: "只做首页视觉展示",
          implication: "更适合快速确认风格，但功能流较弱。",
        },
        {
          key: "B",
          answer: "首页 + 核心浏览流程",
          implication: "能同时支撑设计确认和后续前后端开发。",
        },
        {
          key: "C",
          answer: "完整多页面产品",
          implication: "信息量最大，但第一版澄清和开发成本也最高。",
        },
      ],
    });
  }

  if (!answeredTopics.has("primary-journey") && !mentionsPrimaryJourney(rawRequirement)) {
    questions.push({
      id: "primary-journey",
      topic: "primary-journey",
      context: "动漫网站可能侧重“找番、看详情、追更新、收藏、社区互动”等不同主路径，首版要先明确最核心的一条。",
      question: "首版最重要的用户主路径是什么？",
      recommendation: "发现番剧并进入详情",
      recommendationReason: "这是最通用也最适合 UI 和后续功能开发的基础路径，能自然延展到榜单、分类、详情和追更。",
      answerFormat: "short",
      placeholder: "例如：发现番剧并进入详情",
      maxWords: 5,
    });
  }

  return questions.slice(0, 5);
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

  return normalizeRequirementTitle(firstLine.replace(/^[*-]\s*/, "")).slice(0, 80);
}

// 生成简短摘要，优先突出这次自动澄清后的目标和功能范围。
function summarizeRequirement(rawRequirement: string, featureNames: string[]): string {
  const normalizedTitle = normalizeRequirementTitle(rawRequirement);
  const featurePreview = featureNames.slice(0, 3).join("；");
  return `围绕「${normalizedTitle}」生成首版可交付产品方案，当前已收敛的核心功能包括：${featurePreview}。`.slice(
    0,
    220,
  );
}

// 优先从项目符号中提取功能点；如果用户只给一句话，就按当前 scope 生成可执行切片。
function extractFeatureNames(
  rawRequirement: string,
  subjectLabel: string,
  scopeAnswer?: string,
): string[] {
  const bulletLines = rawRequirement
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  const containsChinese = /[\u4e00-\u9fff]/.test(rawRequirement);
  if (containsChinese) {
    if (scopeAnswer?.includes("首页视觉展示")) {
      return [
        "首页视觉与品牌展示",
        "核心卖点与内容分区",
        "主要入口与引导操作",
      ];
    }

    if (scopeAnswer?.includes("完整多页面产品")) {
      return [
        "首页与主导航体验",
        "内容浏览与发现流程",
        "详情页与关键状态反馈",
      ];
    }

    return [
      "首页与主入口体验",
      "内容浏览与发现流程",
      "详情页与状态反馈",
    ];
  }

  if (scopeAnswer?.includes("首页视觉展示")) {
    return [
      `Present the landing showcase for ${subjectLabel}`,
      "Highlight the core anime categories and featured content",
      "Provide clear entry actions and promotional zones",
    ];
  }

  if (scopeAnswer?.includes("完整多页面产品")) {
    return [
      `Present the main user journey for ${subjectLabel}`,
      "Support browse, ranking, and category exploration",
      "Provide anime detail pages with update and follow states",
    ];
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

// 假设项保留，但它们现在只是默认值，不再替代真正的澄清答案。
function buildAssumptions(
  rawRequirement: string,
  platformAnswer?: string,
  visualStyleAnswer?: string,
): string[] {
  const normalized = rawRequirement.toLowerCase();
  const resolvedPlatform =
    platformAnswer ??
    (normalized.includes("mobile") || normalized.includes("app")
      ? "移动端优先"
      : "桌面 Web 优先");
  const visualDirection =
    visualStyleAnswer ??
    (normalized.includes("minimal") || normalized.includes("clean")
      ? "简洁克制的界面风格"
      : "适合演示的清晰产品风格");

  return [
    `默认平台假设：${resolvedPlatform}。`,
    `默认视觉方向：${visualDirection}。`,
    "首版先聚焦主流程，不覆盖全部长尾页面和异常运营场景。",
  ];
}

function buildUserScenarios(
  subjectLabel: string,
  featureNames: string[],
  primaryJourneyAnswer?: string,
): string[] {
  const containsChinese = /[\u4e00-\u9fff]/.test(subjectLabel);
  const primaryJourney = primaryJourneyAnswer ?? "用户进入产品后完成首个核心任务";

  if (containsChinese) {
    return [
      `用户进入「${subjectLabel}」后，可以快速理解首页信息结构和主要入口。`,
      `首版最重要的主路径是：${primaryJourney}。`,
      `用户可以围绕这几个核心切片完成主流程：${featureNames.slice(0, 2).join("、")}。`,
    ];
  }

  return [
    `A primary user opens ${subjectLabel} and quickly understands the main experience.`,
    `The main journey for the first release is: ${primaryJourney}.`,
    `The user can complete the core action path through these slices: ${featureNames.slice(0, 2).join("; ")}.`,
  ];
}

function deriveSubjectLabel(title: string): string {
  const normalized = title
    .replace(/^(build|create|design|generate|make|implement)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+for\s+/i, " for ")
    .trim();

  return normalized || "this product";
}

function buildAcceptanceCriteria(featureNames: string[], scopeAnswer?: string): string[] {
  const containsChinese = featureNames.some((item) => /[\u4e00-\u9fff]/.test(item));
  if (containsChinese) {
    return [
      `首版 UI 需要清晰覆盖这些功能切片：${featureNames.join("、")}。`,
      scopeAnswer
        ? `必须严格遵守已确认的首版范围：${scopeAnswer}。`
        : "生成结果需要让主路径和下一步操作足够清晰。",
      "输出结果必须足够具体，能直接进入前后端开发与测试阶段。",
    ];
  }

  return [
    `The first UI concept clearly covers these feature slices: ${featureNames.join("; ")}.`,
    scopeAnswer
      ? `The approved first-pass scope is respected: ${scopeAnswer}.`
      : "The generated layout exposes a coherent primary user journey and obvious next actions.",
    "The output is concrete enough for downstream frontend and backend planning.",
  ];
}

function buildSuccessCriteria(featureNames: string[], primaryJourneyAnswer?: string): string[] {
  const containsChinese = featureNames.some((item) => /[\u4e00-\u9fff]/.test(item));
  if (containsChinese) {
    return [
      `干系人能直接从首版设计中识别这 ${featureNames.length} 个功能切片。`,
      primaryJourneyAnswer
        ? `首版设计无需额外解释，就能体现这条主路径：${primaryJourneyAnswer}。`
        : "首版设计无需额外解释，就能体现主路径和关键操作。",
      "澄清后的 spec 与生成 UI 可以直接交给开发，不需要重新改写需求。",
    ];
  }

  return [
    `Stakeholders can identify all ${featureNames.length} feature slices directly from the first UI draft.`,
    primaryJourneyAnswer
      ? `The generated UI makes this primary journey understandable without additional explanation: ${primaryJourneyAnswer}.`
      : "The generated UI makes the primary journey understandable without additional verbal explanation.",
    "The clarified spec and generated UI can be handed to development without re-writing the requirement from scratch.",
  ];
}

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
    databaseStatus: "pending",
    implementationAttempts: 0,
    testAttempts: 0,
    failureHistory: [],
    generatedFiles: [],
  };
}

function createSpecMarkdown(
  requirement: ProductRequirement,
  pendingQuestions: SpecClarificationQuestion[],
): string {
  const featureSection = requirement.features
    .map(
      (feature, index) => [
        `### Feature ${index + 1}: ${feature.name}`,
        `- Description: ${feature.description}`,
        ...feature.acceptanceCriteria.map((criterion) => `- Acceptance: ${criterion}`),
      ].join("\n"),
    )
    .join("\n\n");

  const clarificationSection =
    requirement.clarifications.length > 0
      ? requirement.clarifications.map(
          (clarification) =>
            `- ${clarification.topic}: ${clarification.answer} (${clarification.rationale})`,
        )
      : ["- Pending: clarification answers will be collected before UI generation."];

  const pendingQuestionSection =
    pendingQuestions.length > 0
      ? [
          "",
          "## Pending Clarifications",
          ...pendingQuestions.map(
            (question, index) =>
              `${index + 1}. ${question.topic}: ${question.question} Recommended: ${question.recommendation}.`,
          ),
        ]
      : [];

  return [
    `# ${requirement.title}`,
    "",
    "## Summary",
    requirement.summary,
    "",
    "## Clarifications",
    ...clarificationSection,
    ...pendingQuestionSection,
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
    "## Original Request (Context Only)",
    requirement.rawInput,
    "",
    "## Feature Slices",
    featureSection,
    "",
  ].join("\n");
}

function normalizeRequirementTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^(我需要|我想要|我想做|帮我做|请帮我做|请做|做一个|生成一个|创建一个|需要一个|需要一套)\s*/u, "")
    .replace(/^(一个|一套|一个用于|一套用于)\s*/u, "")
    .replace(/(的)?(设计)?UI(界面)?$/iu, "")
    .replace(/(的网站|的系统|的平台|的项目)(设计)?$/u, (match) => match.replace(/(的)?(设计)?$/u, ""))
    .replace(/\s+/g, " ")
    .trim() || "产品项目";
}

function mentionsPlatform(rawRequirement: string): boolean {
  return /(desktop|web|mobile|app|responsive|h5|ios|android)/i.test(rawRequirement);
}

function mentionsScope(rawRequirement: string): boolean {
  return /(首页|single page|landing|all pages|整站|full product|browse|detail|详情|列表)/i.test(
    rawRequirement,
  );
}

function mentionsPrimaryJourney(rawRequirement: string): boolean {
  return /(discover|browse|watch|detail|follow|收藏|追番|搜索|排行榜|分类|详情)/i.test(rawRequirement);
}
