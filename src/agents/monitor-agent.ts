// 这个文件定义监控 agent。
// 它负责在开发流程中检查当前实现是否逐渐偏离原始需求与验收目标。
import path from "node:path";
import { readFile } from "node:fs/promises";

import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  AlignmentFinding,
  AlignmentLayer,
  FeatureSpec,
  WorkflowJob,
} from "../types/domain.js";
import { getFeatureCodePaths, getPrismaFeatureNames } from "../utils/feature-paths.js";

// monitor-agent 用来检查“实现是否偏离了原始需求”。
export interface MonitorAgentInput {
  job: WorkflowJob;
  feature?: FeatureSpec;
}

export interface MonitorAgentOutput {
  aligned: boolean;
  findings: string[];
  structuredFindings: AlignmentFinding[];
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
    const structuredFindings: AlignmentFinding[] = [];

    if (!job.uiArtifact) {
      addFinding(structuredFindings, {
        layer: "ui",
        message: "The workflow has no downloaded UI artifact.",
        severity: "blocking",
        rule: "ui_artifact_present",
      });
    }

    if (job.uiArtifact && job.uiArtifact.reviewStatus !== "approved") {
      addFinding(structuredFindings, {
        layer: "ui",
        message: "The current UI artifact is not approved for implementation.",
        severity: "blocking",
        rule: "ui_artifact_approved",
      });
    }

    const unfinishedFeatures = job.requirement.features.filter(
      (feature) => feature.status !== "done",
    );
    if (unfinishedFeatures.length > 0) {
      addFinding(structuredFindings, {
        layer: "workflow",
        message: `${unfinishedFeatures.length} features are still not marked as done.`,
        severity: "blocking",
        rule: "all_features_completed",
      });
    }

    const partiallyImplemented = job.requirement.features.filter(
      (feature) =>
        feature.frontendStatus !== "done" ||
        feature.backendStatus !== "done" ||
        feature.databaseStatus !== "done",
    );
    if (partiallyImplemented.length > 0) {
      addFinding(structuredFindings, {
        layer: "workflow",
        message: `${partiallyImplemented.length} features do not have frontend, backend, and database delivery fully completed.`,
        severity: "blocking",
        rule: "delivery_tracks_completed",
      });
    }

