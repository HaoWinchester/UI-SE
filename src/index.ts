import path from "node:path";

import { createDefaultOrchestrator } from "./workflow/orchestrator.js";

async function main(): Promise<void> {
  // 创建总调度器。后面所有 agent、测试、部署、Stitch 调用都由它统一安排。
  const orchestrator = createDefaultOrchestrator(path.resolve(process.cwd()));

  // 这里先写死一段演示需求。
  // 后面你可以把它改成从命令行、文件或接口里读取。
  const rawRequirement = `
Build a delivery workflow for an AI-assisted product team.
- Generate an initial UI draft from an approved requirement through Stitch.
- Implement one feature at a time in frontend and backend.
- Run automated tests after each feature and enter a fix loop when tests fail.
- Verify the final implementation still matches the approved requirement.
- Deploy the accepted build to staging.
`.trim();

  // 第一步：根据原始需求创建一个 job，并先生成结构化 spec。
  const job = await orchestrator.createJob(rawRequirement);
  // 第二步：正式运行整条工作流。
  const result = await orchestrator.run(job.id);

  // 把最终结果打印到终端，方便观察这次任务跑到了哪里。
  console.log(`Job: ${result.id}`);
  console.log(`Stage: ${result.stage}`);
  console.log(`Features: ${result.requirement.features.length}`);
  console.log(`Agent runs: ${result.agentRuns.length}`);
  console.log(`Open bugs: ${result.bugReports.filter((bug) => bug.status === "open").length}`);
  console.log(`UI artifact runtime: ${result.uiArtifact?.runtime ?? "none"}`);
  if (result.uiArtifact?.note) {
    console.log(`UI note: ${result.uiArtifact.note}`);
  }
  console.log(`UI image: ${result.uiArtifact?.imagePath ?? result.uiArtifact?.downloadPath ?? "none"}`);
  console.log(`UI html: ${result.uiArtifact?.htmlPath ?? "none"}`);
  console.log(`Deployment: ${result.deployment?.manifestPath ?? "not deployed"}`);
}

// 统一兜底错误，避免异常直接静默退出。
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
