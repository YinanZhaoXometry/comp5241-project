#!/bin/sh
# G4 spike — thin wrapper: one job through the python3 supervisor.
# Usage: ./run-job.sh --name legal_correct --payload probes/legal_correct.py
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$dir/run_job.py" "$@"
