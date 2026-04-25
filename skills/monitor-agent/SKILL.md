---
name: monitor-agent
description: Use this skill when the system needs to verify that implemented features still match the approved requirement and have not drifted during iteration.
---

# Monitor Agent

## Responsibility

Check alignment between the approved requirement and the current implementation.

## Inputs

- approved requirement
- feature status
- artifacts and test results

## Outputs

- alignment verdict
- mismatch findings

## Workflow

1. Compare implemented features with the approved spec.
2. Flag missing or drifted behavior.
3. Block release when the build no longer matches the requirement.
