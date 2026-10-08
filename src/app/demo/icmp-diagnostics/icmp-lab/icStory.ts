import { IC_KIND, type IcDecision, type IcDev, type IcFrame, type IcPkt, type IcProbe, type IcRun } from "@/lib/sim-engine/scenarios/icmpNet";

/**
 * The ICMP lab's packet story: the model's frames for a run, turned into beats a student can watch.
 *
 * Nothing here decides anything about the network. Every beat comes from a frame the walk recorded (a move, a drop,
 * a delivery) and every check shown inside a device comes from the decision the walk attached to that frame
 * (filter, TTL, route, MTU/DF, ARP, host firewall). The story only groups frames into what a person sees:
 *   send     — the sender builds the probe
 *   travel   — a packet crosses a link (on the lane of its direction: toward HOST-B on top, back toward HOST-A below)
 *   process  — a router forwards it: the checks it passed, TTL −1, out an interface
 *   stop     — a device discards it (and the check that failed)
 *   generate — a device builds a NEW packet: an Echo Reply (an answer) or an ICMP error (a report about the dead one)
 *   receive  — a host or router accepts a packet addressed to it
 *   silence  — the sender got nothing back
 *   loop     — the middle of a routing loop, summarized
 *   probe    — the next probe of a traceroute (or a ping that behaves differently)
 */

export const DEVS: IcDev[] = ["HOST-A", "R1", "R2", "HOST-B"];
export const devIndex = (d: IcDev) => DEVS.indexOf(d);
export const isRouter = (d: IcDev) => d === "R1" || d === "R2";
export const isErr = (p: IcPkt) => p.proto === "icmp" && IC_KIND[p.kind!].error;
export const samePkt = (a: IcPkt, b: IcPkt) => a.src === b.src && a.dst === b.dst && a.proto === b.proto && a.kind === b.kind && a.tcp === b.tcp && a.dport === b.dport;
/** +1: travelling toward HOST-B (top lane); −1: toward HOST-A (bottom lane). */
export type Dir = 1 | -1;
export const dirOf = (from: IcDev, to: IcDev): Dir => (devIndex(to) > devIndex(from) ? 1 : -1);

export const pktName = (p: IcPkt) => (p.proto === "icmp" ? IC_KIND[p.kind!].short : p.proto === "udp" ? `UDP probe → ${p.dport}` : p.tcp === "DATA" ? "TCP data" : `TCP ${p.tcp}`);
export const pktCode = (p: IcPkt) => (p.proto === "icmp" ? `${IC_KIND[p.kind!].type}/${IC_KIND[p.kind!].code}` : p.proto.toUpperCase());

export type BeatKind = "probe" | "send" | "travel" | "process" | "stop" | "generate" | "receive" | "silence" | "loop";
export interface Beat {
  k: BeatKind;
  /** Where it happens (travel: where it leaves). */
  at: IcDev;
  to?: IcDev;
  /** Lane the packet arrives on / leaves on. */
  dirIn?: Dir;
  dirOut?: Dir;
  pkt: IcPkt;
  /** process: the packet as it arrived (before TTL −1). generate: the packet that caused it. */
  prev?: IcPkt;
  dec?: IcDecision;
  text: string;
  tone: "info" | "ok" | "bad" | "icmp";
  probe: number;
  dur: number;
  /** The same kind of thing already happened at this device in this run: play it briskly. */
  brief?: boolean;
  /** generate: an answer (Echo Reply, SYN-ACK) or a report (an ICMP error). */
  role?: "answer" | "report";
}

export interface ProbeInfo {
  label: string;
  short: string;
  probe: IcProbe;
  sender: IcDev;
  first: number;
  /** Outbound journey of the probe itself. */
  out: { reached: IcDev; fate: "delivered" | "died" | "refused"; why?: string };
  /** The packet created in response (reply or error), if any. */
  back?: { from: IcDev; reached: IcDev; fate: "delivered" | "died"; pkt: IcPkt; why?: string };
}

export interface Story {
  beats: Beat[];
  probes: ProbeInfo[];
  tool?: IcRun["tool"];
}

const DUR: Record<BeatKind, number> = { probe: 800, send: 850, travel: 850, process: 1650, stop: 1500, generate: 1450, receive: 950, silence: 1900, loop: 3600 };

/** Short reason for a stop, from the check that failed. */
export function stopReason(dec: IcDecision | undefined, text: string): string {
  if (!dec) return /refuses/.test(text) ? "too big to send" : "dropped";
  if (dec.filter && !dec.filter.ok) return "filtered";
  if (dec.fw && !dec.fw.ok) return "firewall drop";
  if (dec.ttl && dec.ttl.out === 0) return "TTL expired";
  if (dec.route === null) return "no route";
  if (dec.fit && !dec.fit.ok) return dec.fit.at === "ingress" ? "giant: bigger than MTU" : "too big · DF";
  if (dec.arp && !dec.arp.ok) return "no ARP answer";
  return "dropped";
}

