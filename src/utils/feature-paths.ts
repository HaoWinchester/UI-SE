// 这个文件统一维护“某个功能点对应哪些代码文件”的路径规则。
// 前端 agent、后端 agent、测试器和修复 agent 都会复用这里，避免各写各的路径逻辑。
import path from "node:path";

import type { CodeWorkspace, FeatureSpec } from "../types/domain.js";

export interface FeatureCodePaths {
  featureSlug: string;
  frontendComponentPath: string;
  frontendStylesPath: string;
  backendRoutePath: string;
  backendSchemaPath: string;
  databaseRepositoryPath: string;
  prismaSchemaPath: string;
  prismaMigrationPath: string;
  prismaSeedPath: string;
  prismaSeedSqlPath: string;
}

export function getFeatureCodePaths(
  workspace: CodeWorkspace,
  feature: FeatureSpec,
): FeatureCodePaths {
  const featureSlug = slugifyFeatureName(feature.name, feature.id);
  const frontendFeatureDir = path.posix.join(workspace.frontendDir, "src", "features", featureSlug);
  const backendFeatureDir = path.posix.join(workspace.backendDir, "src", "features", featureSlug);
  const databaseFeatureDir = path.posix.join(workspace.databaseDir, "src", "features", featureSlug);
  const prismaDir = path.posix.join(workspace.databaseDir, "prisma");

  return {
    featureSlug,
    frontendComponentPath: path.posix.join(frontendFeatureDir, "FeatureView.tsx"),
    frontendStylesPath: path.posix.join(frontendFeatureDir, "feature.css"),
    backendRoutePath: path.posix.join(backendFeatureDir, "route.ts"),
    backendSchemaPath: path.posix.join(backendFeatureDir, "schema.ts"),
    databaseRepositoryPath: path.posix.join(databaseFeatureDir, "repository.ts"),
    prismaSchemaPath: path.posix.join(prismaDir, "schema.prisma"),
    prismaMigrationPath: path.posix.join(prismaDir, "migrations", `${featureSlug}_init`, "migration.sql"),
    prismaSeedPath: path.posix.join(prismaDir, "seeds", `${featureSlug}.ts`),
    prismaSeedSqlPath: path.posix.join(prismaDir, "seeds", `${featureSlug}.sql`),
  };
}

export function slugifyFeatureName(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback.toLowerCase();
}

export function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

export function toCamelCase(value: string): string {
  const pascalCase = toPascalCase(value);
  return pascalCase ? pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1) : "";
}

export function getPrismaFeatureNames(featureSlug: string): {
  modelName: string;
  delegateName: string;
  tableName: string;
} {
  const baseName = toPascalCase(featureSlug);
  const modelName = `${baseName}Record`;
  return {
    modelName,
    delegateName: toCamelCase(modelName),
    tableName: `${featureSlug.replace(/-/g, "_")}_records`,
  };
}
