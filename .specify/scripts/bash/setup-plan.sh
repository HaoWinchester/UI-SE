#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PREREQ_JSON="$("$ROOT_DIR/.specify/scripts/bash/check-prerequisites.sh" --json)"

FEATURE_DIR="$(printf '%s' "$PREREQ_JSON" | sed -n 's/.*"FEATURE_DIR":"\([^"]*\)".*/\1/p')"
FEATURE_SPEC="$(printf '%s' "$PREREQ_JSON" | sed -n 's/.*"FEATURE_SPEC":"\([^"]*\)".*/\1/p')"
BRANCH_NAME="$(printf '%s' "$PREREQ_JSON" | sed -n 's/.*"BRANCH":"\([^"]*\)".*/\1/p')"
IMPL_PLAN="$FEATURE_DIR/plan.md"

mkdir -p "$FEATURE_DIR"

if [[ ! -f "$IMPL_PLAN" ]]; then
  cat > "$IMPL_PLAN" <<EOF
# Implementation Plan: $BRANCH_NAME

**Branch**: \`$BRANCH_NAME\`  
**Spec**: \`$FEATURE_SPEC\`

## Summary

Document the technical implementation plan here.

## Technical Context

- Runtime:
- Framework:
- Data layer:
- Constraints:

## Constitution Check

- [ ] Requirement clarity before generation
- [ ] Visible traceability across artifacts
- [ ] Customer approval gates preserved
EOF
fi

cat <<EOF
{"FEATURE_SPEC":"$FEATURE_SPEC","IMPL_PLAN":"$IMPL_PLAN","SPECS_DIR":"$ROOT_DIR/specs","BRANCH":"$BRANCH_NAME"}
EOF
