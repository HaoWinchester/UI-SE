// 这个文件保留了通用开发 agent 的定义。
// 当前主流程已拆成前端和后端 agent，这里更像一个兼容性的通用实现角色。
import type { Agent, AgentResult } from "./base.js";
import { agentRegistry } from "./registry.js";
import type { FeatureSpec } from "../types/domain.js";

// dev-agent 负责“怎么实现功能点”的判断。
export interface DevAgentInput {
  feature: FeatureSpec;
  uiArtifactPath: string;
}

export interface DevAgentOutput {
  summary: string;
  implementationPlan: string[];
}

export class DevAgent implements Agent<DevAgentInput, DevAgentOutput> {
  readonly definition = agentRegistry["dev-agent"];

  async run({ feature, uiArtifactPath }: DevAgentInput): Promise<AgentResult<DevAgentOutput>> {
    // 当前版本先返回一个实现计划，后面接入真实模型后可以扩展成真实开发建议。
    const implementationPlan = [
      `Review the feature acceptance criteria for "${feature.name}".`,
      "Map frontend and backend work for the current feature slice.",
      `Use the UI artifact at ${uiArtifactPath} as the visual reference during implementation.`,
    ];

    return {
      status: "completed",
      summary: `Prepared an implementation plan for "${feature.name}" using the downloaded UI artifact as the visual reference.`,
      nextAction: "run_feature_tests",
      changedFiles: [],
      artifacts: [],
      risks: uiArtifactPath ? [] : ["No UI artifact was provided to the development stage."],
      data: {
        summary: [
          `Implement feature "${feature.name}" using the downloaded UI artifact as the visual reference.`,
          `Reference UI artifact: ${uiArtifactPath}`,
        ].join(" "),
        implementationPlan,
      },
    };
  }
}
