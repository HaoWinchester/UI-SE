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
npm run dev
```

The demo entrypoint creates a sample requirement, runs it through the orchestration flow, and writes mock outputs under `artifacts/`.

## Recommended next steps

1. Replace `MockStitchClient` with a real Playwright or API integration for Stitch.
2. Swap the mock agents for real model-backed agents.
3. Persist jobs in SQLite or Postgres instead of memory.
4. Connect `MockTestRunner` to your actual test commands and CI signals.
5. Replace `MockDeployer` with your real staging and production release flow.
