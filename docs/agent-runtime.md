# Agent Runtime

This project treats agents as controlled decision roles, not as direct owners of browser automation, test execution, or deployment scripts.

## Runtime contract

Each agent declares:

- `systemPrompt`: the role guidance to use once the model runtime is connected
- `model`: the intended model profile for that role
- `readScopes`: folders the agent can inspect
- `writeScopes`: folders the agent is allowed to modify
- `tools`: deterministic tools the agent may request through the orchestrator

The source of truth lives in `src/agents/registry.ts`.

## Current agent map

- `spec-agent`
  reads: `docs`, `skills/spec-agent`
  writes: `docs`, `artifacts/specs`, `skills/spec-agent`
- `ui-agent`
  reads: `docs`, `artifacts/specs`, `skills/ui-agent`
  writes: `artifacts/ui`
- `dev-agent`
  reads: `src`, `docs`, `artifacts/ui`, `skills/dev-agent`
  writes: `src`
- `test-agent`
  reads: `src`, `artifacts/test-reports`, `skills/test-agent`
  writes: `artifacts/test-reports`
- `fix-agent`
  reads: `src`, `artifacts/test-reports`, `skills/fix-agent`
  writes: `src`
- `monitor-agent`
  reads: `src`, `docs`, `artifacts`, `skills/monitor-agent`
  writes: none
- `deploy-agent`
  reads: `src`, `artifacts/build`, `artifacts/test-reports`, `skills/deploy-agent`
  writes: `artifacts/build`

## Enforcement

The orchestrator validates every agent-reported write path against the declared `writeScopes`. This is not a full sandbox yet, but it keeps the contract explicit and makes it much easier to upgrade to stricter execution later.
