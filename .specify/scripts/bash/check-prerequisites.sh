#!/usr/bin/env bash
set -euo pipefail

JSON=false

for arg in "$@"; do
  case "$arg" in
    --json|-Json)
      JSON=true
      ;;
    --paths-only|-PathsOnly)
      ;;
  esac
done

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
FEATURE_NAME=""

if [[ "$CURRENT_BRANCH" =~ ^[0-9]+-.+ ]]; then
  FEATURE_NAME="$CURRENT_BRANCH"
fi

if [[ -z "$FEATURE_NAME" && -d "$ROOT_DIR/specs" ]]; then
  FEATURE_NAME="$(find "$ROOT_DIR/specs" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tail -n 1)"
fi

if [[ -z "$FEATURE_NAME" ]]; then
  echo "No active Speckit feature directory was found under $ROOT_DIR/specs" >&2
  exit 1
fi

FEATURE_DIR="$ROOT_DIR/specs/$FEATURE_NAME"
FEATURE_SPEC="$FEATURE_DIR/spec.md"
IMPL_PLAN="$FEATURE_DIR/plan.md"
TASKS="$FEATURE_DIR/tasks.md"

AVAILABLE_DOCS=()
[[ -f "$FEATURE_SPEC" ]] && AVAILABLE_DOCS+=("spec.md")
[[ -f "$IMPL_PLAN" ]] && AVAILABLE_DOCS+=("plan.md")
[[ -f "$TASKS" ]] && AVAILABLE_DOCS+=("tasks.md")
[[ -f "$FEATURE_DIR/research.md" ]] && AVAILABLE_DOCS+=("research.md")
[[ -f "$FEATURE_DIR/data-model.md" ]] && AVAILABLE_DOCS+=("data-model.md")
[[ -d "$FEATURE_DIR/contracts" ]] && AVAILABLE_DOCS+=("contracts/")
[[ -f "$FEATURE_DIR/quickstart.md" ]] && AVAILABLE_DOCS+=("quickstart.md")

if [[ "$JSON" == true ]]; then
  DOCS_JSON=""
  for doc in "${AVAILABLE_DOCS[@]}"; do
    if [[ -n "$DOCS_JSON" ]]; then
      DOCS_JSON+=", "
    fi
    DOCS_JSON+="\"$doc\""
  done

  cat <<EOF
{"ROOT_DIR":"$ROOT_DIR","BRANCH":"$FEATURE_NAME","FEATURE_DIR":"$FEATURE_DIR","FEATURE_SPEC":"$FEATURE_SPEC","IMPL_PLAN":"$IMPL_PLAN","TASKS":"$TASKS","AVAILABLE_DOCS":[${DOCS_JSON}]}
EOF
else
  echo "ROOT_DIR=$ROOT_DIR"
  echo "BRANCH=$FEATURE_NAME"
  echo "FEATURE_DIR=$FEATURE_DIR"
  echo "FEATURE_SPEC=$FEATURE_SPEC"
  echo "IMPL_PLAN=$IMPL_PLAN"
  echo "TASKS=$TASKS"
fi
