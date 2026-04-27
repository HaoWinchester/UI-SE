// 这个文件负责把当前项目里的 Speckit 生命周期产物落到 specs 目录结构里。
// 这里不只写 spec，还会生成 plan / research / data-model / contracts / quickstart / tasks，
// 并提供任务勾选能力，让 orchestrator 能真正贴着 Speckit 阶段往下跑。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CodeWorkspace, ProductRequirement, SpecArtifact, UiArtifact } from "../types/domain.js";
import { getFeatureCodePaths, getPrismaFeatureNames, slugifyFeatureName } from "../utils/feature-paths.js";

export interface SpeckitSpecWorkspace {
  branchName: string;
  featureDir: string;
  specPath: string;
  checklistPath: string;
  checklistPassed: boolean;
  checklistNotes: string[];
  pendingClarificationCount: number;
}

export interface SpeckitImplementationWorkspace {
  planPath: string;
  researchPath: string;
  dataModelPath: string;
  contractsDirPath: string;
  quickstartPath: string;
  tasksPath: string;
}

export async function persistSpeckitSpecWorkspace(
  baseDir: string,
  requirement: ProductRequirement,
  specMarkdown: string,
  pendingClarificationCount: number,
): Promise<SpeckitSpecWorkspace> {
  const specsDir = path.join(baseDir, "specs");
  await mkdir(specsDir, { recursive: true });

  const shortName = buildShortName(requirement.title);
  const featureNumber = await resolveNextFeatureNumber(specsDir, shortName);
  const branchName = `${String(featureNumber).padStart(3, "0")}-${shortName}`;
  const featureDir = path.join(specsDir, branchName);
  const checklistsDir = path.join(featureDir, "checklists");
  const contractsDir = path.join(featureDir, "contracts");

  await Promise.all([
    mkdir(featureDir, { recursive: true }),
    mkdir(checklistsDir, { recursive: true }),
    mkdir(contractsDir, { recursive: true }),
  ]);

  const specPath = path.join(featureDir, "spec.md");
  const checklistPath = path.join(checklistsDir, "requirements.md");
  const today = new Date().toISOString().slice(0, 10);
  const checklist = evaluateSpecQuality(requirement, specMarkdown, pendingClarificationCount);

  await writeFile(specPath, specMarkdown, "utf8");
  await writeFile(checklistPath, createRequirementsChecklist(branchName, today, checklist), "utf8");

  return {
    branchName,
    featureDir,
    specPath,
    checklistPath,
    checklistPassed: checklist.passed,
    checklistNotes: checklist.notes,
    pendingClarificationCount,
  };
}

async function resolveNextFeatureNumber(specsDir: string, shortName: string): Promise<number> {
  const entries = await readdir(specsDir, { withFileTypes: true }).catch(() => []);
  const matchingNumbers = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .map((name) => name.match(new RegExp(`^(\\d+)-${escapeRegExp(shortName)}$`)))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  return matchingNumbers.length > 0 ? Math.max(...matchingNumbers) + 1 : 1;
}

