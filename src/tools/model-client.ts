// 这个文件封装一个轻量的模型调用层。
// 当前只实现了 OpenAI 风格的 JSON 输出，用来给代码生成 agent 提供可选的真实模型能力。
import { configureNodeHttpProxy } from "../config/proxy.js";
import { readModelRuntimeEnv } from "../config/model.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export interface JsonGenerationRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  outputShape: string;
}

export class OpenAiJsonModelClient {
  async generateJson<T>(request: JsonGenerationRequest): Promise<T> {
    const env = readModelRuntimeEnv();
    if (!env.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is missing, cannot use model runtime.");
    }

    configureNodeHttpProxy();

    const response = await fetch(`${env.openAiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: request.systemPrompt,
          },
          {
            role: "user",
            content: [
              request.userPrompt,
              "",
              "Return a single JSON object only.",
              `Expected JSON shape: ${request.outputShape}`,
            ].join("\n"),
          },
        ],
      }),
    });

    const payload = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Model request failed with ${response.status}.`);
    }

    const rawContent = payload.choices?.[0]?.message?.content;
    const normalizedContent = normalizeMessageContent(rawContent);
    if (!normalizedContent) {
      throw new Error("Model response was empty.");
    }

    return JSON.parse(extractJsonBlock(normalizedContent)) as T;
  }
}

export function canUseOpenAiModel(): boolean {
  return Boolean(readModelRuntimeEnv().openAiApiKey);
}

function normalizeMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function extractJsonBlock(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Model response did not contain a JSON object.");
}
