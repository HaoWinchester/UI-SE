// 这个文件定义数据库 agent。
// 它会为当前功能点生成 Prisma + PostgreSQL 所需的数据模型、迁移、种子数据和仓储层代码。
import path from "node:path";
import { readFile } from "node:fs/promises";

import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  CodeFileEdit,
  CodeWorkspace,
  FeatureSpec,
  ProductRequirement,
} from "../types/domain.js";
import { OpenAiJsonModelClient } from "../tools/model-client.js";
import { getFeatureCodePaths, getPrismaFeatureNames, toPascalCase } from "../utils/feature-paths.js";

export interface DbAgentInput {
  feature: FeatureSpec;
  requirement: ProductRequirement;
  codeWorkspace: CodeWorkspace;
}

export interface DbAgentOutput {
  summary: string;
  implementationPlan: string[];
  generatedFiles: string[];
  runtimeUsed: "template" | "model";
}

interface ModelGeneratedDatabasePayload {
  summary: string;
  implementationPlan: string[];
  files: Array<{
    path: string;
    content: string;
    description?: string;
  }>;
}

export class DbAgent implements Agent<DbAgentInput, DbAgentOutput> {
  readonly definition = agentRegistry["db-agent"];

  async run(
    { feature, requirement, codeWorkspace }: DbAgentInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<DbAgentOutput>> {
    const paths = getFeatureCodePaths(codeWorkspace, feature);
    const prismaNames = getPrismaFeatureNames(paths.featureSlug);
    const requestTypeName = `${toPascalCase(paths.featureSlug)}PayloadRequest`;
    const existingSchema = await readOptionalWorkspaceFile(context.workspaceRoot, paths.prismaSchemaPath);

    const fallbackFileEdits = buildTemplateDatabaseEdits({
      feature,
      requirement,
      repositoryPath: paths.databaseRepositoryPath,
      prismaSchemaPath: paths.prismaSchemaPath,
      prismaMigrationPath: paths.prismaMigrationPath,
      prismaSeedPath: paths.prismaSeedPath,
      prismaSeedSqlPath: paths.prismaSeedSqlPath,
      backendSchemaPath: paths.backendSchemaPath,
      prismaNames,
      requestTypeName,
      existingSchema,
    });

    const modelPayload =
      context.runtimeMode === "model"
        ? await tryGenerateDatabaseWithModel({
            systemPrompt: this.definition.systemPrompt,
            model: context.model.model,
            temperature: context.model.temperature,
            feature,
            requirement,
            requestTypeName,
            paths,
            prismaNames,
            existingSchema,
          })
        : undefined;

    const fileEdits = modelPayload?.files.length
      ? normalizeModelFileEdits(modelPayload.files, [
          paths.databaseRepositoryPath,
          paths.prismaSchemaPath,
          paths.prismaMigrationPath,
          paths.prismaSeedPath,
          paths.prismaSeedSqlPath,
        ])
      : fallbackFileEdits;

    const implementationPlan = modelPayload?.implementationPlan ?? [
      `为 "${feature.name}" 设计 Prisma 数据模型和 PostgreSQL 表结构。`,
      "生成 migration、seed、可执行 SQL seed 和 repository，让后端接口可以连接真实数据层。",
      "保留一条明确的 TODO 给修复环节验证数据库代码也能被自动修复。",
    ];

    const summary =
      modelPayload?.summary ??
      `已为功能 "${feature.name}" 生成 Prisma + PostgreSQL 数据层代码。`;

    return {
      status: "completed",
      summary,
      nextAction: "run_feature_tests",
      changedFiles: fileEdits.map((edit) => edit.path),
      fileEdits,
      artifacts: [],
      risks: [],
      data: {
        summary,
        implementationPlan,
        generatedFiles: fileEdits.map((edit) => edit.path),
        runtimeUsed: modelPayload ? "model" : "template",
      },
    };
  }
}

async function tryGenerateDatabaseWithModel(input: {
  systemPrompt: string;
  model: string;
  temperature: number;
  feature: FeatureSpec;
  requirement: ProductRequirement;
  requestTypeName: string;
  paths: ReturnType<typeof getFeatureCodePaths>;
  prismaNames: ReturnType<typeof getPrismaFeatureNames>;
  existingSchema?: string;
}): Promise<ModelGeneratedDatabasePayload | undefined> {
  try {
    const client = new OpenAiJsonModelClient();
    return await client.generateJson<ModelGeneratedDatabasePayload>({
      model: input.model,
      temperature: input.temperature,
      systemPrompt: input.systemPrompt,
      outputShape:
        '{ "summary": "string", "implementationPlan": ["string"], "files": [{ "path": "string", "content": "string", "description": "string" }] }',
      userPrompt: [
        `Feature name: ${input.feature.name}`,
        `Feature description: ${input.feature.description}`,
        `Requirement summary: ${input.requirement.summary}`,
        `Acceptance criteria: ${input.feature.acceptanceCriteria.join(" | ")}`,
        `Prisma model name: ${input.prismaNames.modelName}`,
        `Prisma delegate name: ${input.prismaNames.delegateName}`,
        `PostgreSQL table name: ${input.prismaNames.tableName}`,
        `Write database files: ${input.paths.databaseRepositoryPath}, ${input.paths.prismaSchemaPath}, ${input.paths.prismaMigrationPath}, ${input.paths.prismaSeedPath}, ${input.paths.prismaSeedSqlPath}.`,
        `The repository should consume ${input.requestTypeName} from the backend schema.`,
        input.existingSchema
          ? `Existing schema.prisma content:\n${input.existingSchema}`
          : "No existing schema.prisma content yet.",
        "Generate Prisma + PostgreSQL artifacts only. Keep one realistic TODO comment so the automated fix loop has a concrete database issue to repair later.",
      ].join("\n"),
    });
  } catch {
    return undefined;
  }
}

function normalizeModelFileEdits(
  files: ModelGeneratedDatabasePayload["files"],
  fallbackPaths: string[],
): CodeFileEdit[] {
  return files.map((file, index) => ({
    path: file.path?.trim() || fallbackPaths[index] || fallbackPaths[0],
    content: file.content,
    description: file.description,
  }));
}

function buildTemplateDatabaseEdits(input: {
  feature: FeatureSpec;
  requirement: ProductRequirement;
  repositoryPath: string;
  prismaSchemaPath: string;
  prismaMigrationPath: string;
  prismaSeedPath: string;
  prismaSeedSqlPath: string;
  backendSchemaPath: string;
  requestTypeName: string;
  prismaNames: ReturnType<typeof getPrismaFeatureNames>;
  existingSchema?: string;
}): CodeFileEdit[] {
  const repositoryImportPath = toImportPath(input.repositoryPath, input.backendSchemaPath);
  const repositoryContent = [
    'import { PrismaClient } from "@prisma/client";',
    `import type { ${input.requestTypeName} } from "${repositoryImportPath}";`,
    "",
    "const prisma = new PrismaClient();",
    "",
    `export async function list${input.prismaNames.modelName}() {`,
    `  return prisma.${input.prismaNames.delegateName}.findMany({`,
    '    orderBy: { createdAt: "desc" },',
    "  });",
    "}",
    "",
    `export async function create${input.prismaNames.modelName}(payload: ${input.requestTypeName}) {`,
    `  return prisma.${input.prismaNames.delegateName}.create({`,
    "    data: {",
    `      title: payload.contextNote ?? "${toTemplateText(input.feature.name)}",`,
    '      status: "ready",',
    "      actions: payload.requestedActions.join(\",\"),",
    "    },",
    "  });",
    "}",
    "",
    "// TODO: Add filters, pagination, and transaction boundaries once the feature flow is stabilized.",
    "",
  ].join("\n");

  const schemaContent = mergePrismaSchema(
    input.existingSchema,
    buildPrismaModelBlock({
      feature: input.feature,
      requirement: input.requirement,
      prismaNames: input.prismaNames,
    }),
    input.prismaNames.modelName,
  );

  const migrationContent = [
    `-- Migration for feature: ${input.feature.name}`,
    `CREATE TABLE IF NOT EXISTS "${input.prismaNames.tableName}" (`,
    '  "id" TEXT PRIMARY KEY,',
    '  "title" TEXT NOT NULL,',
    '  "status" TEXT NOT NULL,',
    '  "actions" TEXT NOT NULL,',
    '  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    '  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    ");",
    "",
    `CREATE INDEX IF NOT EXISTS "${input.prismaNames.tableName}_status_idx"`,
    `  ON "${input.prismaNames.tableName}" ("status");`,
    "",
  ].join("\n");

  const seedContent = [
    'import { PrismaClient } from "@prisma/client";',
    "",
    "const prisma = new PrismaClient();",
    "",
    "async function main() {",
    `  await prisma.${input.prismaNames.delegateName}.upsert({`,
    `    where: { id: "${input.feature.id}-seed" },`,
    "    update: {",
    `      title: "${toTemplateText(input.feature.name)} demo record",`,
    '      status: "ready",',
    '      actions: "review,confirm",',
    "    },",
    "    create: {",
    `      id: "${input.feature.id}-seed",`,
    `      title: "${toTemplateText(input.feature.name)} demo record",`,
    '      status: "ready",',
    '      actions: "review,confirm",',
    "    },",
    "  });",
    "}",
    "",
    "main()",
    "  .catch((error) => {",
    "    console.error(error);",
    "    process.exit(1);",
    "  })",
    "  .finally(async () => {",
    "    await prisma.$disconnect();",
    "  });",
    "",
    "// TODO: Expand seed coverage with more realistic relational records once the domain is confirmed.",
    "",
  ].join("\n");

  const seedSqlContent = [
    `-- Seed for feature: ${input.feature.name}`,
    `INSERT INTO "${input.prismaNames.tableName}" ("id", "title", "status", "actions")`,
    `VALUES ('${escapeSqlLiteral(`${input.feature.id}-seed`)}', '${escapeSqlLiteral(`${input.feature.name} demo record`)}', 'ready', 'review,confirm')`,
    'ON CONFLICT ("id") DO UPDATE SET',
    '  "title" = EXCLUDED."title",',
    '  "status" = EXCLUDED."status",',
    '  "actions" = EXCLUDED."actions",',
    '  "updatedAt" = CURRENT_TIMESTAMP;',
    "",
  ].join("\n");

  return [
    {
      path: input.repositoryPath,
      content: repositoryContent,
      description: `Generated database repository for "${input.feature.name}"`,
    },
    {
      path: input.prismaSchemaPath,
      content: schemaContent,
      description: `Generated Prisma schema for "${input.feature.name}"`,
    },
    {
      path: input.prismaMigrationPath,
      content: migrationContent,
      description: `Generated SQL migration for "${input.feature.name}"`,
    },
    {
      path: input.prismaSeedPath,
      content: seedContent,
      description: `Generated Prisma seed for "${input.feature.name}"`,
    },
    {
      path: input.prismaSeedSqlPath,
      content: seedSqlContent,
      description: `Generated executable SQL seed for "${input.feature.name}"`,
    },
  ];
}

function buildPrismaModelBlock(input: {
  feature: FeatureSpec;
  requirement: ProductRequirement;
  prismaNames: ReturnType<typeof getPrismaFeatureNames>;
}): string {
  return [
    `model ${input.prismaNames.modelName} {`,
    "  id        String   @id @default(cuid())",
    "  title     String",
    "  status    String",
    "  actions   String",
    "  createdAt DateTime @default(now())",
    "  updatedAt DateTime @updatedAt",
    "",
    `  @@map("${input.prismaNames.tableName}")`,
    `  /// Feature: ${input.feature.name}`,
    `  /// Requirement summary: ${sanitizeForDoc(input.requirement.summary)}`,
    "}",
    "",
  ].join("\n");
}

function mergePrismaSchema(
  existingSchema: string | undefined,
  modelBlock: string,
  modelName: string,
): string {
  const baseSchema = [
    'generator client {',
    '  provider = "prisma-client-js"',
    "}",
    "",
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    "}",
    "",
  ].join("\n");

  if (!existingSchema?.trim()) {
    return `${baseSchema}${modelBlock}`;
  }

  if (existingSchema.includes(`model ${modelName} {`)) {
    return existingSchema;
  }

  return `${existingSchema.trimEnd()}\n\n${modelBlock}`;
}

async function readOptionalWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

function toImportPath(fromFilePath: string, targetFilePath: string): string {
  const relativePath = path.posix.relative(path.posix.dirname(fromFilePath), targetFilePath);
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
}

function sanitizeForDoc(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTemplateText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
