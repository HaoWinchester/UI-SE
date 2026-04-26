// 这个文件定义 agent team 级别的编排配置。
// skill 解决“每个角色怎么做”，这里解决“这些角色怎么配合”。
import type { AgentName } from "../agents/base.js";

// team 的名字统一收敛在这里，方便后面给 orchestrator 或 UI 面板复用。
export type TeamName =
  | "requirement-design-team"
  | "delivery-team"
  | "quality-team"
  | "release-team";

// team 内部的协作方式：
// - serial: 必须串行
// - parallel: 可以并行
// - hybrid: 先并行再汇总，或串并混合
export type TeamExecutionMode = "serial" | "parallel" | "hybrid";

// 每个 team 成员都带上自己的职责、输入输出和前置依赖。
export interface TeamMemberConfig {
  agent: AgentName;
  responsibility: string;
  dependsOn: AgentName[];
  inputs: string[];
  outputs: string[];
}

// 单个 team 的完整配置。
export interface AgentTeamConfig {
  name: TeamName;
  label: string;
  objective: string;
  executionMode: TeamExecutionMode;
  trigger: string;
  entryCriteria: string[];
  exitCriteria: string[];
  sharedArtifacts: string[];
  members: TeamMemberConfig[];
  handoffTo: TeamName[];
}

// 哪些 agent 能以 feature 为单位并行工作。
// 当前最自然的一组就是前端、后端、数据库三段实现。
export const featureParallelAgents: AgentName[] = [
  "frontend-agent",
  "backend-agent",
  "db-agent",
];

// 测试、修复、监控是一个典型的质量闭环。
export const qualityRepairLoopAgents: AgentName[] = [
  "test-agent",
  "fix-agent",
  "monitor-agent",
];

// 当前主流程推荐的 team 顺序。
export const teamExecutionOrder: TeamName[] = [
  "requirement-design-team",
  "delivery-team",
  "quality-team",
  "release-team",
];

// 如果还在兼容旧版单开发 agent，可以把 dev-agent 当降级方案。
export const legacyDeliveryFallbackAgent: AgentName = "dev-agent";

