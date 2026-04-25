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

The demo entrypoint now supports a one-line prompt, auto-clarifies it into a Speckit-style spec, then sends that clarified spec into the UI orchestration flow and writes outputs under `artifacts/`.

## Requirement input

Use one of these ways to submit a requirement:

```bash
# Fastest demo path: pass one sentence directly
npm run dev -- --prompt "Build a project delivery dashboard for an AI team"

# Or use a positional sentence
npm run dev -- "Build a project delivery dashboard for an AI team"

# Or edit the project-root requirement.md, then run
npm run dev

# Or point to a different markdown file
npm run dev -- --file ./requirement.md

# Show CLI help
npm run dev -- --help
```

Input priority:

1. inline prompt (`--prompt "..."` or positional sentence)
2. `--file path/to/requirement.md`
3. project-root `requirement.md`
4. built-in fallback demo requirement

## Speckit-style clarification flow

The first step is no longer "send the raw sentence to Stitch".

Instead the runtime now does this:

1. accept a one-line requirement or markdown requirement file
2. run `spec-agent` to turn it into a clarified, structured spec
3. persist that clarified spec to `artifacts/specs`
4. use the clarified spec as the grounding input for `ui-agent`
5. send the resulting prompt to Stitch

This makes the UI generation step more stable because Stitch receives a clearer specification with:

- clarified scope
- user scenarios
- feature slices
- success criteria
- explicit assumptions

## Stitch setup

For the real Stitch path, configure one of these:

- `STITCH_API_KEY`
- `STITCH_ACCESS_TOKEN` together with `GOOGLE_CLOUD_PROJECT`

Optional settings:

- `STITCH_PROJECT_ID`: reuse an existing Stitch project instead of creating a new one
- `STITCH_DEVICE_TYPE`: `DESKTOP`, `MOBILE`, `TABLET`, or `AGNOSTIC`
- `STITCH_MODEL_ID`: `GEMINI_3_PRO`, `GEMINI_3_FLASH`, or `GEMINI_3_1_PRO`
- `STITCH_HOST`: override the default Stitch MCP endpoint
- `STITCH_PROXY_URL`: force a specific HTTP proxy for Stitch requests

## Proxy behavior

When real Stitch credentials are present, the runtime now supports proxy routing in this order:

1. explicit `STITCH_PROXY_URL`
2. standard `HTTP_PROXY` / `HTTPS_PROXY`
3. automatic macOS system proxy detection through `scutil --proxy`

This is important because the Stitch SDK itself does not expose a dedicated proxy option, and the Node runtime in this environment did not automatically honor the system proxy without an explicit `undici` dispatcher.

## Recommended next steps

1. Expand Stitch handling with richer project reuse, edit flows, and variants when needed.
2. Swap the mock agents for real model-backed agents.
3. Persist jobs in SQLite or Postgres instead of memory.
4. Connect `MockTestRunner` to your actual test commands and CI signals.
5. Replace `MockDeployer` with your real staging and production release flow.
