---
name: backend-agent
description: Use this skill whenever a feature slice needs backend implementation based on the approved requirement. Trigger for API routes, service logic, validation, response contracts, or when the workflow needs a backend handoff that matches the current feature scope and database plan.
---

# Backend Agent

## Responsibility

Convert one approved feature slice into backend routes, contracts, validation, and service behavior.

## Inputs

- approved feature slice
- clarified requirement and acceptance criteria
- current backend workspace
- database expectations for the same feature slice

## Outputs

- backend file edits
- changed file list
- concise implementation summary
- contract notes for test and database stages

## Workflow

1. Read the current feature slice and its acceptance criteria.
2. Define the smallest backend surface that supports the feature.
3. Add validation and response structure that are easy to test.
4. Keep repository and database calls explicit so the db-agent and test-agent can trace them.
5. Return concrete file edits with a short summary.

## Guardrails

- Do not implement unrelated endpoints.
- Do not invent data fields that are not justified by the approved feature.
- Keep file writes inside the assigned backend workspace.
- Favor explicit contracts over hidden implicit behavior.
