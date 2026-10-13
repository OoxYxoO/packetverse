/**
 * ARP interactive video — audit + state-machine tests.
 *   node --import ./scripts/arp-video/register.mjs scripts/arp-video/audit.ts
 *
 * 1. Truth: what the video shows and says agrees with the ARP Lab model (arpNet).
 * 2. Script integrity: every card/flow points at real model data, every [[cue]] is wired, narration is fresh.
 * 3. No spoilers: a question's frozen picture doesn't already show its answer.
 * 4. Readability: the phone camera never zooms out so far that devices become specks.
 * 5. Isolation: no lesson-progress access.
 * 6. The state machine: questions can't be skipped, input can't break it, rewind/restart behave.
 * 7. Teachers: every teacher's track is complete, one voice, fresh, heard back cleanly, calmly paced, with cues and
 *    captions measured inside its own audio; the whole lesson plays through on each teacher's timeline.
 * 8. The engine (driven with a stand-in audio clock): voice and picture stay locked at every speed and teacher,
 *    questions wait, feedback keeps the speed, teacher changes never cut a word and never lose the place.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { BCAST, HOSTS, R1_IFS, ZERO_MAC } from "@/lib/sim-engine/scenarios/arpNet";
import { LINES, PLANS, QUESTIONS, requestVerdicts, waveFrame, type Card, type Shot } from "@/app/demo/arp-resolution/arp-video/screenplay";
import { SPEEDS, VideoEngine } from "@/app/demo/arp-resolution/arp-video/engine";
import { DEFAULT_TEACHER, TEACHERS, audioUrl, type TeacherId } from "@/app/demo/arp-resolution/arp-video/teachers";
import { FEEDBACK, MAIN, PROMPT, allClips, captionAt, clipAt, clipsOf, cleanText, teacherReady, cueFractions, endShot, markedSpeech, sentencesOf, shotAt, textHash, timelineFor, type Clip } from "@/app/demo/arp-resolution/arp-video/timeline";
import { initialVideo, videoReducer, type TrackInfo, type VideoAction, type VideoState } from "@/app/demo/arp-resolution/arp-video/videoMachine";
import { camRect, fitCamera, safeArea, type Layout } from "@/app/demo/arp-resolution/arp-video/world";

let pass = 0;
const fails: string[] = [];
const ok = (cond: unknown, name: string) => {
  if (cond) pass++;
  else fails.push(name);
};

// ---------------------------------------------------------------------------------------------------------------
// 1. Truth
// ---------------------------------------------------------------------------------------------------------------
const L = PLANS.local;
const Rm = PLANS.remote;
const lap = HOSTS.laptop;
const pcb = HOSTS.pcb;
const srv = HOSTS.server;
ok(L.waves.length === 8 && Rm.waves.length === 12, "plans: local 8 waves, remote 12");
ok(PLANS.again.waves.every((w) => w.copies.every((c) => c.frame.type === "IPv4")), "second ping: no ARP at all");
ok(Object.values(PLANS.start.snaps[0].caches).every((c) => !c.length), "start: every cache empty");
const ping = waveFrame("local", 4);
ok(ping.ethDst === pcb.mac && ping.ip?.dst === pcb.cfg.ip && ping.ethSrc === lap.mac, "missing: the ping's destination MAC is PC-B's");
const req = waveFrame("local", 0);
ok(req.ethDst === BCAST && req.arp?.tip === pcb.cfg.ip && req.arp.sip === lap.cfg.ip && req.arp.tmac === ZERO_MAC, "bcast: request is broadcast, who has .20, tell .10, target MAC zeros");
ok(L.waves[1].copies.map((c) => c.to).sort().join() === "pcb,pcc,r1", "flood: copies to PC-B, PC-C and R1, not back to the Laptop");
ok(L.snaps[1].swMac[lap.mac]?.port === "fa1", "switch learned the Laptop on port 1 (shown at n14)");
const v = requestVerdicts("local", 1);
ok(v.find((m) => m.at === "pcb")?.tone === "ok" && v.filter((m) => m.tone === "no").length === 2, "owner: only PC-B answers");
ok(L.snaps[2].caches.pcb.some((e) => e.ip === lap.cfg.ip && e.mac === lap.mac), "PC-B learned the Laptop from the request (n17 memory card)");
ok(waveFrame("local", 2).ethDst === lap.mac && L.waves[3].copies.length === 1, "unicast: reply to the Laptop's MAC, forwarded out one port");
ok(L.snaps[3].swMac[pcb.mac]?.port === "fa3", "switch learned PC-B on port 3 (n20)");
ok(L.snaps[4].caches.laptop.some((e) => e.ip === pcb.cfg.ip && e.mac === pcb.mac), "remember: Laptop cache .20 → PC-B MAC (n21)");
ok(L.waves[5].copies.length === 1 && L.waves[5].copies[0].to === "pcb", "forward: ping out port 3 only");
ok(!L.snaps[8].captures.some((c) => c.dev === "pcb" && c.dir === "out" && c.frame.arp?.op === "request"), "PC-B never ARPs (n26)");
ok(waveFrame("remote", 0).arp?.tip === R1_IFS.gi0.ip && !Rm.waves[1].copies.some((c) => c.to === "server"), "gateway: ARP for .1, the broadcast never reaches the Server");
const rp = waveFrame("remote", 4);
ok(rp.ethDst === R1_IFS.gi0.mac && rp.ip?.dst === srv.cfg.ip, "two-dest: MAC → router, IP → Server");
const rb = waveFrame("remote", 8);
ok(rb.ethSrc === R1_IFS.gi1.mac && rb.ethDst === srv.mac && rb.ip?.src === lap.cfg.ip && rb.ip?.ttl === rp.ip!.ttl - 1, "rebuild: new MACs, same IPs, TTL − 1");
ok(Rm.snaps[8].caches.r1.some((e) => e.ip === srv.cfg.ip), "router learned the Server by its own ARP (r8 memory card)");

// ---------------------------------------------------------------------------------------------------------------
// 2. Script integrity
// ---------------------------------------------------------------------------------------------------------------
const clips = allClips();
const shotsOf = (c: Clip): Shot[] => [c.startShot, ...Object.values(c.cueMs).map((at) => shotAt(c, at))];
const cardOk = (k: Card) => {
  if (k.k === "frame") return k.wave >= 0 && k.wave < PLANS[k.plan].waves.length;
  if (k.k === "memory" || k.k === "swmem") return k.snap >= 0 && k.snap < PLANS[k.plan].snaps.length;
  return true;
};
for (const c of clips) {
  for (const s of shotsOf(c)) {
    ok(s.cards.every(cardOk), `${c.id}: cards point at real model data`);
    if (s.flow) ok(s.flow.waves.every((w) => w >= 0 && w < PLANS[s.flow!.plan].waves.length), `${c.id}: flow waves exist`);
  }
  const marks = Object.keys(cueFractions(c.line));
  const cues = Object.keys(c.line.cues ?? {});
  ok(marks.every((m) => cues.includes(m)) && cues.every((k) => marks.includes(k)), `${c.id}: [[cue]] markers and cue patches match (${marks.join(",")} / ${cues.join(",")})`);
  if (c.line.say) ok(Object.keys(cueFractions({ text: c.line.text })).join() === marks.join(), `${c.id}: caption and spoken text carry the same cues`);
  ok(cleanText(c.line.text).length > 3 && !/\[\[|\]\]/.test(cleanText(c.line.text)), `${c.id}: caption text clean`);
  ok(cleanText(c.line.text).split(/\s+/).length <= 48, `${c.id}: caption short enough`);
}
ok(new Set(clips.map((c) => c.id)).size === clips.length, "clip ids unique");
for (const q of QUESTIONS) {
  ok(q.options.some((o) => o.id === q.answer), `${q.id}: the answer is an option`);
  ok(q.options.every((o) => o.lines.length >= 1), `${q.id}: every option has narrated feedback`);
  ok(new Set(q.options.map((o) => o.id)).size === q.options.length, `${q.id}: option ids unique`);
  ok(PROMPT[q.id] && FEEDBACK[q.id], `${q.id}: prompt and feedback clips built`);
}
ok(QUESTIONS.length >= 8 && QUESTIONS.length <= 12, "8–12 questions: present but not dominating");
ok(LINES[0].shot?.skin === "office" && LINES.some((l) => l.cues && Object.values(l.cues).some((p) => p.skin === "net")), "starts with the office analogy, then turns into the network");
const known = new Set([BCAST, ZERO_MAC, ...Object.values(HOSTS).flatMap((h) => [h.mac, h.cfg.ip]), R1_IFS.gi0.ip, R1_IFS.gi0.mac, R1_IFS.gi1.ip, R1_IFS.gi1.mac, "192.168.10.0", "10.20.20.0"]);
const texts = [...clips.map((c) => c.line.text), ...QUESTIONS.flatMap((q) => [q.prompt, ...q.options.map((o) => o.label)])];
for (const t of texts) {
  for (const m of t.match(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/g) ?? []) ok(known.has(m), `known MAC: ${m}`);
  for (const ip of t.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) ok(known.has(ip), `known IP: ${ip}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 2b. Teaching voice: pacing, sentence length, talking to the learner, no over-used phrases
// ---------------------------------------------------------------------------------------------------------------
{
  const words = (s: string) => cleanText(s).split(/\s+/).filter(Boolean).length;
  for (const c of clips) {
    const longest = Math.max(...cleanText(c.line.say ?? c.line.text).split(/(?<=[.!?])\s+/).map(words));
    ok(longest <= 24, `${c.id}: no run-on sentence (longest ${longest} words)`);
  }
  const spoken = clips.map((c) => cleanText(c.line.say ?? c.line.text)).join(" ");
  const count = (re: RegExp) => (spoken.match(re) ?? []).length;
  ok(count(/\byou\b|\byour\b|\byou're\b|\byou'd\b|\byou'll\b/gi) >= 40, "the narrator talks to the learner (you/your)");
  ok(count(/\?/g) >= 25, "the narrator asks, not only tells (question marks in narration)");
  for (const [re, max, name] of [
    [/\bimagine\b/gi, 3, "imagine"],
    [/\blet's\b/gi, 6, "let's"],
    [/\bremember\b/gi, 7, "remember"],
    [/\bexactly\b/gi, 4, "exactly"],
    [/\bperfect\b/gi, 2, "perfect"],
    [/\bnotice\b/gi, 3, "notice"],
    [/\bwatch\b/gi, 4, "watch"],
  ] as [RegExp, number, string][])
    ok(count(re) <= max, `phrase "${name}" not over-used (${count(re)} ≤ ${max})`);
  // correct-answer feedback doesn't open with the same word every time
  const openers = QUESTIONS.map((q) => cleanText(FEEDBACK[q.id][q.answer][0].line.text).split(/[\s,.!:]/)[0].toLowerCase());
  // calm and human beats clever: "Right." / "Exactly." may repeat, but no single opener dominates
  const most = Math.max(...openers.map((o) => openers.filter((x) => x === o).length));
  ok(new Set(openers).size >= 5 && most <= 3, `correct-answer reactions vary without forcing it (${openers.join(", ")})`);
  // no exclamation marks in anything the narrator says (engines over-act them)
  ok(!clips.some((c) => /!/.test(c.line.say ?? c.line.text)), "no exclamation marks in narration");
}

// ---------------------------------------------------------------------------------------------------------------
// 3. No spoilers at a question
// ---------------------------------------------------------------------------------------------------------------
const qShot = (id: string) => endShot(MAIN.find((c) => c.line.question?.id === id)!);
const frameCard = (s: Shot) => s.cards.find((c) => c.k === "frame") as Extract<Card, { k: "frame" }> | undefined;
ok(frameCard(qShot("missing"))?.mask === true, "no spoiler: missing — destination MAC masked");
ok(frameCard(qShot("bcast"))?.mask === true, "no spoiler: bcast — destination MAC masked");
for (const id of ["flood", "forward"]) {
  const f = qShot(id).flow;
  ok(f?.hold && f.waves.every((w) => PLANS[f.plan].waves[w].copies.every((c) => c.to === "sw1")), `no spoiler: ${id} — the frame waits at the switch`);
}
ok(qShot("owner").marks.every((m) => m.tone === "ask"), "no spoiler: owner — receivers only show '?'");
ok(!qShot("unicast").flow && !qShot("unicast").cards.some((c) => c.k === "bvu"), "no spoiler: unicast — reply not shown yet");
ok(!qShot("remember").cards.some((c) => c.k === "memory" && c.owner === "laptop"), "no spoiler: remember — Laptop's memory not shown");
ok(!qShot("gateway").arrows.length && !qShot("gateway").marks.some((m) => m.at === "r1" && m.tone === "ok"), "no spoiler: gateway");
ok(!qShot("two-dest").cards.some((c) => c.k === "compare" || (c.k === "frame" && c.plan === "remote" && c.wave === 4)) && !qShot("two-dest").arrows.length, "no spoiler: two-dest");

// ---------------------------------------------------------------------------------------------------------------
// 4. Readability (phone 390×640 stage, laptop 1280×620)
// ---------------------------------------------------------------------------------------------------------------
const stage: Record<Layout, [number, number]> = { tall: [390, 640], wide: [1280, 620] };
for (const l of ["tall", "wide"] as Layout[]) {
  let minPpu = Infinity;
  let worst = "";
  for (const c of MAIN)
    for (const s of shotsOf(c)) {
      const [W, H] = stage[l];
      const safe = safeArea(l, { cards: s.cards.length > 0, asking: false });
      const vb = fitCamera(camRect(s.cam, l), W, H, safe);
      if (W / vb.w < minPpu) {
        minPpu = W / vb.w;
        worst = `${c.id}/${s.cam}`;
      }
    }
  ok(minPpu * 180 >= 38, `${l}: devices stay at least 38 px wide in every shot (min ${(minPpu * 180).toFixed(0)} px at ${worst})`);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Isolation
// ---------------------------------------------------------------------------------------------------------------
for (const f of readdirSync("src/app/demo/arp-resolution/arp-video")) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  ok(!/useProgressStore|completeLesson|progressStore/.test(readFileSync(`src/app/demo/arp-resolution/arp-video/${f}`, "utf8")), `${f}: no progress-store access`);
}

// ---------------------------------------------------------------------------------------------------------------
// 6. The state machine
// ---------------------------------------------------------------------------------------------------------------
const INFO: TrackInfo = {
  main: MAIN.map((c) => ({ ms: c.ms, q: c.line.question && { id: c.line.question.id, answer: c.line.question.answer } })),
  ask: Object.fromEntries(Object.entries(PROMPT).map(([k, c]) => [k, c.ms])),
  fb: Object.fromEntries(Object.entries(FEEDBACK).map(([q, o]) => [q, Object.fromEntries(Object.entries(o).map(([k, cs]) => [k, cs.map((c) => c.ms)]))])),
};
const run = (s: VideoState, ...as: VideoAction[]) => as.reduce((x, a) => videoReducer(INFO, x, a), s);
const until = (s: VideoState, stop: (s: VideoState) => boolean, max = 40000) => {
  let n = 0;
  while (!stop(s) && n++ < max) s = run(s, { type: "tick", dt: 250 });
  return s;
};
const qid = (s: VideoState) => (s.pos.track === "ask" ? s.pos.q : "");
const answerOf = (id: string) => QUESTIONS.find((q) => q.id === id)!.answer;

{
  let s = run(initialVideo(), { type: "play" });
  const asked: string[] = [];
  for (let g = 0; g < 400 && s.mode !== "ended"; g++) {
    s = until(s, (x) => x.mode === "waiting" || x.mode === "ended");
    if (s.mode === "waiting") {
      asked.push(qid(s));
      s = run(s, { type: "answer", option: answerOf(qid(s)) });
    }
  }
  ok(s.mode === "ended" && s.finished, "a full watch reaches the end");
  ok(asked.join() === QUESTIONS.map((q) => q.id).join(), "every question asked once, in order");
  const r = run(s, { type: "restart" });
  ok(r.mode === "playing" && !Object.keys(r.answers).length && r.previous && r.finished && r.run === 2, "restart: fresh questions, previous answers kept, chapters stay open");
  ok(run(r, { type: "seek", line: MAIN.length - 3 }).pos.track === "main", "after finishing: any chapter can be jumped to");
}
{
  let s = run(initialVideo(), { type: "play" });
  for (let k = 0; k < 6000; k++) s = run(s, { type: "tick", dt: 99999 });
  ok(s.mode === "waiting" && qid(s) === QUESTIONS[0].id, "huge ticks stop at the first question");
  ok(run(s, { type: "next" }) === s && run(s, { type: "toggle" }) === s && run(s, { type: "seek", line: 30 }) === s, "Next, Play and seeking forward can't leave an open question");
  const a = run(s, { type: "answer", option: "near" });
  ok(a.pos.track === "fb" && !a.answers.room.correct, "a wrong answer plays its own explanation");
  ok(run(a, { type: "answer", option: "sam" }) === a, "a second answer during the explanation is ignored");
  const replay = run(run(a, { type: "tick", dt: 200 }), { type: "prev" });
  ok(replay.pos.track === "fb" && replay.t === 0, "Replay restarts the explanation");
  const after = until(a, (x) => x.pos.track === "main");
  ok(after.pos.track === "main" && after.mode === "playing", "after the explanation, the story continues (no punishment)");
}
{
  let s = until(run(initialVideo(), { type: "play" }), (x) => x.mode === "waiting");
  const qLine = MAIN.findIndex((c) => c.line.question?.id === qid(s));
  ok(run(s, { type: "seek", line: MAIN.length - 1 }) === s, "first viewing: can't jump to the end");
  s = until(run(s, { type: "answer", option: answerOf(qid(s)) }), (x) => x.pos.track === "main");
  s = run(s, { type: "seek", line: 0 });
  s = until(s, (x) => (x.pos.track === "main" && x.pos.i > qLine) || x.mode !== "playing");
  ok(s.pos.track === "main" && s.mode === "playing", "rewatching does not ask an answered question again");
  const p = run(s, { type: "pause" });
  ok(run(p, { type: "tick", dt: 5000 }) === p, "no time passes while paused");
  const big = run(run(p, { type: "play" }), { type: "tick", dt: 60000 });
  ok(big.t <= p.t + 250, "a long frame advances at most 250 ms");
  ok(Math.abs(run(run(initialVideo(), { type: "play" }), { type: "speed", speed: 1.5 }, { type: "tick", dt: 200 }).t - 300) < 1e-9, "speed scales time");
  ok(run(initialVideo(), { type: "tick", dt: 500 }).t === 0, "nothing moves before Play");
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Teachers: three narration tracks for the one screenplay
// ---------------------------------------------------------------------------------------------------------------
const wordsIn = (s: string) => cleanText(s).split(/\s+/).filter(Boolean).length;
// reviewed exceptions: lines a teacher reads a little brisker on every take (several seeds tried); time-stretching
// would cost more naturalness than the extra few wpm
// (t2/r3: of 8 takes, the only one that keeps "You'd take it" instead of swallowing the 'd)
const PACE_OK: Record<string, Record<string, number>> = { t1: { o11: 195 }, t2: { r3: 200 } };
ok(new Set(TEACHERS.map((t) => t.manifest.voice)).size === TEACHERS.length, "every teacher has its own voice");
// file coverage: what is really on disk (scripts/arp-video/filecheck.py decodes every listed clip)
const coverage = (existsSync("scripts/arp-video/qa/coverage.json") ? JSON.parse(readFileSync("scripts/arp-video/qa/coverage.json", "utf8")) : {}) as Record<string, Record<string, { file: string; bytes: number; decodedMs: number; error?: string }>>;
ok(teacherReady(DEFAULT_TEACHER), "the default teacher is complete");
for (const T of TEACHERS) {
  const need = clipsOf(timelineFor(T.id));
  const have = need.filter((c) => c.audio).length;
  ok(have === need.length, `${T.name}: ${have} / ${need.length} clips recorded`);
  ok(teacherReady(T.id) === (have === need.length), `${T.name}: selectable exactly when complete`);
  if (!teacherReady(T.id)) continue;
  // a selectable teacher must have every file present, non-empty, decodable and as long as recorded
  for (const c of need) {
    const e = T.manifest.lines[c.id];
    const path = `public/arp-video/narration/${T.id}/${e.file}`;
    const cov = coverage[T.id]?.[c.id];
    const bytes = existsSync(path) ? statSync(path).size : 0;
    ok(bytes > 0 && cov && cov.bytes === bytes && !cov.error && Math.abs(cov.decodedMs - e.ms) <= 150, `${T.id}/${c.id}: file present, non-empty, decodes to its recorded length`);
  }
}
for (const T of TEACHERS) {
  const tl = timelineFor(T.id);
  const cs = clipsOf(tl);
  const man = T.manifest.lines;
  const qa = existsSync(`scripts/arp-video/qa/${T.id}.json`) ? (JSON.parse(readFileSync(`scripts/arp-video/qa/${T.id}.json`, "utf8")) as { lines: Record<string, { word_errors: number; odd_gaps: number; extra_pauses: number }> }).lines : {};
  ok(Object.keys(man).length === cs.length, `${T.id}: manifest has exactly the clips the script needs (${Object.keys(man).length}/${cs.length})`);
  const dir = `public/arp-video/narration/${T.id}`;
  ok(existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith(".mp3")).length === cs.length, `${T.id}: no missing or stray audio files`);
  ok(Object.values(man).every((e) => e.voice === T.manifest.voice), `${T.id}: one voice for every clip (no other teacher's take)`);
  for (const c of cs) {
    const n = man[c.id];
    ok(n && n.hash === textHash(markedSpeech(c.line)) && existsSync(`${dir}/${n.file}`) && n.ms > 300 && c.audio === audioUrl(T.id, n.file), `${T.id}/${c.id}: narration rendered and up to date`);
    // cues: inside the voice, in the order the script places them
    const order = Object.entries(cueFractions(c.line)).sort((x, y) => x[1] - y[1]).map(([k]) => c.cueMs[k]);
    ok(order.every((at, i) => at >= 0 && at <= c.voiceMs && (i === 0 || at >= order[i - 1])), `${T.id}/${c.id}: cues land inside the voice, in script order`);
    for (const [k, at] of Object.entries(c.cueMs)) {
      const f = c.line.cues?.[k]?.flow;
      if (f && !f.hold) ok(at + f.waves.length * (f.ms ?? 1300) <= c.ms + 200, `${T.id}/${c.id}: the [[${k}]] animation finishes inside its clip`);
    }
    const f0 = c.line.shot?.flow;
    if (f0 && !f0.hold) ok(f0.waves.length * (f0.ms ?? 1300) <= c.ms + 200, `${T.id}/${c.id}: its animation finishes inside the clip`);
    // captions: measured sentence starts, in order, inside the voice; shown in order; cleared after the voice
    const parts = sentencesOf(c.line.text);
    ok(parts.length <= 1 || (c.sentMs && c.sentMs.every((at, i) => at >= 0 && at <= c.voiceMs && (i === 0 || at >= c.sentMs![i - 1]))), `${T.id}/${c.id}: caption sentences timed in this voice`);
    let last = -1;
    let inOrder = true;
    for (let t = 0; t <= c.voiceMs; t += 40) {
      const cap = captionAt(c, t);
      const at = cleanText(c.line.text).indexOf(cap);
      if (!cap || at < last) inOrder = false;
      last = at;
    }
    ok(inOrder && captionAt(c, c.voiceMs + 500) === "", `${T.id}/${c.id}: captions follow the voice in order, then clear`);
    // pacing, and the take as heard back by speech recognition
    const nw = wordsIn(c.line.say ?? c.line.text);
    const rate = (nw / Math.max(1, c.voiceMs)) * 60000;
    // Pace is measured over the whole clip, which includes ~0.3 s of built-in silence (lead-in and tail). On a short
    // line (< 12 words) that silence alone lowers the figure by ~10%, so short lines get a lower floor (95 wpm) —
    // a measurement correction for every teacher, not an exception for one. Short lines may also run quicker (270).
    ok(rate >= (nw < 12 ? 95 : 110) && rate <= (nw < 12 ? 270 : (PACE_OK[T.id]?.[c.id] ?? 190)), `${T.id}/${c.id}: speaking rate conversational (${Math.round(rate)} wpm, ${nw} words)`);
    const k = qa[c.id];
    const allowed = Math.max(1, Math.round(nw * 0.05));
    ok(k && k.word_errors <= allowed && k.odd_gaps === 0, `${T.id}/${c.id}: take heard back cleanly (${k?.word_errors} word diff, ${k?.odd_gaps} odd gaps)`);
  }
  // the whole lesson on this teacher's timeline: right answers, then wrong ones
  for (const pick of ["right", "wrong"] as const) {
    const rn = (x: VideoState, a: VideoAction) => videoReducer(tl.INFO, x, a);
    let st = rn(initialVideo(), { type: "play" });
    const asked: string[] = [];
    for (let g = 0; g < 100000 && st.mode !== "ended"; g++) {
      if (st.mode === "waiting" && st.pos.track === "ask") {
        const q = QUESTIONS.find((x) => x.id === (st.pos as { q: string }).q)!;
        asked.push(q.id);
        st = rn(st, { type: "answer", option: pick === "right" ? q.answer : q.options.find((o) => o.id !== q.answer)!.id });
      } else st = rn(st, { type: "tick", dt: 250 });
    }
    ok(st.mode === "ended" && asked.length === QUESTIONS.length, `${T.id}: the whole lesson plays through with ${pick} answers`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 8. The engine, driven with a stand-in audio clock (what the browser's <audio> would do)
// ---------------------------------------------------------------------------------------------------------------
const VOICE_MS = new Map<string, number>();
for (const T of TEACHERS) for (const c of clipsOf(timelineFor(T.id))) if (c.audio) VOICE_MS.set(c.audio, c.voiceMs);
class FakeAudio {
  _src = "";
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 4;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  preload = "";
  srcs: string[] = [];
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.currentTime = 0;
    this.ended = false;
    this.playbackRate = this.defaultPlaybackRate;
    this.srcs.push(v);
  }
  /** play() on an ended element restarts it from the top in a real browser: count it, it must never happen. */
  restarts = 0;
  play() {
    if (this.ended) this.restarts++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener() {}
  getAttribute() {
    return this._src || null;
  }
  removeAttribute() {
    this._src = "";
  }
}
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  Audio: FakeAudio,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
type Sim = { e: VideoEngine; a: () => FakeAudio; now: number; drift: number; rateOk: boolean };
const sim = (): Sim => ({ e: new VideoEngine(), a() {
  return (this.e as unknown as { audio: FakeAudio }).audio;
}, now: 1e6, drift: 0, rateOk: true });
/** Advance n frames of 50 ms wall time: the audio plays at its rate, the engine follows it. */
const frames = (S: Sim, n: number) => {
  for (let k = 0; k < n; k++) {
    const v = S.e.get().v;
    if (v.mode !== "playing") return;
    const a = S.a();
    if (a && !a.paused && !a.ended) {
      a.currentTime += 0.05 * a.playbackRate;
      const d = (VOICE_MS.get(a.src) ?? 0) / 1000;
      if (a.currentTime >= d) {
        a.currentTime = d;
        a.ended = true;
        a.paused = true;
      }
    }
    S.now += 50;
    S.e.frame(50, S.now);
    const w = S.e.get().v;
    if (a && w.mode === "playing" && !a.paused && !a.ended) {
      S.drift = Math.max(S.drift, Math.abs(a.currentTime * 1000 - w.t));
      if (a.playbackRate !== w.speed) S.rateOk = false;
    }
  }
};
const clipNow = (S: Sim) => clipAt(S.e.tl, S.e.get().v.pos);
const toWaitingOrEnd = (S: Sim) => {
  for (let g = 0; g < 200000; g++) {
    const v = S.e.get().v;
    if (v.mode !== "playing") return;
    frames(S, 1);
  }
};

