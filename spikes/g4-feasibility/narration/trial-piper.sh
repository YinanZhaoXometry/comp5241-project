#!/bin/sh
# G4 spike — offline narration trial: Piper (engine + voice) in a disposable
# local venv (uv). No global installs, no remote TTS calls: the engine and one
# voice model are downloaded once (like any pip dependency), then synthesis
# runs fully offline. Original synthetic text only.
#
# Voice: en_US-amy-low (rhasspy/piper-voices on Hugging Face).
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
cd "$dir"

if [ ! -d .venv ]; then
  ~/.local/bin/uv venv .venv
fi
. ./.venv/bin/activate
~/.local/bin/uv pip install -q piper-tts

MODEL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low"
mkdir -p voices
if [ ! -f voices/en_US-amy-low.onnx ]; then
  curl -fsSL --proto '=https' -o voices/en_US-amy-low.onnx "$MODEL_BASE/en_US-amy-low.onnx"
  curl -fsSL --proto '=https' -o voices/en_US-amy-low.onnx.json "$MODEL_BASE/en_US-amy-low.onnx.json"
fi

echo "--- engine version:"
python -m piper --version 2>&1 || true
echo "--- venv size (du -sh .venv):"
du -sh .venv
echo "--- model files:"
ls -l voices/

echo "--- synthesis (timed with /usr/bin/time):"
mkdir -p samples
/usr/bin/time -l python -m piper \
  --model voices/en_US-amy-low.onnx \
  --output_file samples/piper-en_US-amy-low.wav \
  < sample-text.txt 2> samples/piper-time.txt
cat samples/piper-time.txt

echo "--- wav info:"
ls -l samples/piper-en_US-amy-low.wav
file samples/piper-en_US-amy-low.wav 2>/dev/null || true

echo "--- per-sentence timing (offline, same engine):"
python - <<'EOF'
import subprocess, time
text = open("sample-text.txt").read().strip().splitlines()
for i, line in enumerate(text):
    t0 = time.monotonic()
    subprocess.run(
        ["python", "-m", "piper", "--model", "voices/en_US-amy-low.onnx",
         "--output_file", f"samples/_sent{i}.wav"],
        input=line.encode(), check=True, capture_output=True)
    dt = time.monotonic() - t0
    print(f"sentence {i+1}: {dt:.2f}s ({len(line.split())} words) -> samples/_sent{i}.wav")
EOF
rm -f samples/_sent*.wav
echo "trial-piper done"