/** Probes worth showing: every traceroute TTL (first probe of each), every distinct ping result. */
function probesOf(run: IcRun): { label: string; short: string; probe: IcProbe }[] {
  if (run.tool === "traceroute") return run.hops!.map((h, i) => ({ label: `TTL ${i + 1}`, short: `TTL ${i + 1}`, probe: h[0] }));
  if (run.tool === "curl") return run.probes.map((p, i) => ({ label: i === 0 ? "TCP connect (SYN)" : i === 1 ? "HOST-B sends the data" : "HOST-B resends, smaller", short: i === 0 ? "SYN" : i === 1 ? "data" : "resend", probe: p }));
  const out: { label: string; short: string; probe: IcProbe; n: number; sig: string }[] = [];
  run.probes.forEach((p, i) => {
    const sig = `${p.localError ?? ""}|${p.answer?.kind ?? "-"}|${p.answer?.src ?? ""}|${p.frames.length}`;
    const g = out[out.length - 1];
    if (g && g.sig === sig) g.n++;
    else out.push({ label: `icmp_seq ${i + 1}`, short: `seq ${i + 1}`, probe: p, n: 1, sig });
  });
  return out.map((g) => ({ label: g.n > 1 ? `${g.label}–${Number(g.label.slice(9)) + g.n - 1} (identical)` : g.label, short: g.short, probe: g.probe }));
}

type Skip = { skip: true; at: IcDev; dirIn: Dir; pkt: IcPkt; ttlFrom: number; trips: number };
/** A loop bounces the same packet between R1 and R2 until its TTL runs out: keep 4 trips, summarize the middle, keep the last 2. */
function compress(frames: IcFrame[]): (IcFrame | Skip)[] {
  const out: (IcFrame | Skip)[] = [];
  let i = 0;
  while (i < frames.length) {
    const f = frames[i];
    let j = i;
    const ok = (g: IcFrame) => g.kind === "move" && isRouter(g.from) && !!g.to && isRouter(g.to) && samePkt(g.pkt, f.pkt);
    while (j < frames.length && ok(frames[j])) {
      j++;
      // skip the (non-move) frames between moves? a forwarded packet has none, so a run of moves is consecutive.
    }
    const n = j - i;
    if (f.kind === "move" && n > 6) {
      out.push(...frames.slice(i, i + 4));
      const m = frames[j - 3];
      out.push({ skip: true, at: m.to!, dirIn: dirOf(m.from, m.to!), pkt: m.pkt, ttlFrom: frames[i + 3].pkt.ttl, trips: n - 6 });
      out.push(...frames.slice(j - 2, j));
      i = j;
    } else {
      out.push(f);
      i++;
    }
  }
  return out;
}