// 这是当前仓库里最适合直接拿来驱动 agent teams 的配置稿。
export const agentTeams: Record<TeamName, AgentTeamConfig> = {
  "requirement-design-team": {
    name: "requirement-design-team",
    label: "需求与设计 Team",
    objective: "把一句话需求收敛成已批准 spec，并生成可确认的 UI 设计版本。",
    executionMode: "serial",
    trigger: "用户提交了原始需求，且系统还没有批准后的 spec 与 UI。",
    entryCriteria: [
      "收到一句话需求、需求文件或口语化描述",
      "当前 job 还没有 approved spec",
    ],
    exitCriteria: [
      "spec 已澄清并落盘",
      "UI 已通过人工或自动确认",
    ],
    sharedArtifacts: [
      "artifacts/specs/<jobId>/",
      "artifacts/ui/<jobId>/v<version>/",
    ],
    members: [
      {
        agent: "spec-agent",
        responsibility: "做 Speckit 风格的需求澄清、feature 切片和验收标准整理。",
        dependsOn: [],
        inputs: ["rawRequirement", "clarificationAnswers"],
        outputs: ["requirement", "specMarkdown", "pendingQuestions"],
      },
      {
        agent: "ui-agent",
        responsibility: "把已澄清 spec 组织成适合 Stitch 使用的 prompt，并支持多轮设计反馈。",
        dependsOn: ["spec-agent"],
        inputs: ["requirement", "specArtifact", "designFeedback"],
        outputs: ["prompt", "checklist", "targetUrl"],
      },
    ],
    handoffTo: ["delivery-team"],
  },
  "delivery-team": {
    name: "delivery-team",
    label: "交付开发 Team",
    objective: "根据批准后的 spec 和 UI，把当前功能点落实成前端、后端和数据库代码。",
    executionMode: "hybrid",
    trigger: "UI 已批准，系统准备对单个 feature 进入实现阶段。",
    entryCriteria: [
      "当前 job 已有 approved UI",
      "当前 feature 已进入 implementing 阶段",
    ],
    exitCriteria: [
      "feature 对应的前端、后端、数据库代码都已写入工作区",
      "实现计划和变更文件可被测试阶段直接消费",
    ],
    sharedArtifacts: [
      "artifacts/code-workspace/<jobId>/frontend/",
      "artifacts/code-workspace/<jobId>/backend/",
      "artifacts/code-workspace/<jobId>/database/",
    ],
    members: [
      {
        agent: "frontend-agent",
        responsibility: "把批准后的 UI 和功能点变成前端页面、组件和样式代码。",
        dependsOn: [],
        inputs: ["feature", "uiArtifactPath", "codeWorkspace"],
        outputs: ["fileEdits", "changedFiles", "implementationPlan"],
      },
      {
        agent: "backend-agent",
        responsibility: "把功能点变成接口、校验和服务层代码，并与 repository 契约对齐。",
        dependsOn: [],
        inputs: ["feature", "requirement", "codeWorkspace"],
        outputs: ["fileEdits", "changedFiles", "implementationPlan"],
      },
      {
        agent: "db-agent",
        responsibility: "生成 Prisma + PostgreSQL 的 schema、migration、seed 和 repository。",
        dependsOn: [],
        inputs: ["feature", "requirement", "codeWorkspace"],
        outputs: ["fileEdits", "changedFiles", "implementationPlan"],
      },
    ],
    handoffTo: ["quality-team"],
  },
  "quality-team": {
    name: "quality-team",
    label: "质量保障 Team",
    objective: "对每个功能点做测试、修复、对齐检查，并避免重复失败与需求偏航。",
    executionMode: "hybrid",
    trigger: "某个 feature 的代码已经写完，准备进入测试和修复闭环。",
    entryCriteria: [
      "前端、后端、数据库代码已落盘",
      "测试执行层可以读取最新代码工作区",
    ],
    exitCriteria: [
      "当前 feature 的测试通过",
      "monitor-agent 已确认没有阻断性偏航",
    ],
    sharedArtifacts: [
      "artifacts/test-reports/<jobId>/",
      "artifacts/alignment-reports/<jobId>/",
      "artifacts/logs/<jobId>/workflow.jsonl",
    ],
    members: [
      {
        agent: "test-agent",
        responsibility: "解释测试结果，判断是继续推进还是进入修复环。",
        dependsOn: ["frontend-agent", "backend-agent", "db-agent"],
        inputs: ["feature", "testRun"],
        outputs: ["shouldFix", "summary", "failingBugIds", "repeatedFailure"],
      },
      {
        agent: "fix-agent",
        responsibility: "根据 bug、失败记忆和偏航 finding 输出最小修复代码。",
        dependsOn: ["test-agent", "monitor-agent"],
        inputs: ["feature", "bugReports", "alignmentFindings", "codeWorkspace"],
        outputs: ["fileEdits", "changedFiles", "repairPlan", "summary"],
      },
      {
        agent: "monitor-agent",
        responsibility: "检查当前实现是否与批准后的 spec、UI 和数据层边界保持一致。",
        dependsOn: ["frontend-agent", "backend-agent", "db-agent", "fix-agent"],
        inputs: ["job", "feature"],
        outputs: ["aligned", "structuredFindings", "scope", "checkedFiles"],
      },
    ],
    handoffTo: ["release-team"],
  },
  "release-team": {
    name: "release-team",
    label: "验收发布 Team",
    objective: "判断当前版本是否适合给客户预览，以及是否允许发布到目标环境。",
    executionMode: "serial",
    trigger: "所有 feature 已完成主要测试和对齐检查，准备进入最终验收与发布。",
    entryCriteria: [
      "当前 job 没有阻断性 open bug",
      "客户预览页或其他最终预览入口已准备好",
    ],
    exitCriteria: [
      "客户预览结论已明确",
      "发布已被批准或被阻断并记录原因",
    ],
    sharedArtifacts: [
      "artifacts/customer-preview/<jobId>/",
      "artifacts/build/",
      "artifacts/dashboard/<jobId>/",
    ],
    members: [
      {
        agent: "acceptance-agent",
        responsibility: "判断当前是否适合给客户看，并给出单一清晰的预览入口。",
        dependsOn: ["monitor-agent"],
        inputs: ["job"],
        outputs: ["readyForCustomerReview", "previewPath", "summary"],
      },
      {
        agent: "deploy-agent",
        responsibility: "基于客户确认和阻断项状态，决定是否允许发布到目标环境。",
        dependsOn: ["acceptance-agent"],
        inputs: ["job"],
        outputs: ["approved", "environment", "summary"],
      },
    ],
    handoffTo: [],
  },
};

