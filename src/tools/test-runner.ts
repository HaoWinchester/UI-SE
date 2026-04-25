// 这个文件定义测试执行层。
// 当前版本会真实检查生成出来的前端/后端代码文件，而不是只做纯随机的 mock 测试。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BugReport, FeatureSpec, TestRun, WorkflowJob } from "../types/domain.js";
import { getFeatureCodePaths, getPrismaFeatureNames } from "../utils/feature-paths.js";

// TestRunner 是测试执行层的抽象。
// 它会读取当前工作区里生成的代码文件，并根据规则给出测试结果。
export interface TestRunner {
  runFeatureTests(job: WorkflowJob, feature: FeatureSpec): Promise<TestRun>;
  runFlowTests(job: WorkflowJob): Promise<TestRun>;
  runAcceptanceTests(job: WorkflowJob): Promise<TestRun>;
}

export class GeneratedWorkspaceTestRunner implements TestRunner {
  constructor(private readonly baseDir: string) {}

  async runFeatureTests(job: WorkflowJob, feature: FeatureSpec): Promise<TestRun> {
    const bugs: BugReport[] = [];
    const paths = getFeatureCodePaths(job.codeWorkspace, feature);
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
    const prismaNames = getPrismaFeatureNames(paths.featureSlug);

    for (const relativePath of requiredFiles) {
      const content = await this.readGeneratedFile(relativePath);
      if (!content) {
        bugs.push(
          createBug(feature.id, "Missing generated file", `${relativePath} was not generated for this feature.`),
        );
      }
    }

    const frontendContent = await this.readGeneratedFile(paths.frontendComponentPath);
    if (frontendContent && !frontendContent.includes(`data-feature-id="${feature.id}"`)) {
      bugs.push(
        createBug(
          feature.id,
          "Frontend feature marker is missing",
          `The generated frontend component at ${paths.frontendComponentPath} does not expose the expected data-feature-id marker.`,
        ),
      );
    }

    if (frontendContent && /TODO:/i.test(frontendContent)) {
      bugs.push(
        createBug(
          feature.id,
          "Frontend still contains TODO placeholders",
          `The generated frontend component at ${paths.frontendComponentPath} still contains unfinished TODO placeholders.`,
        ),
      );
    }

    const backendRouteContent = await this.readGeneratedFile(paths.backendRoutePath);
    if (backendRouteContent && !backendRouteContent.includes("export async function handle")) {
      bugs.push(
        createBug(
          feature.id,
          "Backend handler export is missing",
          `The generated backend route at ${paths.backendRoutePath} does not expose an async handler export.`,
        ),
      );
    }

    if (backendRouteContent && /TODO:/i.test(backendRouteContent)) {
      bugs.push(
        createBug(
          feature.id,
          "Backend still contains TODO placeholders",
          `The generated backend route at ${paths.backendRoutePath} still contains unfinished TODO placeholders.`,
        ),
      );
    }

    if (backendRouteContent && !backendRouteContent.includes(`create${prismaNames.modelName}`)) {
      bugs.push(
        createBug(
          feature.id,
          "Backend route is not connected to the Prisma repository",
          `The generated backend route at ${paths.backendRoutePath} does not appear to call create${prismaNames.modelName} from the database layer.`,
        ),
      );
    }

    const repositoryContent = await this.readGeneratedFile(paths.databaseRepositoryPath);
    if (repositoryContent && !repositoryContent.includes("new PrismaClient()")) {
      bugs.push(
        createBug(
          feature.id,
          "Database repository is missing a Prisma client",
          `The generated repository at ${paths.databaseRepositoryPath} does not instantiate PrismaClient.`,
        ),
      );
    }

    if (repositoryContent && /TODO:/i.test(repositoryContent)) {
      bugs.push(
        createBug(
          feature.id,
          "Database repository still contains TODO placeholders",
          `The generated repository at ${paths.databaseRepositoryPath} still contains unfinished TODO placeholders.`,
        ),
      );
    }

    const prismaSchemaContent = await this.readGeneratedFile(paths.prismaSchemaPath);
    if (prismaSchemaContent && !prismaSchemaContent.includes('provider = "postgresql"')) {
      bugs.push(
        createBug(
          feature.id,
          "Prisma schema is not configured for PostgreSQL",
          `The generated Prisma schema at ${paths.prismaSchemaPath} is missing the postgresql datasource configuration.`,
        ),
      );
    }

    if (prismaSchemaContent && !prismaSchemaContent.includes(`model ${prismaNames.modelName} {`)) {
      bugs.push(
        createBug(
          feature.id,
          "Prisma model is missing from schema",
          `The generated Prisma schema at ${paths.prismaSchemaPath} does not include model ${prismaNames.modelName}.`,
        ),
      );
    }

    const migrationContent = await this.readGeneratedFile(paths.prismaMigrationPath);
    if (migrationContent && !migrationContent.includes("CREATE TABLE")) {
      bugs.push(
        createBug(
          feature.id,
          "Database migration does not create a table",
          `The generated migration at ${paths.prismaMigrationPath} does not contain a CREATE TABLE statement.`,
        ),
      );
    }

    const seedContent = await this.readGeneratedFile(paths.prismaSeedPath);
    if (seedContent && !seedContent.includes(".upsert(")) {
      bugs.push(
        createBug(
          feature.id,
          "Seed script is missing upsert logic",
          `The generated seed at ${paths.prismaSeedPath} does not include an upsert call.`,
        ),
      );
    }

    if (seedContent && /TODO:/i.test(seedContent)) {
      bugs.push(
        createBug(
          feature.id,
          "Seed script still contains TODO placeholders",
          `The generated seed at ${paths.prismaSeedPath} still contains unfinished TODO placeholders.`,
        ),
      );
    }

    const passed = bugs.length === 0;
    return {
      id: randomUUID(),
      scope: "feature",
      targetId: feature.id,
      passed,
      summary: passed
        ? `${feature.name} passed generated-code validation.`
        : `${feature.name} failed generated-code validation with ${bugs.length} issue(s).`,
      bugs,
      createdAt: new Date().toISOString(),
    };
  }

