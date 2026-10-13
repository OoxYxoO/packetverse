"""
Speech-recognition check of rendered narration (runs where openai-whisper is installed).

For each clip it transcribes the audio with word timestamps and reports:
  word_errors  words the recogniser heard differently from the script (garbled, swallowed or mispronounced speech;
               "arp"/"mac" and spoken numbers are normalised before comparing)
  odd_gaps     silences > 250 ms BETWEEN two words where the script has no punctuation — the "pause in the middle of a
               phrase" a listener notices
  words        the word timings themselves (used to place animation cues exactly on the spoken word)

  python asrcheck.py clip.wav "the script text"
"""
import os, re, sys
import numpy as np
import soundfile as sf

_model = None


def model():
    global _model
    if _model is None:
        import whisper
        _model = whisper.load_model(os.environ.get("ASR_MODEL", "base.en"), device="cpu")  # ASR_MODEL=small.en for a second opinion
    return _model


NUM = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "ten": "10", "twenty": "20", "thirty": "30"}


def words_of(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"\{p\}|\[\[[a-z0-9-]+\]\]", " ", s)
    s = s.replace("pc-b", "pcb").replace("pc-c", "pcc").replace("a.r.p", "arp").replace("a r p", "arp")
    # spoken addresses in the script ("one ninety-two dot ten") vs digits from the recogniser ("192.10", ".20")
    s = s.replace("one ninety-two", "192").replace("one sixty-eight", "168")
    s = re.sub(r"\bdot\b", " ", s)
    out = []
    for w in re.findall(r"[a-z0-9']+", s):
        w = NUM.get(w, w)
        w = w.replace("'", "")  # its/it's, heads/head's, pc-b's/pcbs sound the same; only spelling differs
        out.append({"arp": "arp", "harp": "arp", "mack": "mac", "mak": "mac"}.get(w, w))
    return out


SAME_SOUND = {"cash": "cache"}


def unglue(heard, vocab):
    """The recogniser sometimes writes two spoken words as one ("arpcash", "pcbsmac"): split a heard word that isn't in
    the script into two script words, and map same-sounding spellings back to the script's word."""
    out = []
    for w in heard:
        w = SAME_SOUND.get(w, w)
        if w not in vocab:
            split = next(([a, SAME_SOUND.get(b, b)] for i in range(1, len(w)) for a, b in [(w[:i], w[i:])] if a in vocab and SAME_SOUND.get(b, b) in vocab), None)
            if split:
                out += split
                continue
        out.append(w)
    return out


def load16(path):
    a, sr = sf.read(path)
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != 16000:
        import librosa
        a = librosa.resample(a.astype(np.float32), orig_sr=sr, target_sr=16000)
    return a.astype(np.float32)


def edit_distance(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return d[len(b)]


def check(path, text):
    r = model().transcribe(load16(path), language="en", word_timestamps=True, fp16=False, condition_on_previous_text=False)
    ws = [w for seg in r["segments"] for w in seg.get("words", [])]
    want = words_of(text)
    heard = unglue(words_of(" ".join(w["word"] for w in ws)), set(want))
    errors = edit_distance(want, heard)
    # gaps between consecutive words that the script doesn't punctuate
    odd = []
    for w1, w2 in zip(ws, ws[1:]):
        gap = w2["start"] - w1["end"]
        if gap > 0.25 and not re.search(r"[.,!?;:—–-]$", w1["word"].strip()):
            odd.append((w1["word"].strip(), w2["word"].strip(), round(gap, 2)))
    return {"word_errors": errors, "odd_gaps": len(odd), "gaps": odd, "heard": r["text"].strip(), "words": [(w["word"].strip(), round(w["start"], 2), round(w["end"], 2)) for w in ws]}


if __name__ == "__main__":
    print(check(sys.argv[1], sys.argv[2]))
