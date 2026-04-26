---
name: acceptance-agent
description: Use this skill whenever implementation has passed tests and the system needs to decide whether the result is ready for customer preview or release approval. Trigger for preview artifact selection, final readiness checks, and handoff into deployment confirmation.
---

# Acceptance Agent

## Responsibility

Decide whether the current build is ready to show to the customer and identify the best preview entry point.

## Inputs

- approved requirement
- latest UI artifact
- current implementation status
- acceptance and alignment results
- preview artifacts

## Outputs

- ready or blocked decision
- selected preview path
- concise readiness summary

## Workflow

1. Confirm the approved requirement still matches the delivered feature set.
2. Check that acceptance and alignment results do not contain blockers.
3. Pick the clearest preview artifact for customer review.
4. Return a clear readiness decision and the preview path.

## Guardrails

- Do not approve preview if the customer would be seeing an obviously incomplete build.
- Do not ignore open blockers from acceptance or alignment stages.
- Prefer one clear preview artifact over many competing entry points.
