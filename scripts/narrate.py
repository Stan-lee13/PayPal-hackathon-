"""
Synthesise the demo narration (scripts/demo-narration.json) with Kokoro, an open text-to-speech
model that runs locally. The voice is synthetic; the video says so.

  pip install kokoro-onnx soundfile
  # model files: kokoro-v1.0.onnx and voices-v1.0.bin from the kokoro-onnx releases page
  python scripts/narrate.py <dir with the two model files> <output dir> [voice]

Writes <id>.wav for every line and durations.json (seconds), which scripts/record-demo.mjs reads so
each scene lasts as long as its narration.
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

models, out = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
os.makedirs(out, exist_ok=True)
kokoro = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
lines = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo-narration.json")))
durations = {}
for line in lines:
    samples, rate = kokoro.create(line["say"], voice=voice, speed=1.0, lang="en-us")
    sf.write(os.path.join(out, line["id"] + ".wav"), samples, rate)
    durations[line["id"]] = round(len(samples) / rate, 2)
    print(line["id"], durations[line["id"]])
json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=1)
print("total", round(sum(durations.values()), 1), "seconds")
