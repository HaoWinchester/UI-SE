# UI-SE

`UI-SE` is a bootstrap scaffold for an agent-orchestrated delivery system:

1. turn a requirement into a working spec
2. send the approved spec to Stitch for UI generation
3. implement features one by one
4. test each feature, fix failures, and re-test
5. validate the final build against the requirement
6. deploy the accepted build

The current codebase intentionally starts with mock integrations so the full workflow can run end to end before you plug in real LLMs, browser automation, CI, and deployment targets.

## What is in this repo

- `docs/architecture.md`: system design and rollout plan
- `docs/agent-runtime.md`: agent model profiles, folder scopes, and tool permissions
- `docs/roadmap.md`: version-by-version delivery plan for iterative implementation
- `src/workflow`: orchestration and state transitions
- `src/agents`: agent role contracts and default implementations
- `src/tools`: deterministic tools such as Stitch, testing, and deployment clients
- `src/storage`: job persistence abstraction with an in-memory implementation
- `skills`: early `SKILL.md` files for each agent role
- `artifacts`: generated specs, UI files, test reports, and build outputs

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

If `STITCH_API_KEY` or OAuth credentials are configured in `.env`, the workflow uses the real Stitch SDK. Otherwise it automatically falls back to the mock Stitch client so the rest of the flow still runs locally.

The demo entrypoint creates a sample requirement, runs it through the orchestration flow, and writes UI artifacts under `artifacts/`.

## Stitch setup

For the real Stitch path, configure one of these:

- `STITCH_API_KEY`
- `STITCH_ACCESS_TOKEN` together with `GOOGLE_CLOUD_PROJECT`

Optional settings:

- `STITCH_PROJECT_ID`: reuse an existing Stitch project instead of creating a new one
- `STITCH_DEVICE_TYPE`: `DESKTOP`, `MOBILE`, `TABLET`, or `AGNOSTIC`
- `STITCH_MODEL_ID`: `GEMINI_3_PRO`, `GEMINI_3_FLASH`, or `GEMINI_3_1_PRO`
- `STITCH_HOST`: override the default Stitch MCP endpoint

## Recommended next steps

1. Validate the Stitch SDK flow with real credentials and, only if needed, add Playwright for gaps the SDK does not cover.
2. Swap the mock agents for real model-backed agents.
3. Persist jobs in SQLite or Postgres instead of memory.
4. Connect `MockTestRunner` to your actual test commands and CI signals.
5. Replace `MockDeployer` with your real staging and production release flow.
