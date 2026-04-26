// 这个文件定义测试执行层。
// 当前版本会真实检查生成出来的前端/后端代码文件，而不是只做纯随机的 mock 测试。
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
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
      paths.prismaSeedSqlPath,
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

    const seedSqlContent = await this.readGeneratedFile(paths.prismaSeedSqlPath);
    if (seedSqlContent && !seedSqlContent.includes("INSERT INTO")) {
      bugs.push(
        createBug(
          feature.id,
          "SQL seed is missing insert logic",
          `The generated SQL seed at ${paths.prismaSeedSqlPath} does not include an INSERT statement.`,
        ),
      );
    }

    const latestDatabaseRun = [...job.databaseRuns]
      .reverse()
      .find((databaseRun) => databaseRun.featureId === feature.id);
    if (!latestDatabaseRun || latestDatabaseRun.status !== "applied") {
      bugs.push(
        createBug(
          feature.id,
          "Database artifacts were not applied to PostgreSQL",
          latestDatabaseRun
            ? `The latest database run for ${feature.id} failed: ${latestDatabaseRun.summary}`
            : `No database execution record was found for feature ${feature.id}.`,
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
    const missingArtifacts = job.requirement.features.filter((feature) => feature.generatedFiles.length < 9);
    const failedDatabaseRuns = job.databaseRuns.filter((databaseRun) => databaseRun.status !== "applied");
    const projectRuntimeIssues = await this.validateGeneratedProject(job);

    return {
      id: randomUUID(),
      scope: "flow",
      passed:
        unfinished.length === 0 &&
        missingArtifacts.length === 0 &&
        failedDatabaseRuns.length === 0 &&
        projectRuntimeIssues.length === 0,
      summary:
        unfinished.length === 0 &&
        missingArtifacts.length === 0 &&
        failedDatabaseRuns.length === 0 &&
        projectRuntimeIssues.length === 0
          ? "All generated feature slices passed the end-to-end flow validation and the generated project booted successfully."
          : `Flow validation blocked: ${unfinished.length} unfinished features, ${missingArtifacts.length} features missing generated code, ${failedDatabaseRuns.length} failed database executions, ${projectRuntimeIssues.length} project runtime issue(s).`,
      bugs: projectRuntimeIssues.map((issue) =>
        createBug("flow-runtime", "Generated project runtime failed", issue),
      ),
      createdAt: new Date().toISOString(),
    };
  }

  async runAcceptanceTests(job: WorkflowJob): Promise<TestRun> {
    const openBugs = job.bugReports.filter((bug) => bug.status === "open");
    const featureWithTodo = await this.findFeaturesWithTodo(job);
    const runtimeAcceptanceIssues = await this.validateGeneratedProject(job, true);

    return {
      id: randomUUID(),
      scope: "acceptance",
      passed: openBugs.length === 0 && featureWithTodo.length === 0 && runtimeAcceptanceIssues.length === 0,
      summary:
        openBugs.length === 0 && featureWithTodo.length === 0 && runtimeAcceptanceIssues.length === 0
          ? "Acceptance tests passed with no remaining open bugs, TODO placeholders, or runtime preview issues."
          : `Acceptance tests blocked by ${openBugs.length} open bugs, ${featureWithTodo.length} features with leftover TODO markers, and ${runtimeAcceptanceIssues.length} runtime preview issue(s).`,
      bugs: runtimeAcceptanceIssues.map((issue) =>
        createBug("acceptance-runtime", "Generated project acceptance failed", issue),
      ),
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

  private async validateGeneratedProject(
    job: WorkflowJob,
    includeHtmlChecks = false,
  ): Promise<string[]> {
    const issues: string[] = [];
    const artifact = job.generatedProjectArtifact;
    if (!artifact) {
      return ["No generated runnable project artifact was created."];
    }

    const serverAbsolutePath = path.join(this.baseDir, artifact.serverEntryPath);
    const projectAbsolutePath = path.join(this.baseDir, artifact.directoryPath);
    const port = await findAvailablePort();
    const child = spawn(process.execPath, [serverAbsolutePath], {
      cwd: projectAbsolutePath,
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: "ignore",
    });

    try {
      await waitForServer(`http://127.0.0.1:${port}/api/health`);
      const health = await readJson<{ ok: boolean }>(`http://127.0.0.1:${port}/api/health`);
      if (!health.ok) {
        issues.push("Generated project health endpoint did not return ok=true.");
      }

      const projectPayload = await readJson<{ title: string; features: unknown[] }>(
        `http://127.0.0.1:${port}/api/project`,
      );
      if (projectPayload.title !== job.requirement.title) {
        issues.push("Generated project title does not match the clarified requirement title.");
      }

      const featurePayload = await readJson<{ features: Array<{ id: string; records: unknown[] }> }>(
        `http://127.0.0.1:${port}/api/features`,
      );
      if (featurePayload.features.length !== job.requirement.features.length) {
        issues.push("Generated project feature API does not expose the expected number of feature slices.");
      }

      if (featurePayload.features.some((feature) => !Array.isArray(feature.records))) {
        issues.push("Generated project feature API returned a malformed records payload.");
      }

      const runtimeDataErrors = featurePayload.features.flatMap((feature) => {
        if (!Array.isArray(feature.records)) {
          return [];
        }

        return feature.records
          .map((record) => parseRuntimeRecordIssue(feature.id, record))
          .filter((issue): issue is string => Boolean(issue));
      });
      issues.push(...runtimeDataErrors);

      if (includeHtmlChecks) {
        const html = await fetchText(`http://127.0.0.1:${port}/`);
        const usingRealStitchScreens = job.uiArtifact?.runtime === "real" && (job.uiArtifact.screens?.length ?? 0) > 0;
        if (usingRealStitchScreens) {
          if (!html.includes("Stitch 页面流")) {
            issues.push("Generated project homepage does not expose the Stitch multi-screen navigation.");
          }

          const publicDir = path.join(this.baseDir, artifact.publicDirPath);
          const screenFiles = (await readdir(publicDir))
            .filter(
              (fileName) =>
                fileName.endsWith(".html") &&
                !["index.html", "runtime.html", "catalog.html", "detail.html", "approved-ui.html"].includes(fileName),
            )
            .sort();
          if (screenFiles.length !== Math.max((job.uiArtifact?.screens?.length ?? 1) - 1, 0)) {
            issues.push("Generated project did not emit the expected number of Stitch-linked HTML pages.");
          }

          for (const screenFile of screenFiles) {
            const screenHtml = await fetchText(`http://127.0.0.1:${port}/${screenFile}`);
            if (!screenHtml.includes("Stitch 页面流")) {
              issues.push(`Generated project ${screenFile} does not expose the Stitch multi-screen navigation.`);
            }
          }
        } else {
          if (!html.includes(job.requirement.title)) {
            issues.push("Generated project homepage does not render the clarified requirement title.");
          }

          if (!html.includes('src="./app.js"')) {
            issues.push("Generated project homepage does not load the runtime app.js entry.");
          }
        }
      }
    } catch (error) {
      issues.push(
        `Generated project could not boot or respond correctly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      child.kill("SIGTERM");
    }

    return issues;
  }
}

function parseRuntimeRecordIssue(featureId: string, record: unknown): string | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  const candidate = record as {
    title?: unknown;
    status?: unknown;
    actions?: unknown;
  };
  const title = typeof candidate.title === "string" ? candidate.title : undefined;
  const status = typeof candidate.status === "string" ? candidate.status : undefined;
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter((item): item is string => typeof item === "string")
    : [];

  if (title === "数据库读取失败" || status === "error") {
    return `Generated project feature ${featureId} returned a runtime data error: ${
      actions[0] ?? "unknown database access failure"
    }`;
  }

  return undefined;
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

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve a local TCP port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore and retry while the server is still booting
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out while waiting for generated project server: ${url}`);
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}
