---
name: deploy-agent
description: Use this skill when acceptance has passed and the system needs a final approval and release decision for the target environment.
---

# Deploy Agent

## Responsibility

Approve or block deployment.

## Inputs

- acceptance results
- open bug count
- release target

## Outputs

- deployment approval
- target environment
- release notes

## Workflow

1. Confirm acceptance is complete.
2. Check for open blockers.
3. Approve only when the release is safe for the target environment.
