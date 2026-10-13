"""
Render one teacher's ARP video narration with Chatterbox (MIT) and VERIFY every take.

  node --import ./scripts/arp-video/register.mjs scripts/arp-video/export-lines.ts > lines.json
  ASR_MODEL=small.en <venv>/python scripts/arp-video/narrate_cb.py lines.json --teacher t2

Each teacher is a voice preset (TEACHERS below): a synthetic reference clip for the timbre and calm settings. Output:
public/arp-video/narration/<teacher>/*.mp3, the client manifest voices/<teacher>.json (durations, cue and caption
times) and the QA record scripts/arp-video/qa/<teacher>.json (what speech recognition heard, pauses, resets).

For each clip (one natural narration unit: a line's sentences rendered together, never sentence-by-sentence):
  1. generate with Chatterbox (calm settings), timbre from a synthetic reference voice (no real person is cloned)
  2. loudness-match and give it the same edges as every other clip (one narrator, one recording)
  3. check the take: speech recognition (misheard / garbled words, gaps between words where the script has no
     punctuation) + audio analysis (pauses beyond punctuation, pitch resets)
  4. if the take has a problem, render again with another seed (up to --tries) and keep the best take
  5. place every [[cue]] on the spoken word it precedes, and time every caption sentence, from the recogniser's words
The manifest is written after every clip, so an interrupted run resumes where it stopped.
"""
import argparse, difflib, json, os, re, sys, time
import numpy as np
import soundfile as sf
import lameenc
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asrcheck import check, words_of  # noqa: E402
from voicecheck import analyse  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MARK = re.compile(r"\[\[([a-z0-9-]+)\]\]", re.I)
LEAD, TAIL = 0.08, 0.20

# The teachers. Every timbre comes from a short SYNTHETIC reference clip (a Kokoro voice, Apache-2.0, in refs/): no
# real person's voice is cloned. A tag must not change, or that teacher's clips would all be re-rendered.
TEACHERS = {
    # calm and steady US male, Kokoro am_echo timbre
    "t1": {"ref": "refs/t1-am_echo.wav", "exaggeration": 0.25, "cfg": 0.3, "tag": "chatterbox:echo-ref:ex0.25:cfg0.3", "kbps": 96},
    # warm and conversational US female, Kokoro af_heart timbre
    "t2": {"ref": "refs/t2-af_heart.wav", "exaggeration": 0.35, "cfg": 0.35, "tag": "chatterbox:heart-ref:ex0.35:cfg0.35", "kbps": 64},
    # clear and measured British female, Kokoro bf_emma timbre
    "t3": {"ref": "refs/t3-bf_emma.wav", "exaggeration": 0.3, "cfg": 0.3, "tag": "chatterbox:emma-ref:ex0.3:cfg0.3", "kbps": 64},
}


def paths(teacher):
    return (os.path.join(ROOT, "public", "arp-video", "narration", teacher),
            os.path.join(ROOT, "src", "app", "demo", "arp-resolution", "arp-video", "voices", f"{teacher}.json"),
            os.path.join(HERE, "qa", f"{teacher}.json"))


def sentences_of(text):
    """Caption sentences, split exactly like the player's sentencesOf (timeline.ts)."""
    return [x.strip() for x in re.split(r'(?:(?<=[.!?])|(?<=[.!?]["\u201d]))\s+(?=[A-Z"\u201c])', text) if x.strip()]


def sentence_times(caption, words):
    """When each caption sentence starts in the audio (ms), aligned to the recognised words like the cues."""
    parts = sentences_of(caption)
    if not parts:
        return []
    t = cue_times(" ".join(f"[[s{i}]]{p}" for i, p in enumerate(parts)), words)
    out = [0] + [t.get(f"s{i}", 0) for i in range(1, len(parts))]
    for i in range(1, len(out)):
        out[i] = max(out[i], out[i - 1])
    return out


