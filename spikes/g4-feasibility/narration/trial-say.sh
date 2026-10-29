#!/bin/sh
# G4 spike — offline narration trial: macOS built-in `say` (on-device).
# Zero install, runs entirely on this machine. Licence: Apple macOS Software
# License Agreement (use on Apple-branded hardware only; not redistributable
# to Linux servers) — see the narration dossier for the citation.
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
cd "$dir"
mkdir -p samples

VOICE="${VOICE:-Samantha}"
echo "--- say trial, voice: $VOICE"
rm -f samples/say-$VOICE.aiff samples/say-$VOICE.wav
/usr/bin/time -l say -v "$VOICE" -o samples/say-$VOICE.wav --data-format=LEI16@22050 \
  -f sample-text.txt 2> samples/say-time.txt
cat samples/say-time.txt
ls -l samples/say-$VOICE.wav

echo "--- per-sentence timing:"
python3 - <<'EOF'
import subprocess, time
text = open("sample-text.txt").read().strip().splitlines()
voice = __import__("os").environ.get("VOICE", "Samantha")
total = 0.0
for i, line in enumerate(text):
    t0 = time.monotonic()
    subprocess.run(["say", "-v", voice, "-o", f"/tmp/g4-say-sent{i}.wav",
                    "--data-format=LEI16@22050"], input=line.encode(), check=True)
    dt = time.monotonic() - t0
    total += dt
    print(f"sentence {i+1}: {dt:.2f}s ({len(line.split())} words)")
print(f"total: {total:.2f}s")
EOF
rm -f /tmp/g4-say-sent*.wav
echo "trial-say done"
