# Agent Runtime

This project treats agents as controlled decision roles, not as direct owners of browser automation, test execution, or deployment scripts.

## Runtime contract

Each agent declares:

- `systemPrompt`: the role guidance to use once the model runtime is connected
- `model`: the intended model profile for that role
- `readScopes`: folders the agent can inspect
- `writeScopes`: folders the agent is allowed to modify
- `tools`: deterministic tools the agent may request through the orchestrator

The source of truth for single-agent runtime constraints lives in `src/agents/registry.ts`.
The team-level grouping draft lives in `src/config/agent-teams.ts`.

## Current agent map

- `spec-agent`
  reads: `docs`, `skills/spec-agent`
  writes: `docs`, `artifacts/specs`, `skills/spec-agent`
- `ui-agent`
  reads: `docs`, `artifacts/specs`, `skills/ui-agent`
  writes: `artifacts/ui`
- `frontend-agent`
  reads: `docs`, `artifacts/ui`, `artifacts/specs`, `artifacts/code-workspace`, `skills/frontend-agent`
  writes: `artifacts/code-workspace`
- `backend-agent`
  reads: `docs`, `artifacts/specs`, `artifacts/code-workspace`, `skills/backend-agent`
  writes: `artifacts/code-workspace`
- `db-agent`
  reads: `docs`, `artifacts/specs`, `artifacts/code-workspace`, `skills/db-agent`
  writes: `artifacts/code-workspace`
- `test-agent`
  reads: `artifacts/code-workspace`, `artifacts/test-reports`, `skills/test-agent`
  writes: `artifacts/test-reports`
- `fix-agent`
  reads: `artifacts/code-workspace`, `artifacts/test-reports`, `skills/fix-agent`
  writes: `artifacts/code-workspace`
- `monitor-agent`
  reads: `docs`, `artifacts`, `skills/monitor-agent`
  writes: none
- `acceptance-agent`
  reads: `artifacts`, `docs`, `skills/acceptance-agent`
  writes: none
- `deploy-agent`
  reads: `artifacts/build`, `artifacts/test-reports`, `artifacts/code-workspace`, `skills/deploy-agent`
  writes: `artifacts/build`

## Enforcement

The orchestrator validates every agent-reported write path against the declared `writeScopes`. This is not a full sandbox yet, but it keeps the contract explicit and makes it much easier to upgrade to stricter execution later.

## Team orchestration

The current repository also includes and actively uses a team-level layer:

- requirement-design team
- delivery team
- quality team
- release team

This layer does not replace the per-agent runtime contract. It sits above it and answers:

- which agents belong together
- which members can run in parallel
- which members must stay serial
- what artifacts a team shares before handing off to the next team

The orchestrator already uses this layer to:

- tag the current active team on the job state
- record team handoffs in workflow history
- attach team context to agent runs and workflow logs
- surface current team and handoff information in the dashboard and CLI output
