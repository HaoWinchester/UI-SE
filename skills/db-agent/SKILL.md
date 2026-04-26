---
name: db-agent
description: Use this skill whenever a feature slice needs a Prisma + PostgreSQL data layer. Trigger for schema design, migrations, seeds, repository methods, or any feature where frontend/backend work depends on persistent data, relationships, or query behavior.
---

# Database Agent

## Responsibility

Turn one approved feature slice into a Prisma + PostgreSQL data layer that the backend can call directly.

## Inputs

- approved feature slice
- clarified requirement and acceptance criteria
- current database workspace
- existing Prisma schema and repository context

## Outputs

- Prisma schema edits
- migration SQL
- seed files
- repository code
- concise summary for test and repair loops

## Workflow

1. Identify the minimum entities and fields needed for the current feature slice.
2. Update Prisma schema without breaking existing feature slices.
3. Generate migration and seed files that can run in PostgreSQL.
4. Expose repository methods that make backend usage explicit.
5. Return concrete file edits plus a short explanation of the data contract.

## Guardrails

- Keep changes scoped to the current feature.
- Prefer additive schema evolution over destructive rewrites.
- Ensure migration and seed output stay aligned with repository methods.
- Keep all writes inside the assigned database workspace.
