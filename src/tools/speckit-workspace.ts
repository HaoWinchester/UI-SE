// 这个文件负责把当前项目里的澄清 spec 同步到 Speckit 期望的 specs 目录结构里。
// 这样后续如果要继续用 speckit-clarify / speckit-plan / speckit-tasks，就能直接接上。
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProductRequirement } from "../types/domain.js";

export interface SpeckitSpecWorkspace {
  branchName: string;
  featureDir: string;
  specPath: string;
  checklistPath: string;
}

export async function persistSpeckitSpecWorkspace(
  baseDir: string,
  requirement: ProductRequirement,
  specMarkdown: string,
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

  await writeFile(specPath, specMarkdown, "utf8");
  await writeFile(checklistPath, createRequirementsChecklist(branchName, today), "utf8");

  return {
    branchName,
    featureDir,
    specPath,
    checklistPath,
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

function createRequirementsChecklist(branchName: string, today: string): string {
  return [
    `# Specification Quality Checklist: ${branchName}`,
    "",
    "**Purpose**: Validate specification completeness and quality before proceeding to planning",
    `**Created**: ${today}`,
    `**Feature**: [spec.md](../spec.md)`,
    "",
    "## Content Quality",
    "",
    "- [ ] No implementation details (languages, frameworks, APIs)",
    "- [ ] Focused on user value and business needs",
    "- [ ] Written for non-technical stakeholders",
    "- [ ] All mandatory sections completed",
    "",
    "## Requirement Completeness",
    "",
    "- [ ] No [NEEDS CLARIFICATION] markers remain",
    "- [ ] Requirements are testable and unambiguous",
    "- [ ] Success criteria are measurable",
    "- [ ] Success criteria are technology-agnostic",
    "- [ ] All acceptance scenarios are defined",
    "- [ ] Edge cases are identified",
    "- [ ] Scope is clearly bounded",
    "- [ ] Dependencies and assumptions identified",
    "",
    "## Feature Readiness",
    "",
    "- [ ] All functional requirements have clear acceptance criteria",
    "- [ ] User scenarios cover primary flows",
    "- [ ] Feature meets measurable outcomes defined in Success Criteria",
    "- [ ] No implementation details leak into specification",
    "",
    "## Notes",
    "",
    "- Items marked incomplete require spec updates before running speckit-clarify or speckit-plan.",
    "",
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