// an incomplete teacher can't be chosen (no silence, no stand-in voice), not even as a remembered preference
for (const T of TEACHERS.filter((t) => !teacherReady(t.id))) {
  const S = sim();
  S.e.setTeacher(T.id);
  ok(S.e.get().teacher === DEFAULT_TEACHER && !S.e.get().pending, `${T.name} (incomplete) can't be selected`);
  store.set("packetverse.videoPrefs.v1", JSON.stringify({ teacher: T.id }));
  const S2 = sim();
  S2.e.applyPrefs();
  ok(S2.e.get().teacher === DEFAULT_TEACHER, `${T.name} (incomplete) isn't restored from a saved preference`);
  store.clear();
}

// every selectable teacher × every speed: a full watch, wrong answers first time (all explanations), voice locked
for (const T of TEACHERS.filter((t) => teacherReady(t.id)))
  for (const sp of SPEEDS) {
    const S = sim();
    S.e.setTeacher(T.id, false);
    S.e.setSpeed(sp, false);
    S.e.dispatch({ type: "play" });
    let waitsHeld = true;
    let fbRate = true;
    for (let g = 0; g < 200 && S.e.get().v.mode !== "ended"; g++) {
      toWaitingOrEnd(S);
      const v = S.e.get().v;
      if (v.mode === "waiting" && v.pos.track === "ask") {
        const before = S.e.get().v;
        S.now += 60000;
        S.e.frame(50, S.now);
        if (S.e.get().v !== before) waitsHeld = false;
        const q = QUESTIONS.find((x) => x.id === (v.pos as { q: string }).q)!;
        S.e.dispatch({ type: "answer", option: q.options.find((o) => o.id !== q.answer)!.id });
        frames(S, 3);
        if (S.e.get().v.pos.track === "fb" && S.a() && S.a().playbackRate !== sp) fbRate = false;
      }
    }
    const fa = S.a();
    const own = !fa || fa.srcs.every((u) => u.startsWith(`/arp-video/narration/${T.id}/`));
    ok(S.e.get().v.mode === "ended", `${T.id} @ ${sp}×: the whole lesson plays to the end`);
    ok(S.drift <= 1, `${T.id} @ ${sp}×: voice and picture stay locked (max drift ${Math.round(S.drift)} ms)`);
    ok(S.rateOk && S.e.get().v.speed === sp, `${T.id} @ ${sp}×: the voice always plays at the chosen speed`);
    ok(waitsHeld, `${T.id} @ ${sp}×: questions wait for the learner (a minute passes, nothing moves)`);
    ok(fbRate, `${T.id} @ ${sp}×: wrong-answer explanations keep the speed`);
    ok(own, `${T.id} @ ${sp}×: only this teacher's clips are loaded`);
    ok(!fa || fa.preservesPitch, `${T.id} @ ${sp}×: pitch preserved at other speeds`);
  }

