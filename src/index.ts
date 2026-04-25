import path from "node:path";

import { createDefaultOrchestrator } from "./workflow/orchestrator.js";

async function main(): Promise<void> {
  const orchestrator = createDefaultOrchestrator(path.resolve(process.cwd()));

  const rawRequirement = `
Build a delivery workflow for an AI-assisted product team.
- Generate an initial UI draft from an approved requirement through Stitch.
- Implement one feature at a time in frontend and backend.
- Run automated tests after each feature and enter a fix loop when tests fail.
- Verify the final implementation still matches the approved requirement.
- Deploy the accepted build to staging.
`.trim();

  const job = await orchestrator.createJob(rawRequirement);
  const result = await orchestrator.run(job.id);

  console.log(`Job: ${result.id}`);
  console.log(`Stage: ${result.stage}`);
  console.log(`Features: ${result.requirement.features.length}`);
  console.log(`Agent runs: ${result.agentRuns.length}`);
  console.log(`Open bugs: ${result.bugReports.filter((bug) => bug.status === "open").length}`);
  console.log(`UI artifact runtime: ${result.uiArtifact?.runtime ?? "none"}`);
  console.log(`UI image: ${result.uiArtifact?.imagePath ?? result.uiArtifact?.downloadPath ?? "none"}`);
  console.log(`UI html: ${result.uiArtifact?.htmlPath ?? "none"}`);
  console.log(`Deployment: ${result.deployment?.manifestPath ?? "not deployed"}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
