import type { JobStage } from "../types/domain.js";

export type AgentName =
  | "spec-agent"
  | "ui-agent"
  | "dev-agent"
  | "test-agent"
  | "fix-agent"
  | "monitor-agent"
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

export interface ModelProfile {
  provider: ModelProvider;
  model: string;
  reasoningEffort: ReasoningEffort;
  temperature: number;
}

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

export interface AgentResult<TData> {
  status: AgentRunStatus;
  summary: string;
  nextAction: string;
  changedFiles: string[];
  artifacts: string[];
  risks: string[];
  data: TData;
}

export interface Agent<Input, Output> {
  readonly definition: AgentDefinition;
  run(input: Input, context: AgentExecutionContext): Promise<AgentResult<Output>>;
}

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
