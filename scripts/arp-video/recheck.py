"""Re-check one teacher's rendered clips from their audio (no new audio): rewrites the QA record (what speech
recognition heard, gaps, pauses, resets) and the caption sentence times in the client manifest. Audio, durations,
cue marks and take counts are kept.
  ASR_MODEL=small.en <venv>/python scripts/arp-video/recheck.py lines.json --teacher t1 [--only id,id]
"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asrcheck import check  # noqa: E402
from voicecheck import analyse  # noqa: E402
from narrate_cb import paths, sentence_times  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("lines")
ap.add_argument("--teacher", required=True)
ap.add_argument("--only")
a = ap.parse_args()
lines = {l["id"]: l for l in json.load(open(a.lines, encoding="utf-8"))}
out_dir, manifest, qa_path = paths(a.teacher)
man = json.load(open(manifest, encoding="utf-8"))
qa = json.load(open(qa_path, encoding="utf-8")) if os.path.exists(qa_path) else {"voice": man["voice"], "lines": {}}
ids = a.only.split(",") if a.only else sorted(man["lines"])
for cid in ids:
    e = man["lines"][cid]
    text = re.sub(r"\s{2,}", " ", lines[cid]["say"].replace("{p}", " ")).strip()
    path = os.path.join(out_dir, e["file"])
    asr, av = check(path, text), analyse(path, text)
    e["sents"] = sentence_times(lines[cid]["text"], asr["words"])
    qa["lines"][cid] = {**qa["lines"].get(cid, {}), "word_errors": asr["word_errors"], "odd_gaps": asr["odd_gaps"], "extra_pauses": av["extra_pauses"], "resets": av["resets"],
                        "heard": asr["heard"], "asr": os.environ.get("ASR_MODEL", "base.en")}
    flag = "" if asr["word_errors"] <= max(1, round(len(text.split()) * 0.05)) and asr["odd_gaps"] == 0 else "  <-- check"
    print(f"{cid}: errors {asr['word_errors']}, gaps {asr['odd_gaps']} {asr['gaps']}, extra {av['extra_pauses']}, resets {av['resets']}, sents {e['sents']}{flag}", flush=True)
    json.dump(man, open(manifest, "w", encoding="utf-8", newline="\n"), indent=1)
    json.dump(qa, open(qa_path, "w", encoding="utf-8", newline="\n"), indent=1)
