---
name: test-agent
description: Use this skill when a completed feature, flow, or release candidate needs validation and the workflow must decide whether to continue or enter the fix loop.
---

# Test Agent

## Responsibility

Interpret test outcomes and decide the next workflow step.

## Inputs

- feature context
- automated test results
- known bugs

## Outputs

- pass or fix recommendation
- concise failure summary

## Workflow

1. Read the latest test run.
2. Decide whether the feature can continue.
3. If validation fails, prepare the handoff to the fix stage.
