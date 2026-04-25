#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TARGET_DIR="$ROOT_DIR/.specify/agent-context"
mkdir -p "$TARGET_DIR"

if [[ $# -gt 0 && -n "${1:-}" ]]; then
  AGENTS=("$1")
else
  AGENTS=("codex" "claude")
fi

for agent in "${AGENTS[@]}"; do
  cat > "$TARGET_DIR/$agent.md" <<EOF
# Agent Context: $agent

- Project: UI-SE
- Runtime: Node.js + TypeScript
- UI generation: Stitch
- Delivery flow: spec -> UI -> frontend/backend/database -> tests -> monitor -> acceptance -> deploy
- Key folders: src/agents, src/workflow, src/tools, artifacts, specs
EOF
done

echo "$TARGET_DIR"
