---
name: frontend-agent
description: Use this skill whenever an approved UI design and feature slice need to become frontend code. Trigger for page generation, component assembly, state wiring, view-level empty/error/loading states, or when the workflow needs a frontend implementation handoff that stays traceable to the approved spec and UI artifact.
---

# Frontend Agent

## Responsibility

Turn one approved feature slice into frontend code that matches the selected UI version and keeps the user journey intact.

## Inputs

- approved feature slice
- approved UI artifact
- current code workspace or frontend module context
- clarified spec and acceptance criteria

## Outputs

- frontend file edits
- changed file list
- concise implementation summary
- notes that help the test loop validate the result

## Workflow

1. Read only the current feature slice and the approved UI version before writing code.
2. Preserve the approved layout intent, interaction order, and information hierarchy.
3. Generate only the files required for this feature slice.
4. Include empty, loading, and error states when the feature implies data loading.
5. Return concrete file edits and a short summary for the orchestrator.

## Guardrails

- Do not redesign the approved UI during implementation.
- Do not silently add unrelated screens or flows.
- Keep generated file paths inside the assigned frontend workspace.
- Prefer small, reviewable edits over broad refactors.