    findings.push(...structuredFindings.map((finding) => finding.message));
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
        structuredFindings,
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
  const structuredFindings: AlignmentFinding[] = [];
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
    addFinding(structuredFindings, {
      layer: "ui",
      message: "This feature is running without an approved UI artifact.",
      severity: "blocking",
      rule: "feature_ui_approved",
    });
  }

  if (feature.frontendStatus !== "done" || feature.backendStatus !== "done" || feature.databaseStatus !== "done") {
    addFinding(structuredFindings, {
      layer: "workflow",
      message: "Frontend, backend, and database slices are not all marked as done for this feature.",
      severity: "blocking",
      rule: "feature_delivery_tracks_completed",
    });
  }

  const unresolvedFailures = feature.failureHistory.filter((failure) => failure.status !== "resolved");
  if (unresolvedFailures.length > 0) {
    addFinding(structuredFindings, {
      layer: "workflow",
      message: `${unresolvedFailures.length} remembered failures are still unresolved for this feature.`,
      severity: "blocking",
      rule: "feature_failure_history_resolved",
    });
  }

  for (const relativePath of requiredFiles) {
    const content = await readGeneratedFile(workspaceRoot, relativePath);
    if (!content) {
      addFinding(structuredFindings, {
        layer: inferLayerFromPath(relativePath),
        message: `Required generated file is missing: ${relativePath}`,
        severity: "blocking",
        filePath: relativePath,
        rule: "required_generated_file_present",
      });
      continue;
    }

    checkedFiles.push(relativePath);
  }

  const frontendContent = await readGeneratedFile(workspaceRoot, paths.frontendComponentPath);
  if (frontendContent && !frontendContent.includes(`data-feature-id="${feature.id}"`)) {
    addFinding(structuredFindings, {
      layer: "frontend",
      message: `Frontend component ${paths.frontendComponentPath} does not carry the expected feature marker.`,
      severity: "blocking",
      filePath: paths.frontendComponentPath,
      rule: "frontend_feature_marker",
    });
  }

  if (frontendContent && !frontendContent.includes('data-alignment-verified="true"')) {
    addFinding(structuredFindings, {
      layer: "frontend",
      message: `Frontend component ${paths.frontendComponentPath} is missing the alignment verification marker.`,
      severity: "blocking",
      filePath: paths.frontendComponentPath,
      rule: "frontend_alignment_marker",
    });
  }

  const backendRouteContent = await readGeneratedFile(workspaceRoot, paths.backendRoutePath);
  if (
    backendRouteContent &&
    (!backendRouteContent.includes(`create${prismaNames.modelName}`) ||
      !backendRouteContent.includes(`list${prismaNames.modelName}`))
  ) {
    addFinding(structuredFindings, {
      layer: "backend",
      message: `Backend route ${paths.backendRoutePath} is not fully connected to the Prisma repository.`,
      severity: "blocking",
      filePath: paths.backendRoutePath,
      rule: "backend_repository_connection",
    });
  }

  const repositoryContent = await readGeneratedFile(workspaceRoot, paths.databaseRepositoryPath);
  if (repositoryContent && !repositoryContent.includes(`prisma.${prismaNames.delegateName}`)) {
    addFinding(structuredFindings, {
      layer: "database",
      message: `Database repository ${paths.databaseRepositoryPath} is not using the expected Prisma delegate.`,
      severity: "blocking",
      filePath: paths.databaseRepositoryPath,
      rule: "database_delegate_usage",
    });
  }

  const prismaSchemaContent = await readGeneratedFile(workspaceRoot, paths.prismaSchemaPath);
  if (prismaSchemaContent && !prismaSchemaContent.includes(`model ${prismaNames.modelName} {`)) {
    addFinding(structuredFindings, {
      layer: "database",
      message: `Prisma schema ${paths.prismaSchemaPath} is missing model ${prismaNames.modelName}.`,
      severity: "blocking",
      filePath: paths.prismaSchemaPath,
      rule: "prisma_model_present",
    });
  }

  const migrationContent = await readGeneratedFile(workspaceRoot, paths.prismaMigrationPath);
  if (migrationContent && !migrationContent.includes(`"${prismaNames.tableName}"`)) {
    addFinding(structuredFindings, {
      layer: "database",
      message: `Migration ${paths.prismaMigrationPath} does not reference table ${prismaNames.tableName}.`,
      severity: "blocking",
      filePath: paths.prismaMigrationPath,
      rule: "migration_table_reference",
    });
  }

  const seedContent = await readGeneratedFile(workspaceRoot, paths.prismaSeedPath);
  if (seedContent && !seedContent.includes(`prisma.${prismaNames.delegateName}.upsert`)) {
    addFinding(structuredFindings, {
      layer: "database",
      message: `Seed script ${paths.prismaSeedPath} is not seeding the expected Prisma delegate.`,
      severity: "blocking",
      filePath: paths.prismaSeedPath,
      rule: "seed_delegate_usage",
    });
  }

  if (checkedFiles.length !== feature.generatedFiles.length) {
    addFinding(structuredFindings, {
      layer: "workflow",
      message: `Feature bookkeeping drift detected: expected ${feature.generatedFiles.length} generated files, but checked ${checkedFiles.length}.`,
      severity: "blocking",
      rule: "generated_file_bookkeeping",
    });
  }

  findings.push(...structuredFindings.map((finding) => finding.message));
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
      structuredFindings,
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

function addFinding(collection: AlignmentFinding[], finding: AlignmentFinding): void {
  collection.push(finding);
}

function inferLayerFromPath(relativePath: string): AlignmentLayer {
  if (relativePath.includes("/frontend/")) {
    return "frontend";
  }

  if (relativePath.includes("/backend/")) {
    return "backend";
  }

  if (relativePath.includes("/database/") || relativePath.includes("/prisma/")) {
    return "database";
  }

  return "workflow";
}