function buildShortName(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const asciiOnly = normalized
    .replace(/[\u4e00-\u9fa5]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (asciiOnly || "feature-request").slice(0, 32) || "feature-request";
}

function createRequirementsChecklist(
  branchName: string,
  today: string,
  checklist: {
    passed: boolean;
    notes: string[];
    items: Array<{ label: string; checked: boolean }>;
  },
): string {
  return [
    `# Specification Quality Checklist: ${branchName}`,
    "",
    "**Purpose**: Validate specification completeness and quality before proceeding to planning",
    `**Created**: ${today}`,
    `**Feature**: [spec.md](../spec.md)`,
    "",
    "## Content Quality",
    "",
    ...checklist.items
      .slice(0, 4)
      .map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
    "",
    "## Requirement Completeness",
    "",
    ...checklist.items
      .slice(4, 12)
      .map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
    "",
    "## Feature Readiness",
    "",
    ...checklist.items
      .slice(12)
      .map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
    "",
    "## Notes",
    "",
    `- Overall status: ${checklist.passed ? "passed" : "failed"}.`,
    ...checklist.notes.map((note) => `- ${note}`),
    "- Items marked incomplete require spec updates before running speckit-clarify or speckit-plan.",
    "",
  ].join("\n");
}

function evaluateSpecQuality(
  requirement: ProductRequirement,
  specMarkdown: string,
  pendingClarificationCount: number,
): {
  passed: boolean;
  notes: string[];
  items: Array<{ label: string; checked: boolean }>;
} {
  const hasNeedClarificationMarker = specMarkdown.includes("[NEEDS CLARIFICATION]");
  const mandatorySections = [
    "## Summary",
    "## Clarifications",
    "## User Scenarios",
    "## Functional Requirements",
    "## Success Criteria",
    "## Assumptions",
    "## Feature Slices",
  ];
  const mandatorySectionsPresent = mandatorySections.every((section) => specMarkdown.includes(section));
  const likelyImplementationLeak =
    /react|vue|next\.js|fastapi|prisma|postgresql|mysql|typescript|node\.js|docker compose|kubernetes/i.test(
      stripOriginalRequestSection(specMarkdown),
    );
  const requirementsTestable = requirement.acceptanceCriteria.length > 0 && requirement.features.length > 0;
  const successCriteriaReady = requirement.successCriteria.length > 0;
  const userScenariosReady = requirement.userScenarios.length > 0;
  const assumptionsReady = requirement.assumptions.length > 0;
  const scopeBounded = requirement.features.length > 0 && requirement.features.length <= 8;
  const clarificationsResolved = pendingClarificationCount === 0 && !hasNeedClarificationMarker;

  const items = [
    { label: "No implementation details (languages, frameworks, APIs)", checked: !likelyImplementationLeak },
    { label: "Focused on user value and business needs", checked: true },
    { label: "Written for non-technical stakeholders", checked: true },
    { label: "All mandatory sections completed", checked: mandatorySectionsPresent },
    { label: "No [NEEDS CLARIFICATION] markers remain", checked: !hasNeedClarificationMarker },
    { label: "Requirements are testable and unambiguous", checked: requirementsTestable },
    { label: "Success criteria are measurable", checked: successCriteriaReady },
    { label: "Success criteria are technology-agnostic", checked: !likelyImplementationLeak },
    { label: "All acceptance scenarios are defined", checked: userScenariosReady },
    { label: "Edge cases are identified", checked: requirement.acceptanceCriteria.length >= 3 },
    { label: "Scope is clearly bounded", checked: scopeBounded },
    { label: "Dependencies and assumptions identified", checked: assumptionsReady },
    { label: "All functional requirements have clear acceptance criteria", checked: requirementsTestable },
    { label: "User scenarios cover primary flows", checked: userScenariosReady },
    { label: "Feature meets measurable outcomes defined in Success Criteria", checked: successCriteriaReady },
    { label: "No implementation details leak into specification", checked: !likelyImplementationLeak },
  ];

  const notes: string[] = [];
  if (pendingClarificationCount > 0) {
    notes.push(`There are still ${pendingClarificationCount} pending clarification question(s) before Stitch submission.`);
  }
  if (!mandatorySectionsPresent) {
    notes.push("One or more mandatory spec sections are missing.");
  }
  if (likelyImplementationLeak) {
    notes.push("The clarified spec still appears to contain implementation-specific terms outside the raw request section.");
  }
  if (!requirementsTestable) {
    notes.push("Functional requirements or feature slices are still too thin for downstream implementation.");
  }
  if (!successCriteriaReady) {
    notes.push("Success criteria are missing or too weak for later validation.");
  }
  if (!userScenariosReady) {
    notes.push("Primary user scenarios are missing.");
  }

  const passed = clarificationsResolved && mandatorySectionsPresent && requirementsTestable && successCriteriaReady;
  return { passed, notes, items };
}

function stripOriginalRequestSection(specMarkdown: string): string {
  const marker = "## Original Request (Context Only)";
  const index = specMarkdown.indexOf(marker);
  if (index === -1) {
    return specMarkdown;
  }

  return specMarkdown.slice(0, index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function prepareSpeckitImplementationWorkspace(
  baseDir: string,
  requirement: ProductRequirement,
  specArtifact: SpecArtifact,
  codeWorkspace: CodeWorkspace,
  uiArtifact?: UiArtifact,
): Promise<SpeckitImplementationWorkspace> {
  if (!specArtifact.speckitFeatureDir || !specArtifact.speckitSpecPath) {
    throw new Error("Speckit feature directory is missing; cannot generate plan/tasks artifacts.");
  }

  const featureDir = specArtifact.speckitFeatureDir;
  const contractsDirPath = path.join(featureDir, "contracts");
  await mkdir(contractsDirPath, { recursive: true });

  const planPath = path.join(featureDir, "plan.md");
  const researchPath = path.join(featureDir, "research.md");
  const dataModelPath = path.join(featureDir, "data-model.md");
  const quickstartPath = path.join(featureDir, "quickstart.md");
  const tasksPath = path.join(featureDir, "tasks.md");
  const openApiPath = path.join(contractsDirPath, "openapi.yaml");

  await writeFile(
    planPath,
    buildPlanMarkdown(baseDir, requirement, specArtifact, codeWorkspace, uiArtifact),
    "utf8",
  );
  await writeFile(researchPath, buildResearchMarkdown(requirement, uiArtifact), "utf8");
  await writeFile(dataModelPath, buildDataModelMarkdown(requirement), "utf8");
  await writeFile(openApiPath, buildOpenApiContract(requirement), "utf8");
  await writeFile(quickstartPath, buildQuickstartMarkdown(requirement, codeWorkspace), "utf8");
  await writeFile(tasksPath, buildTasksMarkdown(requirement, codeWorkspace), "utf8");

  return {
    planPath,
    researchPath,
    dataModelPath,
    contractsDirPath,
    quickstartPath,
    tasksPath,
  };
}

export async function markSpeckitTasksComplete(tasksPath: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) {
    return;
  }

  const source = await readFile(tasksPath, "utf8");
  const targetIds = new Set(taskIds);
  const updated = source
    .split("\n")
    .map((line) => {
      const match = line.match(/^-\s\[( |x|X)\]\s(T\d{3})\b/);
      if (!match) {
        return line;
      }

      const taskId = match[2];
      if (!targetIds.has(taskId)) {
        return line;
      }

      return line.replace(/^-\s\[( |x|X)\]/, "- [x]");
    })
    .join("\n");

  await writeFile(tasksPath, updated, "utf8");
}

export function getSpeckitFeatureTaskIds(featureIndex: number): {
  frontend: string;
  backend: string;
  database: string;
  validation: string;
} {
  const start = 5 + featureIndex * 4;
  return {
    frontend: formatTaskId(start),
    backend: formatTaskId(start + 1),
    database: formatTaskId(start + 2),
    validation: formatTaskId(start + 3),
  };
}

export function getSpeckitFoundationTaskIds(): string[] {
  return ["T001", "T002", "T003", "T004"];
}

export function getSpeckitFinalTaskIds(featureCount: number): {
  flowValidation: string;
  acceptance: string;
} {
  const start = 5 + featureCount * 4;
  return {
    flowValidation: formatTaskId(start),
    acceptance: formatTaskId(start + 1),
  };
}

function buildPlanMarkdown(
  baseDir: string,
  requirement: ProductRequirement,
  specArtifact: SpecArtifact,
  codeWorkspace: CodeWorkspace,
  uiArtifact?: UiArtifact,
): string {
  const branchName = specArtifact.speckitBranchName ?? "unknown-branch";
  const specPath = displayPath(baseDir, specArtifact.speckitSpecPath ?? specArtifact.markdownPath);
  return [
    `# Implementation Plan: ${requirement.title}`,
    "",
    `**Branch**: \`${branchName}\`  `,
    `**Spec**: \`${specPath}\``,
    "",
    "## Summary",
    "",
    `基于已澄清需求与已批准的 ${uiArtifact?.runtime === "real" ? "真实 Stitch" : uiArtifact?.runtime ?? "unknown"} UI 产物，按前端、后端、数据库三条交付线同步实现 ${requirement.features.length} 个功能切片，并在每个切片后进入测试/修复闭环。`,
    "",
    "## Technical Context",
    "",
    "- Runtime: Node.js generated project + local preview server",
    "- Language: TypeScript / JavaScript",
    "- Framework: orchestrated generated workspace",
    "- Data layer: Prisma + PostgreSQL",
    `- External dependencies: Google Stitch (${uiArtifact?.runtime ?? "pending"}), local PostgreSQL`,
    "- Constraints: 前端页面必须以 Stitch 设计稿为视觉真源；需求未澄清或 UI 不是 real Stitch 时不得进入实现阶段。",
    "",
    "## Constitution Check",
    "",
    "- [x] Requirement clarity before generation",
    "- [x] Visible traceability across artifacts",
    "- [x] Customer approval gates preserved",
    "",
    "## Project Structure",
    "",
    "### Existing Project Context",
    "",
    `- \`${codeWorkspace.frontendDir}\``,
    `- \`${codeWorkspace.backendDir}\``,
    `- \`${codeWorkspace.databaseDir}\``,
    `- \`${codeWorkspace.testsDir}\``,
    "",
    "### Planned Additions",
    "",
    "- 细化前端页面与页面级交互代码",
    "- 后端路由、数据装配与运行时 API 契约",
    "- Prisma schema、migration、seed 与 repository",
    "- 全链路测试、验收与发布阻断规则",
    "",
    "## Phase 0: Research",
    "",
    "- 梳理 Stitch screen 与需求切片的映射关系",
    "- 识别页面间主导航、CTA、详情入口和数据依赖",
    "- 确认哪些功能需要真实数据库读写、哪些可先用只读数据",
    "",
    "## Phase 1: Design",
    "",
    "- 产出 data-model.md，明确每个功能切片的实体与字段",
    "- 产出 contracts/openapi.yaml，约定运行时 API",
    "- 产出 quickstart.md，说明本地生成项目的验证方式",
    "",
    "## Phase 2: Task Planning",
    "",
    "- 将每个功能切片拆成前端、后端、数据库、验证四类任务",
    "- 保持每个切片可独立实现、可独立测试、可独立修复",
    "",
  ].join("\n");
}

function buildResearchMarkdown(requirement: ProductRequirement, uiArtifact?: UiArtifact): string {
  const decisions = [
    {
      title: "需求真源",
      decision: "以澄清后的 spec.md 为唯一需求真源，而不是原始一句话。",
      rationale: "这样才能保证后续 Stitch、开发和测试都围绕同一份需求执行。",
    },
    {
      title: "设计真源",
      decision: uiArtifact?.runtime === "real" ? "以真实 Stitch screens 作为页面视觉真源。" : "等待真实 Stitch screens 后再进入代码复刻。",
      rationale: "不能只把设计图嵌入页面，必须把页面结构和交互复刻成真实代码。",
    },
    {
      title: "交付策略",
      decision: "按功能切片分阶段实现前端、后端、数据库，再做整站验收。",
      rationale: "每个切片可测、可修、可回放，能降低整站一次性失败风险。",
    },
  ];

  return [
    `# Research: ${requirement.title}`,
    "",
    ...decisions.flatMap((item) => [
      `## ${item.title}`,
      "",
      `- Decision: ${item.decision}`,
      `- Rationale: ${item.rationale}`,
      "- Alternatives considered: 直接从原始需求发设计、只做单页嵌入、跳过切片验证。",
      "",
    ]),
  ].join("\n");
}

function buildDataModelMarkdown(requirement: ProductRequirement): string {
  return [
    `# Data Model: ${requirement.title}`,
    "",
    ...requirement.features.flatMap((feature, index) => {
      const prismaNames = getPrismaFeatureNames(slugifyFeatureName(feature.name, feature.id));
      return [
        `## Entity ${index + 1}: ${prismaNames.modelName}`,
        "",
        `- Purpose: 支撑「${feature.name}」的运行时数据展示与状态更新。`,
        "- Core fields: id, title, description, status, actions, createdAt, updatedAt",
        "- Validation rules: title 必填；status 必须为可枚举状态；actions 为字符串数组。",
        "- Relationships: 当前版本按功能切片独立存储，后续可抽成跨页面共享实体。",
        "",
      ];
    }),
  ].join("\n");
}

function buildOpenApiContract(requirement: ProductRequirement): string {
  const featureSchemas = requirement.features
    .map(
      (feature) => `    ${feature.id}:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        status:
          type: string
        actions:
          type: array
          items:
            type: string`,
    )
    .join("\n");

  return [
    "openapi: 3.0.3",
    "info:",
    `  title: ${requirement.title} Generated API`,
    "  version: 0.1.0",
    "paths:",
    "  /api/health:",
    "    get:",
    "      responses:",
    "        '200':",
    "          description: Health check",
    "  /api/project:",
    "    get:",
    "      responses:",
    "        '200':",
    "          description: Project summary",
    "  /api/features:",
    "    get:",
    "      responses:",
    "        '200':",
    "          description: Feature records",
    "components:",
    "  schemas:",
    featureSchemas,
    "",
  ].join("\n");
}

function buildQuickstartMarkdown(requirement: ProductRequirement, codeWorkspace: CodeWorkspace): string {
  return [
    `# Quickstart: ${requirement.title}`,
    "",
    "## Local validation",
    "",
    "1. 运行 orchestrator，确保需求完成 Speckit 澄清并拿到 real Stitch UI。",
    `2. 进入生成项目目录：\`${codeWorkspace.rootDir}/app\``,
    "3. 执行 `npm start` 启动本地站点。",
    "4. 访问 `/index.html`、页面间导航、核心 CTA、`/api/project`、`/api/features`。",
    "5. 核验页面是否与 Stitch screen 一致，并确认所有 API 响应正常。",
    "",
    "## Acceptance expectations",
    "",
    ...requirement.successCriteria.map((criterion) => `- ${criterion}`),
    "",
  ].join("\n");
}

function buildTasksMarkdown(requirement: ProductRequirement, codeWorkspace: CodeWorkspace): string {
  const lines = [
    `# Tasks: ${requirement.title}`,
    "",
    `**Input**: Design documents from \`${displayPath(process.cwd(), codeWorkspace.rootDir)}\`  `,
    "**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`",
    "",
    "## Phase 1: Setup",
    "",
    "- [ ] T001 Confirm constitution, clarified spec, and approved Stitch UI are all ready",
    `- [ ] T002 Prepare generated workspace under ${codeWorkspace.rootDir}`,
    "",
    "## Phase 2: Foundational",
    "",
    "- [ ] T003 [P] Align shared runtime API contract in contracts/openapi.yaml",
    "- [ ] T004 [P] Finalize shared entity and validation assumptions in data-model.md",
    "",
  ];

  let nextTaskNumber = 5;
  requirement.features.forEach((feature, index) => {
    const paths = getFeatureCodePaths(codeWorkspace, feature);
    lines.push(`## Phase ${index + 3}: User Story ${index + 1}`);
    lines.push("");
    lines.push(`- [ ] ${formatTaskId(nextTaskNumber)} [US${index + 1}] Implement frontend slice in ${paths.frontendComponentPath}`);
    lines.push(`- [ ] ${formatTaskId(nextTaskNumber + 1)} [US${index + 1}] Implement backend route in ${paths.backendRoutePath}`);
    lines.push(`- [ ] ${formatTaskId(nextTaskNumber + 2)} [US${index + 1}] Implement Prisma/data layer in ${paths.databaseRepositoryPath}`);
    lines.push(`- [ ] ${formatTaskId(nextTaskNumber + 3)} [US${index + 1}] Validate, repair, and align the "${feature.name}" slice`);
    lines.push("");
    nextTaskNumber += 4;
  });

  lines.push("## Final Phase: Polish");
  lines.push("");
  lines.push(`- [ ] ${formatTaskId(nextTaskNumber)} Run flow-level validation, end-to-end checks, and generated project runtime verification`);
  lines.push(`- [ ] ${formatTaskId(nextTaskNumber + 1)} Prepare final customer preview and release readiness validation`);
  lines.push("");

  return lines.join("\n");
}

function formatTaskId(value: number): string {
  return `T${String(value).padStart(3, "0")}`;
}

function displayPath(baseDir: string, targetPath: string): string {
  if (!targetPath) {
    return targetPath;
  }

  if (!path.isAbsolute(targetPath)) {
    return targetPath.split(path.sep).join(path.posix.sep);
  }

  return path.relative(baseDir, targetPath).split(path.sep).join(path.posix.sep);
}
