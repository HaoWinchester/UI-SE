// 这个文件定义前端开发 agent。
// 它会结合 UI 设计图与功能点信息，输出前端实现思路，并直接产出可落盘的前端代码文件。
import { readFile } from "node:fs/promises";

import type { Agent, AgentExecutionContext, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { CodeFileEdit, CodeWorkspace, FeatureSpec } from "../types/domain.js";
import { OpenAiJsonModelClient } from "../tools/model-client.js";
import { getFeatureCodePaths, toPascalCase } from "../utils/feature-paths.js";

// frontend-agent 专门负责前端侧的实现拆解。
export interface FrontendAgentInput {
  feature: FeatureSpec;
  uiArtifactPath: string;
  codeWorkspace: CodeWorkspace;
}

export interface FrontendAgentOutput {
  summary: string;
  implementationPlan: string[];
  generatedFiles: string[];
  runtimeUsed: "template" | "model";
}

interface ModelGeneratedFrontendPayload {
  summary: string;
  implementationPlan: string[];
  files: Array<{
    path: string;
    content: string;
    description?: string;
  }>;
}

export class FrontendAgent implements Agent<FrontendAgentInput, FrontendAgentOutput> {
  readonly definition = agentRegistry["frontend-agent"];

  async run(
    { feature, uiArtifactPath, codeWorkspace }: FrontendAgentInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<FrontendAgentOutput>> {
    const paths = getFeatureCodePaths(codeWorkspace, feature);
    const componentName = `${toPascalCase(paths.featureSlug)}FeatureView`;
    const uiReference = await readUiReference(uiArtifactPath);

    const fallbackFileEdits = buildTemplateFrontendEdits({
      feature,
      componentName,
      componentPath: paths.frontendComponentPath,
      stylesPath: paths.frontendStylesPath,
      uiReference,
    });

    const modelPayload =
      context.runtimeMode === "model"
        ? await tryGenerateFrontendWithModel({
            systemPrompt: this.definition.systemPrompt,
            model: context.model.model,
            temperature: context.model.temperature,
            feature,
            componentName,
            paths,
            uiReference,
          })
        : undefined;

    const fileEdits = modelPayload?.files.length
      ? normalizeModelFileEdits(modelPayload.files, [
          paths.frontendComponentPath,
          paths.frontendStylesPath,
        ])
      : fallbackFileEdits;

    const implementationPlan = modelPayload?.implementationPlan ?? [
      `拆分 "${feature.name}" 的页面结构、信息区块和主交互动作。`,
      "根据已批准的 UI 设计稿整理组件边界与视觉层次。",
      "生成首版前端代码，并保留少量待修复点给后续测试与修复闭环验证。",
    ];

    const summary =
      modelPayload?.summary ??
      `已为功能 "${feature.name}" 生成前端代码草稿，并写入独立的前端工作区目录。`;

    return {
      status: "completed",
      summary,
      nextAction: "implement_backend_slice",
      changedFiles: fileEdits.map((edit) => edit.path),
      fileEdits,
      artifacts: [],
      risks: uiArtifactPath ? [] : ["Frontend generation is missing an approved UI artifact reference."],
      data: {
        summary,
        implementationPlan,
        generatedFiles: fileEdits.map((edit) => edit.path),
        runtimeUsed: modelPayload ? "model" : "template",
      },
    };
  }
}

async function tryGenerateFrontendWithModel(input: {
  systemPrompt: string;
  model: string;
  temperature: number;
  feature: FeatureSpec;
  componentName: string;
  paths: ReturnType<typeof getFeatureCodePaths>;
  uiReference: string;
}): Promise<ModelGeneratedFrontendPayload | undefined> {
  try {
    const client = new OpenAiJsonModelClient();
    return await client.generateJson<ModelGeneratedFrontendPayload>({
      model: input.model,
      temperature: input.temperature,
      systemPrompt: input.systemPrompt,
      outputShape:
        '{ "summary": "string", "implementationPlan": ["string"], "files": [{ "path": "string", "content": "string", "description": "string" }] }',
      userPrompt: [
        `Feature name: ${input.feature.name}`,
        `Feature description: ${input.feature.description}`,
        `Acceptance criteria: ${input.feature.acceptanceCriteria.join(" | ")}`,
        `UI reference snippet: ${input.uiReference}`,
        `Write exactly two files for the frontend slice: ${input.paths.frontendComponentPath} and ${input.paths.frontendStylesPath}.`,
        `The component export name must be ${input.componentName}.`,
        "Generate clean TypeScript/TSX plus CSS. Keep the code understandable and do not reference unavailable libraries.",
        "Keep one realistic TODO comment in the generated code so the repair loop still has a concrete issue to resolve later.",
      ].join("\n"),
    });
  } catch {
    return undefined;
  }
}

function normalizeModelFileEdits(
  files: ModelGeneratedFrontendPayload["files"],
  fallbackPaths: string[],
): CodeFileEdit[] {
  return files.map((file, index) => ({
    path: file.path?.trim() || fallbackPaths[index] || fallbackPaths[0],
    content: file.content,
    description: file.description,
  }));
}

function buildTemplateFrontendEdits(input: {
  feature: FeatureSpec;
  componentName: string;
  componentPath: string;
  stylesPath: string;
  uiReference: string;
}): CodeFileEdit[] {
  const escapedTitle = toTemplateText(input.feature.name);
  const escapedDescription = toTemplateText(input.feature.description);
  const acceptanceItems = input.feature.acceptanceCriteria
    .map((criterion) => `  "${toTemplateText(criterion)}",`)
    .join("\n");
  const uiReferenceLine = toTemplateText(input.uiReference);

  const componentContent = [
    'import "./feature.css";',
    "",
    `const acceptanceChecklist = [`,
    acceptanceItems,
    "] as const;",
    "",
    `export function ${input.componentName}() {`,
    "  return (",
    `    <main className="feature-shell" data-feature-id="${input.feature.id}">`,
    '      <section className="feature-hero">',
    '        <p className="feature-kicker">Approved UI reference</p>',
    `        <h1>${escapedTitle}</h1>`,
    `        <p className="feature-description">${escapedDescription}</p>`,
    `        <p className="feature-ui-reference">${uiReferenceLine}</p>`,
    "      </section>",
    "",
    '      <section className="feature-card-grid">',
    "        {acceptanceChecklist.map((item) => (",
    '          <article key={item} className="feature-card">',
    "            <h2>Implementation slice</h2>",
    "            <p>{item}</p>",
    "          </article>",
    "        ))}",
    "      </section>",
    "",
    '      <section className="feature-actions">',
    '        <button type="button" className="feature-primary-action">Continue flow</button>',
    '        <button type="button" className="feature-secondary-action">Review details</button>',
    "      </section>",
    "    </main>",
    "  );",
    "}",
    "",
    "// TODO: Replace the placeholder action wiring with real state transitions after backend contract verification.",
    "",
  ].join("\n");

  const stylesContent = [
    ":root {",
    "  color-scheme: light;",
    "}",
    "",
    ".feature-shell {",
    "  display: grid;",
    "  gap: 24px;",
    "  padding: 32px;",
    "  background: #f7f8fb;",
    "  color: #1f2937;",
    "  font-family: \"SF Pro Display\", \"PingFang SC\", sans-serif;",
    "}",
    "",
    ".feature-hero {",
    "  display: grid;",
    "  gap: 12px;",
    "  padding: 24px;",
    "  border: 1px solid #d6dbe6;",
    "  border-radius: 20px;",
    "  background: #ffffff;",
    "}",
    "",
    ".feature-kicker {",
    "  margin: 0;",
    "  font-size: 12px;",
    "  letter-spacing: 0.08em;",
    "  text-transform: uppercase;",
    "  color: #56657a;",
    "}",
    "",
    ".feature-description,",
    ".feature-ui-reference {",
    "  margin: 0;",
    "  color: #4b5563;",
    "  line-height: 1.6;",
    "}",
    "",
    ".feature-card-grid {",
    "  display: grid;",
    "  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));",
    "  gap: 16px;",
    "}",
    "",
    ".feature-card {",
    "  padding: 20px;",
    "  border-radius: 18px;",
    "  border: 1px solid #d6dbe6;",
    "  background: #ffffff;",
    "}",
    "",
    ".feature-actions {",
    "  display: flex;",
    "  gap: 12px;",
    "}",
    "",
    ".feature-primary-action,",
    ".feature-secondary-action {",
    "  border: none;",
    "  border-radius: 999px;",
    "  padding: 12px 18px;",
    "  cursor: pointer;",
    "}",
    "",
    ".feature-primary-action {",
    "  background: #1d4ed8;",
    "  color: #ffffff;",
    "}",
    "",
    ".feature-secondary-action {",
    "  background: #e5edf8;",
    "  color: #1f2937;",
    "}",
    "",
  ].join("\n");

  return [
    {
      path: input.componentPath,
      content: componentContent,
      description: `Generated frontend component for "${input.feature.name}"`,
    },
    {
      path: input.stylesPath,
      content: stylesContent,
      description: `Generated frontend styles for "${input.feature.name}"`,
    },
  ];
}

async function readUiReference(uiArtifactPath: string): Promise<string> {
  if (!uiArtifactPath) {
    return "No approved UI artifact path was provided.";
  }

  const normalizedPath = uiArtifactPath.toLowerCase();
  if (!normalizedPath.endsWith(".html") && !normalizedPath.endsWith(".htm")) {
    return `Approved UI artifact located at ${uiArtifactPath}.`;
  }

  try {
    const content = await readFile(uiArtifactPath, "utf8");
    return content.replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return `Approved UI artifact located at ${uiArtifactPath}.`;
  }
}

function toTemplateText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}
