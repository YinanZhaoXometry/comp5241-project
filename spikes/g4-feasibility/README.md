# G4 feasibility spike harness (epic-6 entry 6.2) — disposable, not product code

This folder is the throwaway evidence harness for ticket 6.2 ("G4 feasibility
spike: isolated code runner and offline narration"). It is deliberately
outside every lint/typecheck/build surface (`npm run lint` and `tsc` scan
`src scripts tests` and listed configs only). It adds no project dependency,
installs nothing globally, and is committed as spike evidence only.

Outputs (admission-grade dossiers, in the epic folder):

- `../../../_bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/g4-runner-dossier.md`
- `../../../_bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/g4-narration-dossier.md`
- `../../../_bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/g4-probe-results.json` (machine-readable probe evidence)

## runner/ — per-job isolated sandbox supervisor + probe battery

- `run_job.py` / `run-job.sh`: one job = one hardened, digest-pinned,
  no-network Colima container (see the runner dossier for the full flag set);
  wall/output caps; force-cleanup; evidence JSON on stdout.
- `seccomp-runner-strict.json`: default-deny seccomp profile (production
  candidate, spike-grade). `seccomp-runner-relaxed-test.json`: TEST-ONLY
  variant that allows clone so the cgroup pids-limit could be demonstrated
  independently — never a production candidate.
- `probes/*.py`: original synthetic probe payloads (legal jobs, escape,
  egress, resource exhaustion, CPU quota).
- `run_probes.py` / `run-probes.sh`: the serialized battery; writes
  `g4-probe-results.json` into the epic folder.

## narration/ — offline TTS trials (no remote TTS calls)

- `trial-piper.sh`: Piper (piper-tts 1.8.0, GPL-3.0-or-later) in a local uv
  venv + one voice model, then fully offline synthesis with timings.
- `trial-say.sh`: macOS built-in `say` (Apple SLA; Apple hardware only).
- `trial-espeak.sh` + `Dockerfile.espeak-trial`: espeak-ng 1.52.0 timed
  inside a hardened throwaway container derived from the same pinned official
  base as the runner; image removed after the trial.
- `samples/`: owner-listenable WAV evidence (the agent cannot audition).
- `.venv/` and `voices/` are disposable local artifacts (git-ignored /
  regenerable); trial scripts re-create them on demand.

Nothing here selects or activates an engine, voice or runner: fail-closed
admission decisions belong to entries 6.6 and 6.7 on the dossiers' inputs.
