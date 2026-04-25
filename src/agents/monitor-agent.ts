// 这个文件定义监控 agent。
// 它负责在开发流程中检查当前实现是否逐渐偏离原始需求与验收目标。
import path from "node:path";
import { readFile } from "node:fs/promises";

import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec, WorkflowJob } from "../types/domain.js";
import { getFeatureCodePaths, getPrismaFeatureNames } from "../utils/feature-paths.js";

// monitor-agent 用来检查“实现是否偏离了原始需求”。
export interface MonitorAgentInput {
  job: WorkflowJob;
  feature?: FeatureSpec;
}

export interface MonitorAgentOutput {
  aligned: boolean;
  findings: string[];
  summary: string;
  scope: "feature" | "job";
  checkedFiles: string[];
}

export class MonitorAgent implements Agent<MonitorAgentInput, MonitorAgentOutput> {
  readonly definition = agentRegistry["monitor-agent"];

  async run(
    { job, feature }: MonitorAgentInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<MonitorAgentOutput>> {
    if (feature) {
      return evaluateFeatureAlignment(job, feature, context.workspaceRoot);
    }

    const findings: string[] = [];

    if (!job.uiArtifact) {
      findings.push("The workflow has no downloaded UI artifact.");
    }

    if (job.uiArtifact && job.uiArtifact.reviewStatus !== "approved") {
      findings.push("The current UI artifact is not approved for implementation.");
    }

    const unfinishedFeatures = job.requirement.features.filter(
      (feature) => feature.status !== "done",
    );
    if (unfinishedFeatures.length > 0) {
      findings.push(`${unfinishedFeatures.length} features are still not marked as done.`);
    }

    const partiallyImplemented = job.requirement.features.filter(
      (feature) =>
        feature.frontendStatus !== "done" ||
        feature.backendStatus !== "done" ||
        feature.databaseStatus !== "done",
    );
    if (partiallyImplemented.length > 0) {
      findings.push(
        `${partiallyImplemented.length} features do not have frontend, backend, and database delivery fully completed.`,
      );
    }

    const aligned = findings.length === 0;

    return {
      status: aligned ? "completed" : "blocked",
      summary: aligned
        ? "Implementation still matches the approved requirement."
        : `Alignment check found gaps: ${findings.join(" ")}`,
      nextAction: aligned ? "run_acceptance_tests" : "investigate_alignment_gap",
      changedFiles: [],
      fileEdits: [],
      artifacts: [],
      risks: findings,
      data: {
        aligned,
        findings,
        summary: aligned
          ? "Implementation still matches the approved requirement."
          : `Alignment check found gaps: ${findings.join(" ")}`,
        scope: "job",
        checkedFiles: [],
      },
    };
  }
}

async function evaluateFeatureAlignment(
  job: WorkflowJob,
  feature: FeatureSpec,
  workspaceRoot: string,
): Promise<AgentResult<MonitorAgentOutput>> {
  const findings: string[] = [];
  const checkedFiles: string[] = [];
  const paths = getFeatureCodePaths(job.codeWorkspace, feature);
  const prismaNames = getPrismaFeatureNames(paths.featureSlug);
  const requiredFiles = [
    paths.frontendComponentPath,
    paths.frontendStylesPath,
    paths.backendRoutePath,
    paths.backendSchemaPath,
    paths.databaseRepositoryPath,
    paths.prismaSchemaPath,
    paths.prismaMigrationPath,
    paths.prismaSeedPath,
  ];

  if (!job.uiArtifact || job.uiArtifact.reviewStatus !== "approved") {
    findings.push("This feature is running without an approved UI artifact.");
  }

  if (feature.frontendStatus !== "done" || feature.backendStatus !== "done" || feature.databaseStatus !== "done") {
    findings.push("Frontend, backend, and database slices are not all marked as done for this feature.");
  }

  const unresolvedFailures = feature.failureHistory.filter((failure) => failure.status !== "resolved");
  if (unresolvedFailures.length > 0) {
    findings.push(`${unresolvedFailures.length} remembered failures are still unresolved for this feature.`);
  }

  for (const relativePath of requiredFiles) {
    const content = await readGeneratedFile(workspaceRoot, relativePath);
    if (!content) {
      findings.push(`Required generated file is missing: ${relativePath}`);
      continue;
    }

    checkedFiles.push(relativePath);
  }

  const frontendContent = await readGeneratedFile(workspaceRoot, paths.frontendComponentPath);
  if (frontendContent && !frontendContent.includes(`data-feature-id="${feature.id}"`)) {
    findings.push(`Frontend component ${paths.frontendComponentPath} does not carry the expected feature marker.`);
  }

  const backendRouteContent = await readGeneratedFile(workspaceRoot, paths.backendRoutePath);
  if (
    backendRouteContent &&
    (!backendRouteContent.includes(`create${prismaNames.modelName}`) ||
      !backendRouteContent.includes(`list${prismaNames.modelName}`))
  ) {
    findings.push(`Backend route ${paths.backendRoutePath} is not fully connected to the Prisma repository.`);
  }

  const repositoryContent = await readGeneratedFile(workspaceRoot, paths.databaseRepositoryPath);
  if (repositoryContent && !repositoryContent.includes(`prisma.${prismaNames.delegateName}`)) {
    findings.push(`Database repository ${paths.databaseRepositoryPath} is not using the expected Prisma delegate.`);
  }

  const prismaSchemaContent = await readGeneratedFile(workspaceRoot, paths.prismaSchemaPath);
  if (prismaSchemaContent && !prismaSchemaContent.includes(`model ${prismaNames.modelName} {`)) {
    findings.push(`Prisma schema ${paths.prismaSchemaPath} is missing model ${prismaNames.modelName}.`);
  }

  const migrationContent = await readGeneratedFile(workspaceRoot, paths.prismaMigrationPath);
  if (migrationContent && !migrationContent.includes(`"${prismaNames.tableName}"`)) {
    findings.push(`Migration ${paths.prismaMigrationPath} does not reference table ${prismaNames.tableName}.`);
  }

  const seedContent = await readGeneratedFile(workspaceRoot, paths.prismaSeedPath);
  if (seedContent && !seedContent.includes(`prisma.${prismaNames.delegateName}.upsert`)) {
    findings.push(`Seed script ${paths.prismaSeedPath} is not seeding the expected Prisma delegate.`);
  }

  if (checkedFiles.length !== feature.generatedFiles.length) {
    findings.push(
      `Feature bookkeeping drift detected: expected ${feature.generatedFiles.length} generated files, but checked ${checkedFiles.length}.`,
    );
  }

  const aligned = findings.length === 0;
  const summary = aligned
    ? `Feature "${feature.name}" still matches the approved requirement and generated architecture.`
    : `Feature alignment drift detected for "${feature.name}": ${findings.join(" ")}`;

  return {
    status: aligned ? "completed" : "blocked",
    summary,
    nextAction: aligned ? "continue_delivery" : "investigate_feature_alignment_gap",
    changedFiles: [],
    fileEdits: [],
    artifacts: [],
    risks: findings,
    data: {
      aligned,
      findings,
      summary,
      scope: "feature",
      checkedFiles,
    },
  };
}

async function readGeneratedFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    return undefined;
  }
}
