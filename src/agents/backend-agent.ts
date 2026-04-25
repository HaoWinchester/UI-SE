// 这个文件定义后端开发 agent。
// 它根据功能点和需求上下文生成后端契约、路由和基础处理逻辑，并直接返回可落盘的代码文件。
import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type {
  CodeFileEdit,
  CodeWorkspace,
  FeatureSpec,
  ProductRequirement,
} from "../types/domain.js";
import { OpenAiJsonModelClient } from "../tools/model-client.js";
import { getFeatureCodePaths, toPascalCase } from "../utils/feature-paths.js";

// backend-agent 专门负责后端侧的实现拆解。
export interface BackendAgentInput {
  feature: FeatureSpec;
  requirement: ProductRequirement;
  codeWorkspace: CodeWorkspace;
}

export interface BackendAgentOutput {
  summary: string;
  implementationPlan: string[];
  generatedFiles: string[];
  runtimeUsed: "template" | "model";
}

interface ModelGeneratedBackendPayload {
  summary: string;
  implementationPlan: string[];
  files: Array<{
    path: string;
    content: string;
    description?: string;
  }>;
}

export class BackendAgent implements Agent<BackendAgentInput, BackendAgentOutput> {
  readonly definition = agentRegistry["backend-agent"];

  async run(
    { feature, requirement, codeWorkspace }: BackendAgentInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<BackendAgentOutput>> {
    const paths = getFeatureCodePaths(codeWorkspace, feature);
    const entityName = `${toPascalCase(paths.featureSlug)}Payload`;
    const fallbackFileEdits = buildTemplateBackendEdits({
      feature,
      requirement,
      entityName,
      routePath: paths.backendRoutePath,
      schemaPath: paths.backendSchemaPath,
    });

    const modelPayload =
      context.runtimeMode === "model"
        ? await tryGenerateBackendWithModel({
            systemPrompt: this.definition.systemPrompt,
            model: context.model.model,
            temperature: context.model.temperature,
            feature,
            requirement,
            entityName,
            paths,
          })
        : undefined;

    const fileEdits = modelPayload?.files.length
      ? normalizeModelFileEdits(modelPayload.files, [
          paths.backendRoutePath,
          paths.backendSchemaPath,
        ])
      : fallbackFileEdits;

    const implementationPlan = modelPayload?.implementationPlan ?? [
      `为 "${feature.name}" 生成最小可用的后端契约与处理函数。`,
      "把需求摘要、验收标准和响应结构写进代码，方便后续监控与测试复用。",
      "保留一个明确的 TODO，交给后续修复环节验证闭环是否能真正修补代码。",
    ];

    const summary =
      modelPayload?.summary ??
      `已为功能 "${feature.name}" 生成后端代码草稿，并写入独立的后端工作区目录。`;

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

async function tryGenerateBackendWithModel(input: {
  systemPrompt: string;
  model: string;
  temperature: number;
  feature: FeatureSpec;
  requirement: ProductRequirement;
  entityName: string;
  paths: ReturnType<typeof getFeatureCodePaths>;
}): Promise<ModelGeneratedBackendPayload | undefined> {
  try {
    const client = new OpenAiJsonModelClient();
    return await client.generateJson<ModelGeneratedBackendPayload>({
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
        `Write exactly two backend files: ${input.paths.backendRoutePath} and ${input.paths.backendSchemaPath}.`,
        `Use ${input.entityName} as the main request/response payload type root.`,
        "Generate plain TypeScript without external runtime dependencies.",
        "Keep one realistic TODO comment so the fix loop has a concrete backend issue to repair later.",
      ].join("\n"),
    });
  } catch {
    return undefined;
  }
}

function normalizeModelFileEdits(
  files: ModelGeneratedBackendPayload["files"],
  fallbackPaths: string[],
): CodeFileEdit[] {
  return files.map((file, index) => ({
    path: file.path?.trim() || fallbackPaths[index] || fallbackPaths[0],
    content: file.content,
    description: file.description,
  }));
}

function buildTemplateBackendEdits(input: {
  feature: FeatureSpec;
  requirement: ProductRequirement;
  entityName: string;
  routePath: string;
  schemaPath: string;
}): CodeFileEdit[] {
  const entityName = input.entityName;
  const routeContent = [
    `import type { ${entityName}Request, ${entityName}Response } from "./schema";`,
    "",
    `export async function handle${entityName}(payload: ${entityName}Request): Promise<${entityName}Response> {`,
    "  validatePayload(payload);",
    "",
    "  return {",
    `    featureId: "${input.feature.id}",`,
    `    featureName: "${toTemplateText(input.feature.name)}",`,
    '    status: "ready",',
    "    nextActions: payload.requestedActions.length > 0 ? payload.requestedActions : [\"review\", \"confirm\"],",
    "  };",
    "}",
    "",
    `export function validatePayload(payload: ${entityName}Request): void {`,
    "  if (!payload.requestedActions || payload.requestedActions.length === 0) {",
    '    throw new Error("requestedActions must include at least one action.");',
    "  }",
    "}",
    "",
    "// TODO: Replace the placeholder response with a real service integration once persistence and auth are wired in.",
    "",
  ].join("\n");

  const schemaContent = [
    `export interface ${entityName}Request {`,
    "  requestedActions: string[];",
    "  contextNote?: string;",
    "}",
    "",
    `export interface ${entityName}Response {`,
    "  featureId: string;",
    "  featureName: string;",
    '  status: "ready";',
    "  nextActions: string[];",
    "}",
    "",
    `export const ${entityName}RequirementSummary = "${toTemplateText(input.requirement.summary)}";`,
    `export const ${entityName}AcceptanceChecklist = [`,
    ...input.feature.acceptanceCriteria.map((criterion) => `  "${toTemplateText(criterion)}",`),
    "] as const;",
    "",
  ].join("\n");

  return [
    {
      path: input.routePath,
      content: routeContent,
      description: `Generated backend route for "${input.feature.name}"`,
    },
    {
      path: input.schemaPath,
      content: schemaContent,
      description: `Generated backend schema for "${input.feature.name}"`,
    },
  ];
}

function toTemplateText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}
