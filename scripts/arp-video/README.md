# ARP interactive video — narration tooling

Developer tooling for the narrated ARP video (`src/app/demo/arp-resolution/arp-video/`). Nothing here ships to the browser except the audio and manifests these scripts produce.

## What ships

| Path | What it is |
| --- | --- |
| `public/arp-video/narration/<teacher>/*.mp3` | Each teacher's 97 narration clips (`t1`, `t2`, `t3`) |
| `src/app/demo/arp-resolution/arp-video/voices/<teacher>.json` | Each clip's file, duration, text hash, cue times (`marks`) and caption-sentence times (`sents`) |

One screenplay (`screenplay.ts`), one state machine and one stage are shared by every teacher. `timeline.ts` builds a timeline per teacher from that teacher's manifest. A teacher can be selected only when every clip has an up-to-date recording (`teacherReady`).

## The teachers

All three are Chatterbox (Resemble AI, MIT; output carries Resemble's inaudible Perth watermark). Each takes its timbre from a short **synthetic** reference clip in `refs/`, made with Kokoro (Apache-2.0). No real person's voice is cloned. The presets live in `TEACHERS` in `narrate_cb.py`.

| Teacher | Style | Reference | Settings |
| --- | --- | --- | --- |
| `t1` | Calm and steady, US male | `refs/t1-am_echo.wav` | exaggeration 0.25, cfg 0.3 |
| `t2` | Warm and conversational, US female | `refs/t2-af_heart.wav` | exaggeration 0.35, cfg 0.35 |
| `t3` | Clear and measured, British female | `refs/t3-bf_emma.wav` | exaggeration 0.3, cfg 0.3 |

## Changing narration

The Python steps run in a separate virtual environment with `chatterbox-tts`, `openai-whisper`, `librosa`, `soundfile` and `lameenc`. They are heavy: run one at a time.

1. Edit the line in `screenplay.ts` (`text` is the caption; `say`, if present, is what the voice reads).
2. Export the lines:
   `node --import ./scripts/arp-video/register.mjs scripts/arp-video/export-lines.ts > lines.json`
3. Render each teacher. Only clips whose text changed are rendered. Every take is checked by speech recognition and audio analysis, cues and caption sentences are timed from the recognised words, and progress is saved after every clip:
   `ASR_MODEL=small.en <venv>/python scripts/arp-video/narrate_cb.py lines.json --teacher t2`
   Useful flags: `--only id,id`, `--force`, `--seed-base N` (different takes), `--exact` (only a word-for-word take), `--max-wpm` / `--min-wpm`, `--min-free-mb` (stops safely when memory runs low).
4. Re-check existing audio without re-rendering (rewrites the QA record and the caption times):
   `ASR_MODEL=small.en <venv>/python scripts/arp-video/recheck.py lines.json --teacher t1`
5. Decode every clip and record what is on disk (`qa/coverage.json`):
   `python scripts/arp-video/filecheck.py`
6. Audit everything (script, model truth, every teacher's track, playback engine at every speed, teacher switching, preferences):
   `node --import ./scripts/arp-video/register.mjs scripts/arp-video/audit.ts`

## Files

| File | Purpose |
| --- | --- |
| `export-lines.ts` | Writes every narrated clip (spoken text, caption text, hash) for the renderer |
| `narrate_cb.py` | Renders one teacher, checks every take, writes the audio, the manifest and `qa/<teacher>.json` |
| `recheck.py` | Re-checks rendered audio and updates the QA record and caption times |
| `filecheck.py` | Decodes every listed clip and writes `qa/coverage.json` |
| `asrcheck.py` | Speech-recognition check (Whisper): misheard words, gaps inside phrases, word timings |
| `voicecheck.py` | Audio analysis: pauses beyond punctuation, pitch spikes and resets, loudness, edges |
| `audit.ts` | The ARP video audit |
| `register.mjs`, `ts-hooks.mjs` | Let Node run the TypeScript scripts with the app's `@/` imports |
| `qa/` | QA records per teacher and the file coverage record (read by the audit) |
| `refs/` | The three synthetic reference clips |

Speech recognition formats things differently from the script ("Dot20", "OK", "recognizes", digits for spoken numbers). Read the heard text before re-rendering: only re-render real problems.
