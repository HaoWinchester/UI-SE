// 这个文件统一管理代码生成 agent 的模型运行配置。
// 如果没有配置真实模型密钥，相关 agent 会自动回退到模板模式，保证流程仍然可跑通。
import "dotenv/config";

import type { AgentRuntimeMode, ModelProvider } from "../agents/base.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface ModelRuntimeEnv {
  openAiApiKey?: string;
  openAiBaseUrl: string;
}

export function readModelRuntimeEnv(): ModelRuntimeEnv {
  return {
    openAiApiKey: readOptionalEnv("OPENAI_API_KEY"),
    openAiBaseUrl: readOptionalEnv("OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL,
  };
}

// 根据 provider 和当前环境变量，决定 agent 是走真实模型还是回退到 mock。
export function resolveRuntimeModeForProvider(provider: ModelProvider): AgentRuntimeMode {
  if (provider === "mock") {
    return "mock";
  }

  if (provider === "openai") {
    return readModelRuntimeEnv().openAiApiKey ? "model" : "mock";
  }

  return "mock";
}

export function isModelRuntimeAvailable(provider: ModelProvider): boolean {
  return resolveRuntimeModeForProvider(provider) === "model";
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
