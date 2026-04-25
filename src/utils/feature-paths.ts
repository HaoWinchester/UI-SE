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
}

export function getFeatureCodePaths(
  workspace: CodeWorkspace,
  feature: FeatureSpec,
): FeatureCodePaths {
  const featureSlug = slugifyFeatureName(feature.name, feature.id);
  const frontendFeatureDir = path.posix.join(workspace.frontendDir, "src", "features", featureSlug);
  const backendFeatureDir = path.posix.join(workspace.backendDir, "src", "features", featureSlug);

  return {
    featureSlug,
    frontendComponentPath: path.posix.join(frontendFeatureDir, "FeatureView.tsx"),
    frontendStylesPath: path.posix.join(frontendFeatureDir, "feature.css"),
    backendRoutePath: path.posix.join(backendFeatureDir, "route.ts"),
    backendSchemaPath: path.posix.join(backendFeatureDir, "schema.ts"),
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
