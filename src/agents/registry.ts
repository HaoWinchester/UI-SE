import type { AgentDefinition, AgentName } from "./base.js";

// 这个注册表就是 agent 的“配置中心”。
// orchestrator 会从这里读取每个角色的模型、权限、可访问目录和工具权限。
export const agentRegistry: Record<AgentName, AgentDefinition> = {
  "spec-agent": {
    name: "spec-agent",
    description: "Turns raw requirements into a structured delivery spec.",
    systemPrompt:
      "You are the spec agent. Break raw product requests into feature slices, define acceptance criteria, and surface assumptions before implementation begins.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      temperature: 0.2,
    },
    readScopes: ["docs", "skills/spec-agent"],
    writeScopes: ["docs", "artifacts/specs", "skills/spec-agent"],
    tools: ["job-store", "repo-read"],
  },
  "ui-agent": {
    name: "ui-agent",
    description: "Packages an approved spec into a Stitch-ready prompt.",
    systemPrompt:
      "You are the UI agent. Prepare clean submission content for Stitch and keep the prompt grounded in the approved requirement.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      temperature: 0.3,
    },
    readScopes: ["docs", "artifacts/specs", "skills/ui-agent"],
    writeScopes: ["artifacts/ui"],
    tools: ["repo-read", "stitch-client"],
  },
  "frontend-agent": {
    name: "frontend-agent",
    description: "Plans frontend implementation for the current feature slice.",
    systemPrompt:
      "You are the frontend agent. Turn the current feature slice and approved UI reference into a frontend implementation plan that preserves the design and user flow.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      temperature: 0.2,
    },
    readScopes: ["src", "docs", "artifacts/ui", "skills/dev-agent"],
    writeScopes: ["src"],
    tools: ["repo-read", "repo-write"],
  },
  "backend-agent": {
    name: "backend-agent",
    description: "Plans backend implementation for the current feature slice.",
    systemPrompt:
      "You are the backend agent. Turn the current feature slice into backend responsibilities, contracts, and validation needs without drifting from the approved requirement.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      temperature: 0.2,
    },
    readScopes: ["src", "docs", "artifacts/specs", "skills/dev-agent"],
    writeScopes: ["src"],
    tools: ["repo-read", "repo-write"],
  },
  "dev-agent": {
    name: "dev-agent",
    description: "Plans implementation for the current feature slice.",
    systemPrompt:
      "You are the development agent. Turn the current feature slice and UI reference into an implementation plan without drifting from the approved requirement.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      temperature: 0.2,
    },
    readScopes: ["src", "docs", "artifacts/ui", "skills/dev-agent"],
    writeScopes: ["src"],
    tools: ["repo-read", "repo-write"],
  },
  "test-agent": {
    name: "test-agent",
    description: "Interprets test outcomes and routes the next action.",
    systemPrompt:
      "You are the test agent. Read the latest test run, decide whether the workflow continues, and hand failures to the repair loop when needed.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      temperature: 0.1,
    },
    readScopes: ["src", "artifacts/test-reports", "skills/test-agent"],
    writeScopes: ["artifacts/test-reports"],
    tools: ["repo-read", "test-runner"],
  },
  "fix-agent": {
    name: "fix-agent",
    description: "Turns bug reports into a targeted repair pass.",
    systemPrompt:
      "You are the fix agent. Focus on the smallest repair that clears the current blocking bugs and returns the feature to the test loop quickly.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      temperature: 0.2,
    },
    readScopes: ["src", "artifacts/test-reports", "skills/fix-agent"],
    writeScopes: ["src"],
    tools: ["repo-read", "repo-write", "test-runner"],
  },
  "monitor-agent": {
    name: "monitor-agent",
    description: "Checks implementation alignment against the approved requirement.",
    systemPrompt:
      "You are the monitor agent. Compare implementation status against the approved requirement and block release when the build drifts from spec.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      temperature: 0.1,
    },
    readScopes: ["src", "docs", "artifacts", "skills/monitor-agent"],
    writeScopes: [],
    tools: ["repo-read", "job-store"],
  },
  "acceptance-agent": {
    name: "acceptance-agent",
    description: "Prepares the final customer preview and validates readiness for release approval.",
    systemPrompt:
      "You are the acceptance agent. Confirm the workflow is ready for customer preview and surface the best preview artifact before deployment approval is requested.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      temperature: 0.1,
    },
    readScopes: ["src", "artifacts", "docs", "skills/monitor-agent"],
    writeScopes: [],
    tools: ["repo-read", "job-store"],
  },
  "deploy-agent": {
    name: "deploy-agent",
    description: "Makes the final release decision for the target environment.",
    systemPrompt:
      "You are the deploy agent. Approve deployment only when acceptance is complete and there are no blocking issues left in the workflow.",
    runtimeMode: "mock",
    model: {
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      temperature: 0.1,
    },
    readScopes: ["src", "artifacts/build", "artifacts/test-reports", "skills/deploy-agent"],
    writeScopes: ["artifacts/build"],
    tools: ["repo-read", "job-store", "deployer"],
  },
};
