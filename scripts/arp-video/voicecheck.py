"""
Listen-free narration check: analyses the RENDERED audio (not the text) for the things that make TTS sound unnatural.

  python scripts/arp-video/voicecheck.py lines.json [--dir public/arp-video/narration/t1] [--json out.json]

Per clip it measures:
  pauses        every silence ≥ 90 ms inside the speech, compared with the pauses the text calls for (sentence ends,
                commas/colons/dashes, {p}); EXTRA pauses = breaks a speaker wouldn't make (mid-phrase / mid-word)
  pitch spikes  frames whose pitch leaps > 7 semitones away from the surrounding 300 ms (squeaks, cracks)
  pitch resets  after a short gap (< 400 ms) the pitch restarts > 6 semitones higher than where it stopped
  end jumps     a statement whose last 250 ms rises > 4 semitones above the clip's median (sounds like a question)
  level/edges   speech loudness (dBFS of voiced frames), pitch median, leading/trailing silence — for clip-to-clip
                consistency (one narrator, one recording)
Nothing here proves a voice sounds human; it finds the specific defects that make it sound synthetic.
"""
import argparse, json, os, re, sys
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def frames(a, sr, win=0.03, hop=0.01):
    w, h = int(win * sr), int(hop * sr)
    n = max(0, (len(a) - w) // h)
    return np.lib.stride_tricks.as_strided(a, shape=(n, w), strides=(a.strides[0] * h, a.strides[0])), h


def f0_track(a, sr):
    fr, h = frames(a, sr, 0.04, 0.01)
    lo, hi = int(sr / 380), int(sr / 65)
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    gate = max(1e-4, np.percentile(rms, 90) * 0.12)
    out = np.full(len(fr), np.nan)
    for i, x in enumerate(fr):
        if rms[i] < gate:
            continue
        x = x - x.mean()
        c = np.correlate(x, x, "full")[len(x) - 1:]
        if c[0] <= 0:
            continue
        j = lo + int(np.argmax(c[lo:hi]))
        if c[j] > 0.45 * c[0]:
            out[i] = sr / j
    return out


def analyse(path, text):
    a, sr = sf.read(path)
    if a.ndim > 1:
        a = a.mean(axis=1)
    fr, h = frames(a, sr, 0.03, 0.01)
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    peak = np.percentile(db, 95)
    silent = db < peak - 38
    # leading / trailing silence
    idx = np.where(~silent)[0]
    lead = idx[0] * 10 if len(idx) else 0
    tail = (len(silent) - idx[-1]) * 10 if len(idx) else 0
    # internal pauses (≥ 90 ms)
    pauses, run = [], 0
    for i in range(idx[0], idx[-1] + 1) if len(idx) else []:
        if silent[i]:
            run += 1
        else:
            if run >= 9:
                pauses.append(run * 10)
            run = 0
    clean = text.replace("{p}", " | ")
    # pauses the text calls for: sentence ends, clause marks, explicit {p}
    expected = len(re.findall(r"[.!?…]+(?=\s+\S)", clean)) + len(re.findall(r"[,;:—–]|\s-\s", clean)) + clean.count("|")
    hard = len(re.findall(r"[.!?…]+(?=\s+\S)", clean)) + clean.count("|")
    f0 = f0_track(a, sr)
    v = ~np.isnan(f0)
    st = np.full_like(f0, np.nan)
    if v.sum() > 10:
        med = np.nanmedian(f0)
        st[v] = 12 * np.log2(f0[v] / med)
    spikes = 0
    for i in np.where(v)[0]:
        w = st[max(0, i - 15): i + 16]
        w = w[~np.isnan(w)]
        if len(w) > 8 and abs(st[i] - np.median(w)) > 7:
            spikes += 1
    # resets: voiced runs separated by short gaps where the new run starts much higher
    resets, last_end, gap = 0, None, 0
    for i in range(len(st)):
        if np.isnan(st[i]):
            gap += 1
            continue
        if last_end is not None and 5 <= gap <= 40:
            start = np.nanmedian(st[i: i + 8])
            if start - last_end > 6:
                resets += 1
        last_end = np.nanmedian(st[max(0, i - 7): i + 1])
        gap = 0
    voiced = np.where(v)[0]
    end_jump = 0.0
    if len(voiced) > 40:
        end = st[voiced[-25:]]
        end_jump = float(np.nanmedian(end))
    is_question = text.strip().rstrip('"”').endswith("?")
    speech_db = float(np.mean(db[~silent])) if (~silent).any() else -99
    return {
        "dur": round(len(a) / sr, 2),
        "lead_ms": int(lead), "tail_ms": int(tail),
        "pauses": len(pauses), "expected": expected, "hard": hard,
        "extra_pauses": max(0, len(pauses) - expected),
        "long_pauses": sum(1 for p in pauses if p >= 700),
        "spikes": int(spikes), "resets": int(resets),
        "end_jump": round(end_jump, 1), "question": is_question,
        "speech_db": round(speech_db, 1),
        "f0_median": round(float(np.nanmedian(f0)), 1) if v.any() else 0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lines")
    ap.add_argument("--dir", default=os.path.join(ROOT, "public", "arp-video", "narration", "t1"), help="one teacher's narration folder")
    ap.add_argument("--json")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    lines = json.load(open(a.lines, encoding="utf-8"))
    res = {}
    for ln in lines:
        p = os.path.join(a.dir, ln["id"].replace("/", "_") + ".mp3")
        if not os.path.exists(p):
            p = os.path.join(a.dir, ln["id"] + ".wav")
        if not os.path.exists(p):
            continue
        res[ln["id"]] = {**analyse(p, ln.get("say", "")), "text": ln.get("say", "")}
    if not res:
        print("no clips found")
        return 1
    vals = list(res.values())
    def stat(k):
        x = np.array([r[k] for r in vals], dtype=float)
        return f"median {np.median(x):.1f}, spread {np.percentile(x, 90) - np.percentile(x, 10):.1f}"
    stmt_jumps = [r for r in vals if not r["question"] and r["end_jump"] > 4]
    print(f"clips {len(vals)}")
    print(f"  extra pauses (beyond punctuation): total {sum(r['extra_pauses'] for r in vals)} in {sum(1 for r in vals if r['extra_pauses'])} clips")
    print(f"  pauses ≥ 0.7 s inside a clip: {sum(r['long_pauses'] for r in vals)}")
    print(f"  pitch spikes: total {sum(r['spikes'] for r in vals)} in {sum(1 for r in vals if r['spikes'])} clips")
    print(f"  pitch resets after short gaps: total {sum(r['resets'] for r in vals)} in {sum(1 for r in vals if r['resets'])} clips")
    print(f"  statements ending > 4 st high: {len(stmt_jumps)}")
    print(f"  speech level dBFS: {stat('speech_db')}   pitch Hz: {stat('f0_median')}")
    print(f"  lead silence ms: {stat('lead_ms')}   tail silence ms: {stat('tail_ms')}")
    if not a.quiet:
        worst = sorted(res.items(), key=lambda kv: -(kv[1]["extra_pauses"] * 2 + kv[1]["resets"] * 2 + kv[1]["spikes"]))[:8]
        for k, r in worst:
            print(f"   {k}: extra {r['extra_pauses']}, resets {r['resets']}, spikes {r['spikes']}, end {r['end_jump']:+.1f}  | {r['text'][:90]}")
    if a.json:
        json.dump(res, open(a.json, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
