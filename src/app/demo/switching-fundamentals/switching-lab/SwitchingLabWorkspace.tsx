"use client";

import { useState } from "react";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LiveStateCard, type LiveStateRow } from "@/components/practice-lab/LiveStateCard";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { LabDeviceDetails, InspectInCliButton } from "@/components/practice-lab/LabDeviceDetails";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import { CLITerminal, cliSessionKey, withSessionInput, type CliExecutedEvent, type CliSessionMap } from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import { Button } from "@/components/ui/Button";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { BROADCAST_MAC, EDGE_PRIMARY, EDGE_SECONDARY, HOST_ATTACH, LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC, SWF_PORTS, SWF_REPAIR_CORRECT, frameDst, macName, portForwarding, type SwfDevice, type SwfHost, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { SWF_LAB_HOSTS, SWF_LAB_MODEL, isInFlight, swfCopiesPerHost, swfVisibleSegments, type SwfLabAction, type SwfLabState, type SwfSegment } from "@/lib/sim-engine/scenarios/switchingLab";
import { SWF_REGIONS, swfEdges, swfNodes } from "../topology";
import { swfInterfaceAlias, switchingCliSets } from "../cliAdapter";
import { SWF_LAB_REPAIR_INDEX, SWF_LAB_SCRIPT, SWF_LAB_STAGES, SwitchingLabBoard, swfIncidentSolved, swfKindText, swfLocation, swfRevealFor, swfStepChecksDone } from "./SwitchingLabBoard";

/**
 * Switching Lab workspace — the Switching Fundamentals composition of the generic Practice Lab framework, on the
 * lesson's own network (same nodes and edges as the guided lesson, drawn from lab state, both SW1↔SW2 links).
 *
 *   generic (framework):  PracticeLabShell · useLabRunner timing, Replay, Reset · LabTopology packets[] (+ offset
 *                         for parallel links) · LiveStateCard · LabEventLog · LabDeviceDetails · LabPacketFields ·
 *                         CLITerminal sessions · board primitives
 *   Switching (here):     SWF_LAB_MODEL truth (via switchingFundamentals.ts) · script, predictions, checks, incident ·
 *                         copy → packet-view mapping (link offsets, ×N grouping) · table / link cards · free play
 *
 * CLI: SW1 and SW2 (both managed), Cisco and Junos — four sessions (vendor × device) with their own transcript,
 * history and input, all reading the same lab state. Hosts have no switch CLI. State isolation: the network lives
 * only in this lab's runner; nothing here receives the ScenarioEngine, the lesson snapshot or the progress store.
 */

export const SWF_LAB_SEGMENT_MS = 1100;
const LOOP = ["Predict", "Send", "Observe", "Verify"];
const COLOR = { unicast: "#38bdf8", broadcast: "#f59e0b", accepted: "#10b981", discarded: "#94a3b8", stop: "#f87171" };
const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const letter = (h: SwfHost) => h.slice(-1);
const isSw = (d: string): d is SwfSwitch => d === "SW1" || d === "SW2";

/**
 * Phone layout of the SAME network: taller and narrower; the two SW1↔SW2 links keep their parallel offsets.
 * Node tags are left out on phones; tables and cues carry the same facts. Switching-local coordinates only.
 */
// Right-hand hosts stay at x ≤ 76 % so their labels and resting pills don't wrap; the switches sit far enough apart for both link labels.
const COMPACT_POS: Record<string, { x: number; y: number }> = { "HOST-A": { x: 14, y: 20 }, "HOST-D": { x: 14, y: 86 }, SW1: { x: 23, y: 53 }, SW2: { x: 77, y: 53 }, "HOST-B": { x: 76, y: 20 }, "HOST-C": { x: 76, y: 86 } };
/** Same offsets as the edges (topology.ts on desktop, ±5 on phones), so a copy rides the link it was sent on. */
const linkOffset = (seg: SwfSegment, compact: boolean) => (isSw(seg.from) && isSw(seg.to) ? { dx: 0, dy: (seg.egress === SECONDARY_PORT ? 1 : -1) * (compact ? 5 : 6) } : undefined);

/** `revealFlap`: the FLAPPING marker appears only once the learner has diagnosed the incident (or in free play). */
function fdbRows(lab: SwfLabState, sw: SwfSwitch, revealFlap: boolean): LiveStateRow[] {
  const tx = lab.tx && (lab.last?.type === "send" || (lab.last?.type === "repair" && lab.tx.id === lab.seq)) ? lab.tx : undefined;
  const moves = lab.loopEvidence?.moves ?? [];
  return lab.net.fdb[sw].map((e) => {
    const ls = tx?.learned.filter((x) => x.sw === sw && x.mac === e.mac) ?? [];
    const moved = ls.find((x) => x.kind === "moved");
    const flaps = moves.filter((m) => m.sw === sw && m.mac === e.mac);
    const host = macName(e.mac);
    const local = swfLocation(sw, e.port).startsWith("local");
    return {
      key: e.mac,
      primary: `${host} · ${e.mac}`,
      secondary: `${e.port} (Cisco ${swfInterfaceAlias("cisco", e.port)}) · dynamic · ${swfLocation(sw, e.port)}${moved ? ` · moved from ${moved.from}` : ls.length && ls.every((l) => l.kind === "refreshed") ? " · refreshed now" : ""}${revealFlap && flaps.length ? ` · FLAPPING (${flaps.length} move${flaps.length > 1 ? "s" : ""})` : ""}`,
      fresh: ls.some((l) => l.kind !== "refreshed"),
      why: `${sw} learned ${host} from the SOURCE MAC of a frame that arrived on ${sw}'s ${e.port}${moved ? ` (it had been on ${moved.from} — a copy carrying ${host}'s MAC arrived on a different port, so the entry moved)` : ""}. ${local ? `${host} is plugged into that port.` : `From ${sw}'s position, ${host} is reached through the link to ${sw === "SW1" ? "SW2" : "SW1"}.`} ${sw === "SW1" ? "SW2" : "SW1"} keeps its own, separate entry — switches don't share tables.`,
    };
  });
}

function linkRows(lab: SwfLabState): LiveStateRow[] {
  const rows: LiveStateRow[] = [
    { key: "l23", primary: `${PRIMARY_PORT} ↔ ${PRIMARY_PORT} · primary`, secondary: "forwarding on SW1 and SW2 (Cisco Gi1/0/23)", why: "The original SW1↔SW2 link. It is the only path between the switches unless ge-0/0/24 is enabled." },
    {
      key: "l24",
      primary: `${SECONDARY_PORT} ↔ ${SECONDARY_PORT} · secondary`,
      secondary: lab.net.secondaryUp ? "FORWARDING on SW1 and SW2 — second path, no loop prevention" : "disabled on SW1 and SW2 (Cisco Gi1/0/24)",
      fresh: lab.last?.type === "enable-secondary" || (lab.last?.type === "repair" && lab.last.correct),
      why: lab.net.secondaryUp ? "Both SW1↔SW2 links forward. A flood leaves on every forwarding port except the ingress, so each copy returns on the other link. No STP runs in this lab." : "Cabled, but administratively disabled — no frames cross it, and nothing is learned on it.",
    },
  ];
  if (lab.circulating.length) rows.push({ key: "loop", primary: `${lab.circulating.length} cop${lab.circulating.length === 1 ? "y" : "ies"} still circulating`, secondary: `drawing paused after ${LOOP_WAVES_SHOWN} bridge waves · Ethernet has no TTL — the real loop does not stop`, why: "PacketVerse stops drawing for clarity. Nothing in an Ethernet frame counts down, so in a real network these copies keep looping until a link is shut or loop prevention blocks one." });
  return rows;
}

function deviceRows(id: SwfDevice, lab: SwfLabState): [string, string][] {
  const tx = lab.tx && (lab.last?.type === "send" || (lab.last?.type === "repair" && lab.tx.id === lab.seq)) ? lab.tx : undefined;
  if (isSw(id)) {
    const ds = tx?.decisions.filter((x) => x.sw === id) ?? [];
    return [
      ...SWF_PORTS[id].map((p): [string, string] => [`${p.port} (${swfInterfaceAlias("cisco", p.port)})`, `${p.peer}${p.kind === "access" ? "" : ` ${p.peerPort}`} · ${portForwarding(lab.net, id, p.port) ? "forwarding" : "disabled"}`]),
      [`Table (${lab.net.fdb[id].length})`, lab.net.fdb[id].map((e) => `${who(e.mac)} → ${e.port}`).join(" · ") || "empty"],
      ["Last frame", ds.length ? ds.map((d) => `in ${d.ingress}: ${swfKindText(d.kind)}${d.egress.length ? ` out ${d.egress.join(", ")}` : ""}`).join(" · ") : tx ? "never received it" : "—"],
    ];
  }
  const host = id as SwfHost;
  const at = HOST_ATTACH[host];
  const got = tx?.received.filter((r) => r.host === host) ?? [];
  const copies = tx ? swfCopiesPerHost(tx)[host] : 0;
  const ev = lab.loopEvidence;
  return [
    ["MAC", SWF_MAC[host]],
    ["Plugged into", `${at.sw} ${at.port}`],
    ["Last frame", !tx ? "—" : tx.src === host && !got.length ? "sent it" : got.length ? `${got[0].accepted ? "received · accepted" : "received a flooded copy · discarded"}${copies > 1 ? ` — ${copies} copies of ONE frame` : ""}` : "no copy received"],
    ...(ev && tx?.id !== ev.txId ? [["Looping broadcast", `${ev.copies[host]} cop${ev.copies[host] === 1 ? "y" : "ies"} received`] as [string, string]] : []),
  ];
}

function copyNotes(lab: SwfLabState, seg: SwfSegment): Record<string, string> {
  const dst = frameDst(lab.tx!.frame);
  const to = seg.to;
  const dstNote = isSw(to) ? `${to} looks this up in its OWN table` : dst === BROADCAST_MAC ? "broadcast — every receiving host accepts" : dst === SWF_MAC[to as SwfHost] ? `${to}'s own MAC → accepted` : `${who(dst)}, not ${to} → discarded`;
  return {
    "Destination MAC": dstNote,
    "Source MAC": `unchanged on every link — what ${isSw(to) ? to : "each switch"} learns against ${isSw(to) ? `its ingress ${seg.ingress}` : "its own ingress port"}`,
    Type: "no TTL or hop count anywhere in the Ethernet header — a bridge forwards an identical copy",
  };
}

export function SwitchingLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(SWF_LAB_MODEL, { segmentMs: SWF_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [cursor, setCursor] = useState(0);
  const [freePlay, setFreePlay] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, string[]>>({});
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<SwfDevice | undefined>(undefined);
  const [packetSeg, setPacketSeg] = useState<string | undefined>(undefined);
  const [openWhy, setOpenWhy] = useState<string | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [composer, setComposer] = useState<{ src: SwfHost; dst: string }>({ src: "HOST-A", dst: "HOST-B" });
  /** Four terminals: one session per vendor × switch (same lab state, separate transcript/history/input). */
  const [cliDevice, setCliDevice] = useState<SwfSwitch>("SW1");
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [cliFocus, setCliFocus] = useState(0);

  const inFlight = isInFlight(lab);
  const busy = inFlight || runner.busy;
  const next = !freePlay ? SWF_LAB_SCRIPT[cursor] : undefined;
  const prev = cursor > 0 ? SWF_LAB_SCRIPT[cursor - 1] : undefined;
  const unanswered = next?.predict?.some((p) => !(answers[p.id]?.length));
  const tx = lab.tx;
  /** A frame is drawn for a send, or for the repair's drain (the copies left on ge-0/0/23). */
  const txIsCurrent = !!tx && (lab.last?.type === "send" || (lab.last?.type === "repair" && tx.id === lab.seq));
  const showFrame = txIsCurrent || !!runner.replayFrame;
  const shownWave = runner.replayFrame ? runner.replayFrame.hop : (tx?.wave ?? 0);

  /** Inspections count only after the latest event has fully landed — a mid-flight look can't prove the result. */
  const seen = (key: string) => seenKeys.has(`${lab.seq}|${key}`);
  const seenSince = (fromSeq: number, key: string) => [...seenKeys].some((k) => k.endsWith(`|${key}`) && Number(k.slice(0, k.indexOf("|"))) >= fromSeq);
  function markSeen(key: string) {
    if (inFlight) return;
    const k = `${lab.seq}|${key}`;
    if (!seenKeys.has(k)) setSeenKeys((s) => new Set([...s, k]));
  }
  const answer = (key: string) => answers[key] ?? [];
  const onAnswer = (key: string, v: string[]) => setAnswers((a) => ({ ...a, [key]: v }));

  function inspectDevice(id: SwfDevice) {
    setSelected(id);
    setPacketSeg(undefined);
    markSeen(`dev:${id}`);
  }
  /** A click always opens (and counts as inspecting) the device card; it closes with its × button. */
  function selectDevice(id: string) {
    inspectDevice(id as SwfDevice);
  }
  function inspectCopy(segId: string) {
    setPacketSeg(segId);
    setSelected(undefined);
    markSeen(`pkt:${segId}`);
  }
  function act(action: SwfLabAction) {
    setPacketSeg(undefined);
    runner.run(action);
  }
  function performNext() {
    if (!next || busy || gate) return;
    if (next.repair) {
      // The learner's chosen fix; the lab model decides whether it changes anything.
      const choice = answer("repair-choice")[0];
      act({ type: "repair", choice });
      if (choice === SWF_REPAIR_CORRECT) setCursor((c) => c + 1);
      return;
    }
    setRevealed((r) => ({ ...r, ...swfRevealFor(next, lab) }));
    setCursor((c) => c + 1);
    act(next.action);
  }
  function sendComposed() {
    if (busy || composer.src === composer.dst) return;
    if (composer.dst.startsWith("bcast:")) act({ type: "send", src: composer.src, dst: "broadcast", arpFor: composer.dst.slice(6) as SwfHost });
    else act({ type: "send", src: composer.src, dst: composer.dst as SwfHost });
  }
  function reset() {
    runner.reset();
    setCursor(0);
    setFreePlay(false);
    setAnswers({});
    setRevealed({});
    setSeenKeys(new Set());
    setSelected(undefined);
    setPacketSeg(undefined);
    setOpenWhy(undefined);
    setComposer({ src: "HOST-A", dst: "HOST-B" });
    setCliSessions({});
    setCliDevice("SW1");
  }
  /** Only successfully executed commands are reported (never Tab or `?`), keyed by the switch they ran on. */
  function onExecuted(e: CliExecutedEvent) {
    markSeen(`cli:${e.deviceId}:${e.commandId}`);
  }
  function putCommand(sw: SwfSwitch, v: CliVendor, text: string) {
    setCliDevice(sw);
    setVendor(v);
    setCliSessions((m) => withSessionInput(m, cliSessionKey(v, sw), text));
    setMobileTab("cli");
    setCliFocus((n) => n + 1);
  }
  function openCli(sw: SwfSwitch) {
    setCliDevice(sw);
    setMobileTab("cli");
    setCliFocus((n) => n + 1);
  }
  /** Both tables can hold the same MAC, so each card's row keys are prefixed with its switch ("SW1 <mac>"). */
  function onWhy(id: string | undefined) {
    setOpenWhy(id);
    if (id) markSeen(`card:${id.slice(0, 3)}`);
  }

  const ctx = { lab, seen, seenSince, answer, onAnswer, onInspectDevice: inspectDevice, onInspectCopy: inspectCopy, onPutCommand: putCommand };
  const solved = swfIncidentSolved(ctx);
  const gate = unanswered
    ? "Answer the prediction above first"
    : next?.repair && !solved
      ? "Finish the investigation first: evidence, hypothesis, test"
      : next?.repair && !answer("repair-choice").length
        ? "Choose a fix above"
        : undefined;
  const revealFlap = freePlay || cursor > SWF_LAB_REPAIR_INDEX || solved;
  const checksDone = prev ? swfStepChecksDone(prev.id, ctx) : true;
  const loop = inFlight ? 2 : freePlay ? -1 : !checksDone ? 3 : unanswered ? 0 : next ? 1 : -1;
  const stage = prev?.stage ?? 0;

  /**
   * Copies drawn for `compact`. Identical copies are grouped as ×N: moving ones per link and direction, resting ones
   * per device and outcome (they rest on the device, so one pill per device keeps them readable). Phones get shorter
   * resting labels so pills don't wrap.
   */
  const packetsFor = (compact: boolean): LabPacketView[] => {
    if (!showFrame || !tx) return [];
    const bcast = tx.dst === "broadcast";
    const base = bcast ? `${letter(tx.src)}→all` : `${letter(tx.src)}→${letter(tx.dst as SwfHost)}`;
    const groups = new Map<string, { seg: SwfSegment; moving: boolean; n: number }>();
    swfVisibleSegments(tx, shownWave).forEach(({ seg, moving }) => {
      const k = moving ? `m|${seg.from}|${seg.to}|${seg.egress}` : `r|${seg.to}|${seg.outcome}`;
      const g = groups.get(k);
      if (g) g.n++;
      else groups.set(k, { seg, moving, n: 1 });
    });
    return [...groups.values()].map(({ seg, moving, n }) => {
      const times = n > 1 ? ` ×${n}` : "";
      const rest =
        seg.outcome === "accepted"
          ? { label: compact && n > 1 ? `✓${times}` : `✓ ${base}${times}`, color: COLOR.accepted }
          : seg.outcome === "discarded"
            ? { label: `✗ discard${times}`, color: COLOR.discarded }
            : seg.outcome === "circulating"
              ? { label: compact ? `↻${times}` : `↻ looping${times}`, color: COLOR.stop }
              : { label: `${seg.outcome === "filtered" ? "filtered" : "no port"}${times}`, color: COLOR.stop };
      return {
        id: `${tx.id}:${seg.id}:${runner.replayFrame?.id ?? "live"}`,
        path: [seg.from, seg.to],
        hop: moving ? 0 : 1,
        done: !moving,
        label: moving ? `${base}${times}` : rest.label,
        color: moving ? (bcast ? COLOR.broadcast : COLOR.unicast) : rest.color,
        offset: moving ? linkOffset(seg, compact) : undefined,
        description: `${tx.frame.summary} — copy ${seg.from} ${seg.egress} → ${seg.to}${seg.outcome && !moving ? ` (${seg.outcome})` : ""}${times ? ` — ${n} identical copies` : ""}`,
        onSelect: () => inspectCopy(seg.id),
      };
    });
  };
  const movingIds = packetsFor(false)
    .filter((p) => !p.done)
    .flatMap((p) => p.path);

  const nodeTags: Record<string, string> = {};
  if (txIsCurrent && tx && !runner.replayFrame)
    tx.learned.forEach((l) => {
      if (l.kind !== "refreshed" && !nodeTags[l.sw]?.includes(who(l.mac))) nodeTags[l.sw] = `${nodeTags[l.sw] ? `${nodeTags[l.sw]} ` : ""}${l.kind === "moved" ? "↔" : "+"} ${who(l.mac)}`;
    });
  const cues: string[] = [];
  if (txIsCurrent && tx) {
    [...new Set(tx.decisions.map((d) => `${d.sw}: ${swfKindText(d.kind)}`))].forEach((c) => cues.push(c));
    if (lab.circulating.length && tx.wave >= tx.waves) cues.push(`${lab.circulating.length} copies still circulating — no TTL`);
  } else if (lab.last?.type === "clear") cues.push(`${lab.last.sw} table cleared`);
  else if (lab.last?.type === "enable-secondary") cues.push(`${SECONDARY_PORT} FORWARDING · no loop prevention`);
  else if (lab.last?.type === "repair") cues.push(lab.last.correct ? `${SECONDARY_PORT} disabled` : `${lab.circulating.length} copies still circulating`);

  const edges = swfEdges(lab.net).map((e) => ({ ...e, state: e.down ? ("down" as const) : ("full" as const) }));
  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={compact ? swfNodes(lab.net).map((n) => ({ ...n, ...COMPACT_POS[n.id] })) : swfNodes(lab.net)}
      edges={compact ? edges.map((e) => (e.id === EDGE_PRIMARY ? { ...e, offset: { dx: 0, dy: -5 } } : e.id === EDGE_SECONDARY ? { ...e, offset: { dx: 0, dy: 5 } } : e)) : edges}
      regions={SWF_REGIONS}
      activeNodeIds={movingIds}
      selectedNodeId={selected}
      onNodeClick={selectDevice}
      packets={packetsFor(compact)}
      segmentMs={SWF_LAB_SEGMENT_MS}
      nodeTags={compact ? undefined : nodeTags}
      cues={cues}
    />
  );
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );

  const pktSeg = packetSeg && tx ? tx.segments.find((g) => g.id === packetSeg) : undefined;
  const smallBtn = (label: string, onClick: () => void, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-full border border-pv-border px-2.5 py-1 text-[11px] font-semibold text-pv-text-muted hover:text-pv-text disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      {label}
    </button>
  );
  const select = (value: string, onChange: (v: string) => void, options: { value: string; label: string }[], label: string) => (
    <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const others = SWF_LAB_HOSTS.filter((h) => h !== composer.src);
  const dstOptions = [...others.map((h) => ({ value: h, label: h })), ...others.map((h) => ({ value: `bcast:${h}`, label: `ARP broadcast for ${h}` }))];

  const topologyFooter = (
    <>
      {selected && (
        <LabDeviceDetails
          title={isSw(selected) ? `${selected} · managed switch` : selected}
          rows={deviceRows(selected, lab)}
          onClose={() => setSelected(undefined)}
          action={isSw(selected) ? <InspectInCliButton onClick={() => openCli(selected)} /> : undefined}
        />
      )}
      {pktSeg && tx && (
        <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5">
          <button type="button" onClick={() => setPacketSeg(undefined)} aria-label="Close packet fields" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
            ×
          </button>
          <p className="mb-1.5 pr-5 text-[12px] font-semibold text-pv-text">
            Copy {pktSeg.from} {pktSeg.egress} → {pktSeg.to} {isSw(pktSeg.to) ? `(in on ${pktSeg.ingress})` : ""}
            {pktSeg.outcome && <span className="ml-1.5 font-normal text-pv-text-muted">· {pktSeg.outcome === "forwarded" ? `${pktSeg.to} accepted it for processing` : pktSeg.outcome}</span>}
          </p>
          <LabPacketFields packet={tx.frame} notes={copyNotes(lab, pktSeg)} />
        </div>
      )}
      {freePlay && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Free play controls">
          {select(composer.src, (v) => setComposer((c) => ({ src: v as SwfHost, dst: c.dst === v || c.dst === `bcast:${v}` ? SWF_LAB_HOSTS.find((h) => h !== v)! : c.dst })), SWF_LAB_HOSTS.map((h) => ({ value: h, label: h })), "From")}
          {select(composer.dst, (v) => setComposer((c) => ({ ...c, dst: v })), dstOptions, "To")}
          {smallBtn("Clear SW1 table", () => act({ type: "clear", sw: "SW1" }), busy)}
          {smallBtn("Clear SW2 table", () => act({ type: "clear", sw: "SW2" }), busy)}
          {lab.net.secondaryUp ? smallBtn(`Disable ${SECONDARY_PORT}`, () => act({ type: "repair", choice: SWF_REPAIR_CORRECT }), busy) : smallBtn(`Enable ${SECONDARY_PORT} (no loop prevention)`, () => act({ type: "enable-secondary" }), busy)}
        </div>
      )}
    </>
  );

  const primaryAction = (compact: boolean) =>
    freePlay ? (
      <Button size="sm" onClick={sendComposed} disabled={busy || composer.src === composer.dst}>
        Send {compact ? "" : `${composer.src} → ${composer.dst.replace("bcast:", "ARP broadcast for ")}`} →
      </Button>
    ) : next ? (
      <Button size="sm" onClick={performNext} disabled={busy || !!gate} title={gate}>
        {compact ? next.label.replace(/^Send |^Verify: /, "").replace(/^Ticket: “(.*)” — reproduce it$/, "Reproduce ticket") : next.label} →
      </Button>
    ) : null;

  const controls = (
    <>
      {smallBtn("↻ Replay frame", () => tx && runner.replay(tx.waves), !txIsCurrent || !tx?.waves || busy)}
      {smallBtn("Inspect packet", () => tx && inspectCopy(tx.segments[0].id), !txIsCurrent || !tx?.segments.length || inFlight)}
      {!freePlay && smallBtn(next ? "Skip to free play" : "Free play", () => setFreePlay(true), busy)}
    </>
  );

  const cliSets = switchingCliSets(cliDevice, lab.net);
  const cliHeader = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Switch CLI" className="flex gap-1">
        {(["SW1", "SW2"] as SwfSwitch[]).map((sw) => (
          <button key={sw} type="button" role="radio" aria-checked={cliDevice === sw} onClick={() => setCliDevice(sw)} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan ${cliDevice === sw ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text"}`}>
            {sw}
          </button>
        ))}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Each switch has its own table · hosts have no switch CLI</p>
    </div>
  );

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Switching Lab"
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={SWF_LAB_STAGES.map((label, i) => ({ id: `t${i}`, label }))}
      currentStage={stage}
      stageSuffix={freePlay ? <span className="rounded-full border border-pv-violet/50 px-2 py-0.5 text-[11px] font-semibold text-pv-violet">Free play</span> : undefined}
      loop={{ labels: LOOP, current: loop }}
      primaryAction={primaryAction}
      topology={topology}
      topologyClassName="h-[520px] sm:h-[clamp(220px,34vh,320px)]"
      topologyFooter={topologyFooter}
      controls={controls}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{lab.log[lab.log.length - 1]?.text}</p>}
      board={<SwitchingLabBoard {...ctx} revealed={revealed} cursor={cursor} freePlay={freePlay} inFlight={inFlight} gate={gate} />}
      liveState={
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <LiveStateCard title="SW1 forwarding table" caption="MAC → PORT · SW1's OWN VIEW" rows={fdbRows(lab, "SW1", revealFlap).map((r) => ({ ...r, key: `SW1 ${r.key}` }))} pulseKey={lab.seq} openWhy={openWhy} onWhy={onWhy} whyHeading="Why is this entry here?" />
          <LiveStateCard title="SW2 forwarding table" caption="MAC → PORT · SW2's OWN VIEW" rows={fdbRows(lab, "SW2", revealFlap).map((r) => ({ ...r, key: `SW2 ${r.key}` }))} pulseKey={lab.seq} openWhy={openWhy} onWhy={onWhy} whyHeading="Why is this entry here?" />
          <div className="min-w-0 sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <LiveStateCard title="SW1 ↔ SW2 links" caption="LINK · STATE" rows={linkRows(lab)} pulseKey={lab.seq} openWhy={openWhy} onWhy={setOpenWhy} whyHeading="What does this mean?" />
          </div>
          <p className="text-[10.5px] text-pv-text-faint sm:col-span-2 lg:col-span-1 xl:col-span-2">Two separate tables, never synchronised · no loop prevention (no STP) configured · no aging in this lesson&apos;s model.</p>
        </div>
      }
      eventLog={<LabEventLog entries={lab.log} />}
      cliHeader={cliHeader}
      cli={
        <CLITerminal
          commandSets={cliSets}
          sessions={cliSessions}
          onSessionsChange={setCliSessions}
          focusRequest={cliFocus}
          vendor={vendor}
          onVendorChange={setVendor}
          deviceRole="Access Switch"
          contextLabel={`Switching Lab · T${stage} ${SWF_LAB_STAGES[stage]}`}
          onExecuted={onExecuted}
          stateVersion={runner.revision}
          footer="PacketVerse CLI supports the commands relevant to this lesson (read-only). Cisco names the ports Gi1/0/1, 2, 23, 24; Junos and this lesson call them ge-0/0/1, 2, 23, 24."
        />
      }
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    />
  );
}
