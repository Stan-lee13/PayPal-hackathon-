"""
Assemble the demo video from what scripts/record-demo.mjs recorded.

  python3 scripts/assemble_demo.py <recording dir> <narration dir> <output.mp4>

Reads <recording dir>/envelope-demo.webm and timeline.json. Each scene is cut out; scenes that waited
on a language model (they carry a "target") are sped up to the length of their narration. The
narration wav for each scene (from scripts/narrate.py) is laid under it. Needs ffmpeg.
"""
import json
import os
import subprocess
import sys

rec, vo, out = sys.argv[1], sys.argv[2], sys.argv[3]
timeline = json.load(open(os.path.join(rec, "timeline.json")))
work = os.path.join(rec, "parts")
os.makedirs(work, exist_ok=True)


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


videos, audios, total = [], [], 0.0
for i, s in enumerate(timeline):
    real = s["t1"] - s["t0"]
    length = s.get("target", real)
    factor = length / real  # < 1 speeds the scene up
    v = os.path.join(work, f"{i:02d}-{s['id']}.mp4")
    run("-ss", f"{s['t0']:.3f}", "-t", f"{real:.3f}", "-i", os.path.join(rec, "envelope-demo.webm"),
        "-vf", f"setpts={factor:.6f}*PTS,fps=30,format=yuv420p", "-t", f"{length:.3f}", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", v)
    a = os.path.join(work, f"{i:02d}-{s['id']}.wav")
    wav = os.path.join(vo, s["id"] + ".wav")
    if os.path.exists(wav):
        run("-i", wav, "-af", "adelay=300|300,apad", "-t", f"{length:.3f}", "-ar", "44100", "-ac", "2", a)
    else:
        run("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", f"{length:.3f}", a)
    videos.append(v)
    audios.append(a)
    total += length
    print(f"{s['id']:10s} recorded {real:6.1f}s  shown {length:5.1f}s" + (f"  (x{1 / factor:.1f})" if "target" in s else ""))

with open(os.path.join(work, "v.txt"), "w") as f:
    f.writelines(f"file '{os.path.abspath(v)}'\n" for v in videos)
with open(os.path.join(work, "a.txt"), "w") as f:
    f.writelines(f"file '{os.path.abspath(a)}'\n" for a in audios)
run("-f", "concat", "-safe", "0", "-i", os.path.join(work, "v.txt"), "-c", "copy", os.path.join(work, "video.mp4"))
run("-f", "concat", "-safe", "0", "-i", os.path.join(work, "a.txt"), "-c:a", "pcm_s16le", os.path.join(work, "audio.wav"))
run("-i", os.path.join(work, "video.mp4"), "-i", os.path.join(work, "audio.wav"), "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-shortest", out)
print(f"\n{out}: {int(total // 60)}:{int(total % 60):02d}")