  async runFlowTests(job: WorkflowJob): Promise<TestRun> {
    const unfinished = job.requirement.features.filter((feature) => feature.status !== "done");
    const missingArtifacts = job.requirement.features.filter((feature) => feature.generatedFiles.length < 8);

    return {
      id: randomUUID(),
      scope: "flow",
      passed: unfinished.length === 0 && missingArtifacts.length === 0,
      summary:
        unfinished.length === 0 && missingArtifacts.length === 0
          ? "All generated feature slices passed the end-to-end flow validation."
          : `Flow validation blocked: ${unfinished.length} unfinished features, ${missingArtifacts.length} features missing generated code.`,
      bugs: [],
      createdAt: new Date().toISOString(),
    };
  }

  async runAcceptanceTests(job: WorkflowJob): Promise<TestRun> {
    const openBugs = job.bugReports.filter((bug) => bug.status === "open");
    const featureWithTodo = await this.findFeaturesWithTodo(job);

    return {
      id: randomUUID(),
      scope: "acceptance",
      passed: openBugs.length === 0 && featureWithTodo.length === 0,
      summary:
        openBugs.length === 0 && featureWithTodo.length === 0
          ? "Acceptance tests passed with no remaining open bugs or TODO placeholders."
          : `Acceptance tests blocked by ${openBugs.length} open bugs and ${featureWithTodo.length} features with leftover TODO markers.`,
      bugs: [],
      createdAt: new Date().toISOString(),
    };
  }

  private async findFeaturesWithTodo(job: WorkflowJob): Promise<FeatureSpec[]> {
    const featuresWithTodo: FeatureSpec[] = [];

    for (const feature of job.requirement.features) {
      const hasTodo = await Promise.all(
        feature.generatedFiles.map(async (relativePath) => {
          const content = await this.readGeneratedFile(relativePath);
          return Boolean(content && /TODO:/i.test(content));
        }),
      );

      if (hasTodo.some(Boolean)) {
        featuresWithTodo.push(feature);
      }
    }

    return featuresWithTodo;
  }

  private async readGeneratedFile(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(path.join(this.baseDir, relativePath), "utf8");
    } catch {
      return undefined;
    }
  }
}

function createBug(featureId: string, title: string, description: string): BugReport {
  return {
    id: randomUUID(),
    featureId,
    title,
    description,
    severity: "medium",
    status: "open",
  };
}
