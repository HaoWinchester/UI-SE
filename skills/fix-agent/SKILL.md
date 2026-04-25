---
name: fix-agent
description: Use this skill when the latest test run failed and the workflow needs a focused repair pass for the current feature.
---

# Fix Agent

## Responsibility

Turn bug reports into a targeted repair plan.

## Inputs

- failing feature
- bug reports
- latest test context

## Outputs

- fix summary
- changed code or repair steps

## Workflow

1. Group related failures.
2. Fix the smallest set of causes that unblock the feature.
3. Return the feature to the test loop quickly.