export function buildStory(run: IcRun | undefined): Story {
  if (!run) return { beats: [], probes: [] };
  const beats: Beat[] = [];
  const probes: ProbeInfo[] = [];
  const seen = new Set<string>();
  const list = probesOf(run);
  list.forEach((pr, pi) => {
    const first = beats.length;
    const sender = pr.probe.frames[0]?.from ?? run.dev;
    const push = (b: Omit<Beat, "probe" | "dur">) => {
      const key = `${b.k}|${b.at}|${b.k === "generate" ? b.role : ""}`;
      const brief = (b.k === "process" || b.k === "receive" || b.k === "generate" || b.k === "stop") && seen.has(key);
      seen.add(key);
      beats.push({ ...b, probe: pi, dur: DUR[b.k] * (brief ? 0.6 : 1), brief });
    };
    if (list.length > 1 || run.tool === "traceroute") push({ k: "probe", at: sender, pkt: pr.probe.frames[0]?.pkt ?? ({} as IcPkt), text: run.tool === "traceroute" ? `Probe ${pi + 1}: the same packet, but with TTL ${pi + 1} — it may cross ${pi + 1} router hop${pi ? "s" : ""} before it dies` : pr.label, tone: "info" });
    let cur: { at: IcDev; pkt: IcPkt; dir?: Dir } | undefined;
    let gen: IcFrame | undefined;
    const generate = (f: IcFrame, dirOut?: Dir) => {
      const report = isErr(f.pkt);
      push({
        k: "generate",
        at: f.from,
        dirIn: cur?.dir,
        dirOut,
        pkt: f.pkt,
        prev: cur?.pkt,
        dec: gen?.dec ?? f.dec,
        role: report ? "report" : "answer",
        text: gen?.text ?? (f.pkt.kind === "echo-rep" ? `${f.from} builds a NEW packet: an Echo Reply back to ${f.pkt.dst}` : `${f.from} builds a NEW packet: ${pktName(f.pkt)} to ${f.pkt.dst}`),
        tone: report ? "icmp" : "ok",
      });
      gen = undefined;
    };
    for (const f of compress(pr.probe.frames)) {
      if ("skip" in f) {
        push({ k: "loop", at: f.at, dirIn: f.dirIn, pkt: f.pkt, prev: { ...f.pkt, ttl: f.ttlFrom }, text: `…and round it goes: ${f.trips} more trips between R1 and R2. Each router takes 1 off the TTL (${f.ttlFrom} → ${f.pkt.ttl}). Nothing stops a loop except the TTL.`, tone: "bad" });
        cur = { at: f.at, pkt: f.pkt, dir: f.dirIn };
        continue;
      }
      if (f.kind === "move" && f.to) {
        const d = dirOf(f.from, f.to);
        if (!cur) push({ k: "send", at: f.from, dirOut: d, pkt: f.pkt, dec: f.dec, text: `${f.from} sends ${pktName(f.pkt)} to ${f.pkt.dst} — TTL ${f.pkt.ttl}, ${f.pkt.len} bytes${f.pkt.df ? ", DF set" : ""}${f.pkt.frags ? `, in ${f.pkt.frags} fragments` : ""}`, tone: "info" });
        else if (cur.at === f.from && !samePkt(cur.pkt, f.pkt)) generate(f, d);
        else if (cur.at === f.from && isRouter(f.from)) push({ k: "process", at: f.from, dirIn: cur.dir, dirOut: d, pkt: f.pkt, prev: cur.pkt, dec: f.dec, text: f.text, tone: "info" });
        push({ k: "travel", at: f.from, to: f.to, dirOut: d, pkt: f.pkt, text: f.text, tone: isErr(f.pkt) ? "icmp" : "info" });
        cur = { at: f.to, pkt: f.pkt, dir: d };
      } else if (f.kind === "drop" && f.tone === "icmp") {
        gen = f;
      } else if (f.kind === "drop") {
        if (cur && cur.at === f.from && !samePkt(cur.pkt, f.pkt)) generate(f);
        push({ k: "stop", at: f.from, dirIn: cur?.dir, pkt: f.pkt, prev: cur?.pkt, dec: f.dec, text: f.text, tone: "bad" });
        if (!cur) cur = { at: f.from, pkt: f.pkt };
        else cur = { ...cur, pkt: f.pkt };
      } else if (f.kind === "deliver") {
        push({ k: "receive", at: f.from, dirIn: cur?.dir, pkt: f.pkt, dec: f.dec, text: f.text, tone: f.tone === "icmp" ? "icmp" : "ok" });
      }
    }
    if (gen && cur) push({ k: "stop", at: cur.at, dirIn: cur.dir, pkt: cur.pkt, dec: gen.dec, text: gen.text, tone: "icmp" });
    const p = pr.probe;
    if (!p.answer && !p.localError && run.tool !== "curl") {
      const mine = beats.slice(first);
      const last = [...mine].reverse().find((b) => b.k === "stop");
      const gen = last && mine.slice(mine.indexOf(last)).find((b) => b.k === "generate" && b.at === last.at);
      const told = gen ? ` and sent ${pktCode(gen.pkt)} ${pktName(gen.pkt)} — to ${gen.pkt.dst}, not to ${sender}` : " and sent no ICMP";
      push({ k: "silence", at: sender, pkt: p.frames[0]?.pkt ?? ({} as IcPkt), text: last ? `${sender} waits — and nothing comes back. The last thing that happened: ${last.at} dropped ${pktName(last.pkt)} (${stopReason(last.dec, last.text)})${told}. From ${sender}, that looks exactly like a timeout.` : `${sender} waits — and nothing comes back.`, tone: "bad" });
    }
    probes.push({ label: pr.label, short: pr.short, probe: p, sender, first, ...journey(beats.slice(first), p) });
  });
  return { beats, probes, tool: run.tool };
}

/** Where the probe got to, and where the packet created in response got to — read off the beats. */
function journey(bs: Beat[], p: IcProbe): Pick<ProbeInfo, "out" | "back"> {
  const firstPkt = p.frames[0]?.pkt;
  let reached: IcDev = p.frames[0]?.from ?? "HOST-A";
  let fate: ProbeInfo["out"]["fate"] = p.localError ? "refused" : "died";
  let why: string | undefined;
  let back: ProbeInfo["back"];
  for (const b of bs) {
    const mine = firstPkt && samePkt(b.pkt, firstPkt);
    if (mine && b.k === "travel" && b.to) reached = b.to;
    if (mine && b.k === "receive") fate = "delivered";
    if (mine && b.k === "stop") {
      fate = p.localError ? "refused" : "died";
      why = stopReason(b.dec, b.text);
    }
    if (b.k === "generate" && !back) back = { from: b.at, reached: b.at, fate: "died", pkt: b.pkt };
    if (back && samePkt(b.pkt, back.pkt)) {
      if (b.k === "travel" && b.to) back.reached = b.to;
      if (b.k === "receive") back.fate = "delivered";
      if (b.k === "stop") back.why = stopReason(b.dec, b.text);
    }
  }
  return { out: { reached, fate, why }, back };
}
