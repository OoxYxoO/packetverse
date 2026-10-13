"""Audio file coverage: decode every clip each teacher's manifest lists and record what is really on disk.
  python scripts/arp-video/filecheck.py        (needs soundfile with MP3 support)
Writes scripts/arp-video/qa/coverage.json: {teacher: {clip id: {file, bytes, decodedMs, error?}}}. The audit holds every
selectable teacher to it: each required clip listed, the file present and non-empty (same size as when decoded),
decodable, and as long as the manifest says.
"""
import json, os
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
VOICES = os.path.join(ROOT, "src", "app", "demo", "arp-resolution", "arp-video", "voices")
out = {}
for name in sorted(os.listdir(VOICES)):
    if not name.endswith(".json"):
        continue
    teacher = name[:-5]
    man = json.load(open(os.path.join(VOICES, name), encoding="utf-8"))["lines"]
    rows = {}
    for cid, e in man.items():
        path = os.path.join(ROOT, "public", "arp-video", "narration", teacher, e["file"])
        row = {"file": e["file"], "bytes": os.path.getsize(path) if os.path.exists(path) else 0, "decodedMs": 0}
        try:
            a, sr = sf.read(path)
            row["decodedMs"] = round(len(a) / sr * 1000)
        except Exception as ex:  # missing, empty or corrupt
            row["error"] = str(ex)[:120]
        rows[cid] = row
    out[teacher] = rows
    bad = [k for k, r in rows.items() if r.get("error") or not r["bytes"] or abs(r["decodedMs"] - man[k]["ms"]) > 150]
    print(f"{teacher}: {len(rows)} listed, {len(rows) - len(bad)} decode at the recorded length, {len(bad)} problem(s) {bad[:5]}")
json.dump(out, open(os.path.join(HERE, "qa", "coverage.json"), "w", encoding="utf-8", newline="\n"), indent=1)
