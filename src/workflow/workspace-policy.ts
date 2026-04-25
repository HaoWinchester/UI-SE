// 这个文件负责做工作区权限校验。
// orchestrator 会用它确认 agent 声称修改的文件是否落在允许的目录范围内。
import path from "node:path";

// 这个文件负责检查 agent 声称要修改的文件，是否真的在允许范围内。
function normalizeScope(scope: string): string {
  const normalized = path.posix.normalize(scope.replaceAll("\\", "/")).replace(/^\.\/+/, "");
  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}

// 统一把路径转成相对 workspace 的标准格式，并阻止越权路径。
function normalizeRelativePath(file: string): string {
  const normalized = path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\/+/, "");

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes the workspace: ${file}`);
  }

  return normalized;
}

// 如果 agent 返回的 changedFiles 超出 writeScopes，这里会直接抛错。
export function assertPathsWithinScopes(paths: string[], scopes: string[]): void {
  const normalizedScopes = scopes.map(normalizeScope);

  for (const file of paths) {
    const normalizedFile = normalizeRelativePath(file);
    const allowed = normalizedScopes.some((scope) =>
      scope === "" ? true : normalizedFile === scope || normalizedFile.startsWith(`${scope}/`),
    );

    if (!allowed) {
      throw new Error(
        `Path "${file}" is outside the declared write scopes: ${scopes.join(", ") || "(none)"}`,
      );
    }
  }
}
