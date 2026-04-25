# Iteration Roadmap

This project will be implemented as a sequence of small, reviewable versions. Each version should end with:

1. one clearly scoped change
2. a local verification step
3. a git commit

## Version plan

### v0.1 Baseline scaffold

Status: completed

Scope:

- bootstrap the orchestrator
- define agent roles
- define tool and storage interfaces
- define folder scopes and agent runtime policy
- run the end-to-end workflow with mock integrations

Verification:

- `npm run build`
- `npm run dev`

### v0.2 Real Stitch integration

Status: implemented in code, credentialed verification pending

Scope:

- replace the mock Stitch client with a real SDK-backed or browser-backed client
- support login, submission, polling, and artifact download
- persist downloaded artifacts in the correct workspace folder

Verification:

- configure Stitch credentials in `.env`
- submit a sample requirement to Stitch
- wait for completion
- download both the UI screenshot and HTML successfully

### v0.3 Model-backed agent runtime

Scope:

- add a shared model runner
- let each agent execute with its configured prompt and model profile
- preserve the existing structured result contract

Verification:

- run the same sample job with model-backed spec and UI agents
- confirm agent runs are still recorded and scoped correctly

### v0.4 Repo task execution

Scope:

- connect the development stage to a real target repository
- define workspace ownership for frontend, backend, and test slices
- make development and fix stages produce actual code changes

Verification:

- complete one feature slice against a real codebase
- inspect changed files and ownership boundaries

### v0.5 Real test and fix loop

Scope:

- connect feature, flow, and acceptance test stages to real commands
- store test outputs and bug summaries
- make fix runs respond to actual failures

Verification:

- force a failing feature test
- confirm the repair loop executes and re-tests correctly

### v0.6 Requirement alignment checks

Scope:

- improve monitor agent checks against the approved requirement
- compare spec, artifacts, changed files, and test outcomes
- block release on meaningful drift

Verification:

- simulate a feature mismatch
- confirm the monitor stage blocks deployment

### v0.7 Deployment integration

Scope:

- replace the mock deployer with a real staging deployment
- save release manifests and environment metadata
- support release approval gates

Verification:

- deploy a validated build to the target staging environment
- record deployment metadata successfully

## Commit rhythm

Use one commit per completed version or sub-slice. Keep messages short and outcome-focused.

Examples:

- `chore: bootstrap agent orchestration scaffold`
- `feat: add real stitch submission client`
- `feat: connect model runtime for spec and ui agents`
- `feat: run real feature tests in repair loop`
