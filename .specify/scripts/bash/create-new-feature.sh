#!/usr/bin/env bash
set -euo pipefail

JSON=false
FEATURE_NUMBER=""
SHORT_NAME=""
DESCRIPTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json|-Json)
      JSON=true
      shift
      ;;
    --number|-Number)
      FEATURE_NUMBER="$2"
      shift 2
      ;;
    --short-name|-ShortName)
      SHORT_NAME="$2"
      shift 2
      ;;
    *)
      DESCRIPTION="$1"
      shift
      ;;
  esac
done

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$ROOT_DIR/specs"

if [[ -z "$SHORT_NAME" ]]; then
  SHORT_NAME="feature-request"
fi

if [[ -z "$FEATURE_NUMBER" ]]; then
  FEATURE_NUMBER=1
fi

BRANCH_NAME="$(printf "%03d-%s" "$FEATURE_NUMBER" "$SHORT_NAME")"
FEATURE_DIR="$ROOT_DIR/specs/$BRANCH_NAME"
SPEC_FILE="$FEATURE_DIR/spec.md"
CHECKLIST_FILE="$FEATURE_DIR/checklists/requirements.md"

mkdir -p "$FEATURE_DIR/checklists" "$FEATURE_DIR/contracts"

if [[ ! -f "$SPEC_FILE" ]]; then
  cat > "$SPEC_FILE" <<EOF
# Feature Specification: ${DESCRIPTION:-$SHORT_NAME}

**Feature Branch**: \`$BRANCH_NAME\`  
**Created**: $(date +%F)  
**Status**: Draft

## Overview

${DESCRIPTION:-Describe the feature here.}

## User Scenarios & Testing

### Primary User Story

As a user, I need ${DESCRIPTION:-this feature} so that I can achieve the expected outcome.

## Functional Requirements

- FR-001: The system MUST support the requested feature flow.

## Success Criteria

- SC-001: Stakeholders can review this feature with a complete written spec.

## Assumptions

- Initial assumptions will be refined during clarification.
EOF
fi

if [[ ! -f "$CHECKLIST_FILE" ]]; then
  cat > "$CHECKLIST_FILE" <<EOF
# Specification Quality Checklist: $BRANCH_NAME

**Purpose**: Validate specification completeness and quality before proceeding
**Created**: $(date +%F)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] All mandatory sections completed
EOF
fi

if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    git -C "$ROOT_DIR" switch "$BRANCH_NAME" >/dev/null
  else
    git -C "$ROOT_DIR" switch -c "$BRANCH_NAME" >/dev/null
  fi
fi

if [[ "$JSON" == true ]]; then
  cat <<EOF
{"ROOT_DIR":"$ROOT_DIR","BRANCH_NAME":"$BRANCH_NAME","FEATURE_DIR":"$FEATURE_DIR","SPEC_FILE":"$SPEC_FILE","CHECKLIST_FILE":"$CHECKLIST_FILE"}
EOF
else
  echo "BRANCH_NAME=$BRANCH_NAME"
  echo "FEATURE_DIR=$FEATURE_DIR"
  echo "SPEC_FILE=$SPEC_FILE"
  echo "CHECKLIST_FILE=$CHECKLIST_FILE"
fi