def finish_audio(a, sr, target_db=-20.0):
    a = a.astype(np.float32)
    idx = np.where(np.abs(a) > 0.006)[0]
    if len(idx):
        a = a[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
    fr = int(0.03 * sr)
    if len(a) > fr:
        rms = np.sqrt(np.convolve(a ** 2, np.ones(fr) / fr, "same"))
        act = rms[rms > np.percentile(rms, 95) * 0.25]
        if len(act):
            a = a * 10 ** ((target_db - 20 * np.log10(np.sqrt(np.mean(act ** 2)) + 1e-9)) / 20)
    pk = np.max(np.abs(a)) if len(a) else 1
    if pk > 0.95:
        a = a * (0.95 / pk)
    f = int(0.01 * sr)
    if len(a) > 2 * f:
        a[:f] *= np.linspace(0, 1, f)
        a[-f:] *= np.linspace(1, 0, f)
    return np.concatenate([np.zeros(int(LEAD * sr), np.float32), a, np.zeros(int(TAIL * sr), np.float32)])


def encode_mp3(x, sr, path, kbps=96):
    pcm16 = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    open(path, "wb").write(enc.encode(pcm16.tobytes()) + enc.flush())
    return len(pcm16)


def cue_times(marked, words):
    """Each [[cue]] → start time of the first spoken word after it (script words aligned to recognised words)."""
    script, cues = [], {}
    for part in re.split(r"(\[\[[a-z0-9-]+\]\])", marked.replace("{p}", " ")):
        m = MARK.fullmatch(part)
        if m:
            cues[m.group(1)] = len(script)
        else:
            script += words_of(part)
    heard = [words_of(w)[0] if words_of(w) else "" for w, _, _ in words]
    sm = difflib.SequenceMatcher(a=script, b=heard, autojunk=False)
    amap = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            amap[blk.a + k] = blk.b + k
    out = {}
    for name, si in cues.items():
        j = next((amap[i] for i in range(si, len(script)) if i in amap), None)
        if j is None:
            j = next((amap[i] for i in range(si - 1, -1, -1) if i in amap), 0)
            out[name] = round(words[j][2] * 1000) if words else 0
        else:
            out[name] = round(words[j][1] * 1000)
    return out


def take_score(asr, av, n_words, wpm=0.0, max_wpm=0.0, min_wpm=0.0):
    allowed = max(1, round(n_words * 0.05))
    rushed = max_wpm > 0 and n_words >= 12 and wpm > max_wpm  # full explanations at a calm teaching pace
    dragging = min_wpm > 0 and wpm < min_wpm  # ... but not slower than a conversation
    bad = (max(0, asr["word_errors"] - allowed) * 3 + asr["odd_gaps"] * 3 + max(0, av["extra_pauses"] - 1) * 2 + max(0, av["resets"] - 2)
           + (max(0.0, wpm - max_wpm) / 5 if rushed else 0) + ((min_wpm - wpm) / 5 if dragging else 0))
    return bad, asr["word_errors"] <= allowed and asr["odd_gaps"] == 0 and av["extra_pauses"] <= 1 and not rushed and not dragging


def free_mb():
    """Available physical memory (MB), or None where it can't be read."""
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MS()
        m.dwLength = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return m.ullAvailPhys // 2 ** 20
    except Exception:
        return None


def load(path, empty):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else empty


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lines")
    ap.add_argument("--teacher", required=True, choices=sorted(TEACHERS))
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--tries", type=int, default=3)
    ap.add_argument("--only", help="comma-separated clip ids")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-wpm", type=float, default=0, help="prefer takes no faster than this (clips of 12+ words)")
    ap.add_argument("--seed-base", type=int, default=1000, help="change to get different takes on a re-render")
    ap.add_argument("--min-wpm", type=float, default=0, help="prefer takes no slower than this")
    ap.add_argument("--exact", action="store_true", help="only accept a take heard back word-for-word (for a word a voice keeps blurring)")
    ap.add_argument("--min-free-mb", type=int, default=1200, help="stop safely (progress saved) if free memory drops below this")
    a = ap.parse_args()
    t = TEACHERS[a.teacher]
    out_dir, manifest, qa_path = paths(a.teacher)
    lines = json.load(open(a.lines, encoding="utf-8"))
    if a.only:
        keep = set(a.only.split(","))
        lines = [l for l in lines if l["id"] in keep]
    man = load(manifest, {"voice": t["tag"], "lines": {}})
    qa = load(qa_path, {"voice": t["tag"], "lines": {}})
    old = man.get("lines", {})
    from chatterbox.tts import ChatterboxTTS
    model = ChatterboxTTS.from_pretrained(device="cpu")
    model.prepare_conditionals(os.path.join(HERE, t["ref"]), exaggeration=t["exaggeration"])
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.dirname(qa_path), exist_ok=True)
    t0 = time.time()
    for n, ln in enumerate(lines):
        name = ln["id"] + ".mp3"
        path = os.path.join(out_dir, name)
        prev = old.get(ln["id"])
        if not a.force and prev and prev.get("hash") == ln["hash"] and prev.get("voice") == t["tag"] and os.path.exists(path):
            continue
        free = free_mb()
        if free is not None and free < a.min_free_mb:
            # everything finished so far is already saved; stop before starting another clip
            print(f"LOW MEMORY: {free} MB free < {a.min_free_mb} MB; stopped safely before {ln['id']} ({len(old)} clips saved)", flush=True)
            return 3
        text = re.sub(r"\s{2,}", " ", ln["say"].replace("{p}", " ")).strip()
        best = None
        for attempt in range(a.tries):
            torch.manual_seed(a.seed_base + attempt * 7919 + n)
            wav = model.generate(text, exaggeration=t["exaggeration"], cfg_weight=t["cfg"], temperature=a.temperature)
            x = finish_audio(wav.squeeze(0).numpy(), model.sr)
            tmp = os.path.join(os.environ.get("TEMP", "."), f"cb_take_{a.teacher}_{ln['id']}_{attempt}.wav")
            sf.write(tmp, x, model.sr)
            asr = check(tmp, text)
            av = analyse(tmp, text)
            bad, ok = take_score(asr, av, len(text.split()), len(text.split()) / (len(x) / model.sr) * 60, a.max_wpm, a.min_wpm)
            if a.exact:
                bad, ok = bad + asr["word_errors"] * 3, ok and asr["word_errors"] == 0
            if best is None or bad < best[0]:
                best = (bad, x, asr, av, attempt)
            if ok:
                break
        bad, x, asr, av, attempt = best
        samples = encode_mp3(x, model.sr, path, t["kbps"])
        old[ln["id"]] = {
            "file": name, "ms": round(samples / model.sr * 1000), "hash": ln["hash"], "voice": t["tag"],
            "marks": cue_times(ln["marked"], asr["words"]),
            "sents": sentence_times(ln["text"], asr["words"]),
        }
        qa["lines"][ln["id"]] = {"word_errors": asr["word_errors"], "odd_gaps": asr["odd_gaps"], "extra_pauses": av["extra_pauses"], "resets": av["resets"],
                                 "takes": attempt + 1, "heard": asr["heard"], "asr": os.environ.get("ASR_MODEL", "base.en")}
        man = {"voice": t["tag"], "lines": dict(sorted(old.items()))}
        json.dump(man, open(manifest, "w", encoding="utf-8", newline="\n"), indent=1)
        json.dump({"voice": t["tag"], "lines": dict(sorted(qa["lines"].items()))}, open(qa_path, "w", encoding="utf-8", newline="\n"), indent=1)
        print(f"[{n + 1}/{len(lines)}] {ln['id']}: {samples / model.sr:.1f}s, takes {attempt + 1}, errors {asr['word_errors']}, gaps {asr['odd_gaps']}, extra {av['extra_pauses']} ({time.time() - t0:.0f}s)", flush=True)
    # drop audio for clips the script no longer has
    ids = {l["id"] for l in json.load(open(a.lines, encoding="utf-8"))}
    man["lines"] = {k: v for k, v in man["lines"].items() if k in ids}
    json.dump(man, open(manifest, "w", encoding="utf-8", newline="\n"), indent=1)
    keep = {v["file"] for v in man["lines"].values()}
    if not a.only:
        for f in os.listdir(out_dir):
            if f.endswith(".mp3") and f not in keep:
                os.remove(os.path.join(out_dir, f))
    print("done", len(man["lines"]), "clips")


if __name__ == "__main__":
    sys.exit(main())
