import type { JobStage } from "../types/domain.js";

// 所有 agent 的名字都收敛在这里，方便 orchestrator 统一调度。
export type AgentName =
  | "spec-agent"
  | "ui-agent"
  | "frontend-agent"
  | "backend-agent"
  | "dev-agent"
  | "test-agent"
  | "fix-agent"
  | "monitor-agent"
  | "acceptance-agent"
  | "deploy-agent";

export type AgentTool =
  | "job-store"
  | "repo-read"
  | "repo-write"
  | "stitch-client"
  | "test-runner"
  | "deployer";

export type ModelProvider = "openai" | "anthropic" | "mock";
export type ReasoningEffort = "low" | "medium" | "high";
export type AgentRuntimeMode = "mock" | "model";
export type AgentRunStatus = "completed" | "blocked";

// 描述某个 agent 预期使用什么模型。
export interface ModelProfile {
  provider: ModelProvider;
  model: string;
  reasoningEffort: ReasoningEffort;
  temperature: number;
}

// agent 的静态配置：它是谁、能读哪里、能写哪里、能用哪些工具。
export interface AgentDefinition {
  name: AgentName;
  description: string;
  systemPrompt: string;
  runtimeMode: AgentRuntimeMode;
  model: ModelProfile;
  readScopes: string[];
  writeScopes: string[];
  tools: AgentTool[];
}

// agent 真正执行时拿到的上下文。
export interface AgentExecutionContext {
  jobId: string;
  stage: JobStage;
  workspaceRoot: string;
  runtimeMode: AgentRuntimeMode;
  model: ModelProfile;
  readScopes: string[];
  writeScopes: string[];
  allowedTools: AgentTool[];
}

// 所有 agent 都返回统一结构，方便 orchestrator 读取结果并决定下一步。
export interface AgentResult<TData> {
  status: AgentRunStatus;
  summary: string;
  nextAction: string;
  changedFiles: string[];
  artifacts: string[];
  risks: string[];
  data: TData;
}

// 所有 agent 都实现同一套接口。
export interface Agent<Input, Output> {
  readonly definition: AgentDefinition;
  run(input: Input, context: AgentExecutionContext): Promise<AgentResult<Output>>;
}

// orchestrator 每次运行 agent 前，都会先创建一份执行上下文。
export function createExecutionContext(
  definition: AgentDefinition,
  jobId: string,
  stage: JobStage,
  workspaceRoot: string,
): AgentExecutionContext {
  return {
    jobId,
    stage,
    workspaceRoot,
    runtimeMode: definition.runtimeMode,
    model: definition.model,
    readScopes: definition.readScopes,
    writeScopes: definition.writeScopes,
    allowedTools: definition.tools,
  };
}