// regression: the audio ends a little BEFORE its recorded length (a file decoding shorter than the manifest says) —
// the story clock must carry on past the voice, and the finished clip must never be played again
for (const T of TEACHERS.filter((t) => teacherReady(t.id))) {
  const saved = new Map(VOICE_MS);
  for (const [u, ms] of saved) VOICE_MS.set(u, ms - 45);
  const S = sim();
  S.e.setTeacher(T.id, false);
  S.e.dispatch({ type: "play" });
  toWaitingOrEnd(S);
  const reached = S.e.get().v;
  ok(reached.mode === "waiting" && reached.pos.track === "ask", `${T.id}: audio ending early doesn't stall the story (reached the first question)`);
  ok(S.a().restarts === 0, `${T.id}: a finished clip is never restarted`);
  for (const [u, ms] of saved) VOICE_MS.set(u, ms);
}

/** Play on (answering any question) until a voiced line is mid-sentence: at least minT ms in, 400 ms before its end. */
const speaking = (S: Sim, minT: number) => {
  for (let g = 0; g < 50000; g++) {
    const v = S.e.get().v;
    const c = clipNow(S);
    if (v.mode === "playing" && c.audio && v.t > minT && v.t < c.voiceMs - 400) return true;
    if (v.mode === "ended") return false;
    if (v.mode === "waiting") S.e.dispatch({ type: "answer", option: QUESTIONS.find((x) => x.id === (v.pos as { q: string }).q)!.answer });
    else if (v.mode !== "playing") S.e.dispatch({ type: "play" });
    frames(S, 1);
  }
  return false;
};
// changing teacher in every kind of moment: never mid-word, never losing the place (needs all three teachers)
ok(TEACHERS.every((t) => teacherReady(t.id)), "all three teachers complete, so switching between them can be tested");
if (TEACHERS.every((t) => teacherReady(t.id))) {
  // every direction while playing: 2→3, 3→1, 1→3, 3→2, 2→1, 1→2
  const ring: TeacherId[] = ["t2", "t3", "t1", "t3", "t2", "t1", "t2"];
  const same = (x: VideoState, y: VideoState) => JSON.stringify([x.pos, x.answers, x.reached, x.run, x.speed, x.finished]) === JSON.stringify([y.pos, y.answers, y.reached, y.run, y.speed, y.finished]);
  const S = sim();
  // before starting
  S.e.setTeacher("t2");
  ok(S.e.get().teacher === "t2" && S.e.get().v.mode === "idle", "switch before starting: immediate");
  S.e.setSpeed(1.5);
  S.e.dispatch({ type: "play" });
  frames(S, 30);
  // during narration: finish the sentence first
  for (let k = 0; k + 1 < ring.length; k++) {
    const from = ring[k];
    const to = ring[k + 1];
    // keep well away from the end of the lesson (rewinding keeps the answers)
    const at = S.e.get().v;
    if (at.pos.track === "main" && at.pos.i > 40) S.e.dispatch({ type: "seek", line: 1 });
    if (!speaking(S, 400)) {
      ok(false, `${from} → ${to}: found a line being spoken to switch in`);
      break;
    }
    const b = S.e.get().v;
    const srcBefore = S.a().src;
    S.e.setTeacher(to);
    ok(S.e.get().pending === to && S.e.get().teacher === from && S.a().src === srcBefore, `${from} → ${to} mid-sentence: the sentence finishes in ${from}'s voice`);
    const key = JSON.stringify(b.pos);
    for (let g = 0; g < 20000 && JSON.stringify(S.e.get().v.pos) === key && S.e.get().v.mode === "playing"; g++) frames(S, 1);
    if (S.e.get().v.mode === "waiting") frames(S, 1);
    ok(S.e.get().teacher === to && !S.e.get().pending, `${from} → ${to}: takes over at the next line`);
    ok(S.e.get().v.speed === 1.5, `${from} → ${to}: the speed is kept`);
    frames(S, 4);
    ok(!clipNow(S).audio || S.a().src.startsWith(`/arp-video/narration/${to}/`), `${from} → ${to}: the next line is in ${to}'s voice`);
  }
  // while paused mid-sentence: the line starts again in the new voice
  ok(speaking(S, 600), "found a line being spoken to pause in");
  S.e.dispatch({ type: "pause" });
  const p = S.e.get().v;
  S.e.setTeacher("t3");
  const q = S.e.get().v;
  ok(S.e.get().teacher === "t3" && same(p, q) && q.t === 0 && q.mode === "paused", "switch while paused mid-sentence: same line, from its start, still paused");
  S.e.dispatch({ type: "play" });
  frames(S, 2);
  ok(!clipNow(S).audio || S.a().src.startsWith("/arp-video/narration/t3/"), "resume after a paused switch: the new voice speaks");
  // while the question itself is being spoken: the new teacher takes over the moment it has been asked
  {
    const Q = sim();
    Q.e.setTeacher("t1", false);
    Q.e.dispatch({ type: "play" });
    for (let g = 0; g < 200000 && !(Q.e.get().v.pos.track === "ask" && Q.e.get().v.t > 400); g++) frames(Q, 1);
    const asking = Q.e.get().v;
    Q.e.setTeacher("t3");
    ok(asking.pos.track === "ask" && Q.e.get().pending === "t3" && Q.e.get().teacher === "t1", "switch while a question is being spoken: the question finishes in the old voice");
    for (let g = 0; g < 20000 && Q.e.get().v.mode === "playing"; g++) frames(Q, 1);
    const w = Q.e.get().v;
    ok(w.mode === "waiting" && Q.e.get().teacher === "t3" && !Q.e.get().pending && w.t === clipAt(Q.e.tl, w.pos).ms && JSON.stringify(w.answers) === JSON.stringify(asking.answers), "... and the new teacher takes over as soon as it has been asked, before the answer");
    const qq = QUESTIONS.find((x) => x.id === (w.pos as { q: string }).q)!;
    Q.e.dispatch({ type: "answer", option: qq.answer });
    frames(Q, 2);
    ok(Q.e.get().v.answers[qq.id]?.correct === true && Q.a().src.startsWith("/arp-video/narration/t3/"), "... and the answer's feedback is in the new teacher's voice");
  }
  // at a question: immediate, and the answer's explanation comes in the new voice
  toWaitingOrEnd(S);
  if (S.e.get().v.mode === "waiting") {
    const w = S.e.get().v;
    S.e.setTeacher("t1");
    ok(S.e.get().teacher === "t1" && same(w, S.e.get().v) && S.e.get().v.mode === "waiting", "switch at a question: immediate, the question stays open");
    const qq = QUESTIONS.find((x) => x.id === (w.pos as { q: string }).q)!;
    S.e.dispatch({ type: "answer", option: qq.answer });
    frames(S, 2);
    // immediately after answering: the explanation has only just begun → it starts again in the new voice
    S.e.setTeacher("t2");
    ok(S.e.get().teacher === "t2" && S.e.get().v.pos.track === "fb" && S.e.get().v.t === 0, "switch right after a correct answer: its explanation restarts in the new voice");
  }
  // after a wrong answer
  toWaitingOrEnd(S);
  if (S.e.get().v.mode === "waiting") {
    const qq = QUESTIONS.find((x) => x.id === (S.e.get().v.pos as { q: string }).q)!;
    S.e.dispatch({ type: "answer", option: qq.options.find((o) => o.id !== qq.answer)!.id });
    frames(S, 2);
    S.e.setTeacher("t3");
    frames(S, 2);
    ok(S.e.get().teacher === "t3" && S.e.get().v.pos.track === "fb" && S.e.get().v.answers[qq.id]?.correct === false && (!clipNow(S).audio || S.a().src.startsWith("/arp-video/narration/t3/")), "switch after a wrong answer: the explanation continues in the new voice, the answer is kept");
  }
  // between chapters
  const answered = Object.keys(S.e.get().v.answers).length;
  S.e.dispatch({ type: "seek", line: 0 });
  S.e.setTeacher("t1");
  ok(S.e.get().teacher === "t1" && Object.keys(S.e.get().v.answers).length === answered, "switch after jumping to a chapter: immediate, answers kept");
  // closing = pause; reopening keeps everything
  frames(S, 20);
  S.e.dispatch({ type: "pause" });
  const closed = S.e.get().v;
  S.e.setTeacher("t2");
  ok(same(closed, S.e.get().v), "switch with the theater closed (paused): place, answers and speed kept");
  // after restarting
  S.e.dispatch({ type: "restart" });
  S.e.setTeacher("t3");
  ok(S.e.get().teacher === "t3" && S.e.get().v.speed === 1.5 && S.e.get().v.run >= 2, "switch after restarting: immediate; speed kept through the restart");
  // speed changes don't touch the teacher; repeated speed changes while playing stay locked
  S.e.dispatch({ type: "play" });
  S.drift = 0;
  for (let k = 0; k < 60; k++) {
    S.e.setSpeed(SPEEDS[k % SPEEDS.length]);
    frames(S, 7);
    if (S.e.get().v.mode === "waiting") S.e.dispatch({ type: "answer", option: QUESTIONS.find((x) => x.id === (S.e.get().v.pos as { q: string }).q)!.answer });
  }
  ok(S.e.get().teacher === "t3", "changing speed never changes the teacher");
  ok(S.drift <= 1 && S.rateOk, `speed changed 60 times while playing: voice and picture stay locked (max drift ${Math.round(S.drift)} ms)`);
  // replay uses the current speed
  S.e.setSpeed(1.25);
  S.e.dispatch({ type: "prev" });
  frames(S, 3);
  ok(S.e.get().v.speed === 1.25 && (!S.a() || S.a().paused || S.a().playbackRate === 1.25), "replay plays at the current speed");
  // remembered for next time (a viewing preference only)
  const S2 = sim();
  S2.e.applyPrefs();
  ok(S2.e.get().teacher === "t3" && S2.e.get().v.speed === 1.25, "teacher and speed are remembered in this browser");
  ok([...store.keys()].every((k) => k === "packetverse.videoPrefs.v1"), "only the viewing-preference key is written");
}

console.log(`ARP video audit: ${pass} passed, ${fails.length} failed`);
for (const f of process.env.AUDIT_ALL ? fails : fails.slice(0, 40)) console.log("  FAIL", f);
if (fails.length) process.exit(1);
