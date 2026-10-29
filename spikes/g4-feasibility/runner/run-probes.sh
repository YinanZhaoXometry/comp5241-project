#!/bin/sh
# G4 spike — thin wrapper: run the whole probe battery.
# Writes _bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/g4-probe-results.json
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$dir/run_probes.py" "$@"
