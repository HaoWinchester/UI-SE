import path from "node:path";

function normalizeScope(scope: string): string {
  const normalized = path.posix.normalize(scope.replaceAll("\\", "/")).replace(/^\.\/+/, "");
  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}

function normalizeRelativePath(file: string): string {
  const normalized = path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\/+/, "");

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes the workspace: ${file}`);
  }

  return normalized;
}

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
