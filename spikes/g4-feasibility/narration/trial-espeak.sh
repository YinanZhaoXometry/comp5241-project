#!/bin/sh
# G4 spike — offline narration trial: espeak-ng timed inside a disposable
# hardened container derived from the pinned official base (same hardening
# flag set as the code-runner jobs; payload via stdin, output via stdout).
# The derived image is removed at the end (recorded cleanup).
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
cd "$dir"
IMAGE=g4spike-espeak-trial:local
PROFILE="$(cd ../runner && pwd)/seccomp-runner-strict.json"

echo "--- build derived trial image (record digest):"
docker build -q -f Dockerfile.espeak-trial -t "$IMAGE" . | tee /tmp/g4-espeak-imgid.txt
docker image inspect "$IMAGE" --format 'digest-locked-id={{.Id}}'

echo "--- version (via hardened run, network none):"
docker run --rm --network none --user 65532:65532 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --security-opt "seccomp=$PROFILE" --log-driver none \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --entrypoint cat "$IMAGE" /espeak-version.txt

echo "--- synthesis (timed, output via stdout, strict seccomp):"
mkdir -p samples
python3 - <<'EOF'
import subprocess, time
text = open("sample-text.txt").read().strip().splitlines()
image = "g4spike-espeak-trial:local"
import os
profile = os.environ["G4_PROFILE"]
base = ["docker", "run", "--rm", "--network", "none", "--user", "65532:65532",
        "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--security-opt", f"seccomp={profile}", "--log-driver", "none",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "-i", image]
total = 0.0
for i, line in enumerate(text):
    t0 = time.monotonic()
    p = subprocess.run(base, input=line.encode(), capture_output=True)
    dt = time.monotonic() - t0
    total += dt
    if p.returncode == 0:
        with open(f"samples/espeak-ng-sent{i}.wav", "wb") as f:
            f.write(p.stdout)
        print(f"sentence {i+1}: {dt:.2f}s ({len(line.split())} words) -> {len(p.stdout)} bytes wav, exit 0")
    else:
        print(f"sentence {i+1}: FAILED exit={p.returncode} stderr={p.stderr[:200]!r}")
print(f"total: {total:.2f}s")
EOF
echo "--- cleanup derived image:"
docker rmi "$IMAGE" >/dev/null && echo "image removed: $IMAGE"
echo "trial-espeak done"
