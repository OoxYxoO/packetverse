"use client";

import { useState } from "react";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LiveStateCard, type LiveStateRow } from "@/components/practice-lab/LiveStateCard";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { LabDeviceDetails, InspectInCliButton } from "@/components/practice-lab/LabDeviceDetails";
import { CLITerminal, cliSessionKey, withSessionInput, type CliExecutedEvent, type CliSessionMap } from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import { Button } from "@/components/ui/Button";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { BROADCAST_MAC, DESK_PORTS, ETH_MAC, ETH_REPAIR_CORRECT, FDB_AGING_SEC, SW1_PORTS, deskPortNeighbor, macName, sw1PortNeighbor, type EthDevice, type EthHost, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_HOSTS, ETH_LAB_MODEL, ethVisibleSegments, hostAttachment, isInFlight, type EthLabAction, type EthLabState, type EthSegment } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ETH_REGIONS, ethEdges, ethNodes } from "../topology";
import { SW1_HOSTNAME, ethInterfaceAlias, ethernetSw1CliSets } from "../cliAdapter";
import { ETH_LAB_REPAIR_INDEX, ETH_LAB_SCRIPT, ETH_LAB_STAGES, EthernetLabBoard, ethIncidentSolved, ethRevealFor, ethStepChecksDone } from "./EthernetLabBoard";

/**
 * Ethernet Lab workspace — the Ethernet composition of the generic Practice Lab framework, on the lesson's own
 * network (same nodes, edges and HOST-B attachment as the guided lesson, drawn from lab state).
 *
 *   generic (framework):  PracticeLabShell layout · useLabRunner timing, Replay, Reset · LabTopology packets[] ·
 *                         LiveStateCard · LabEventLog · LabDeviceDetails · LabPacketFields · board primitives
 *   Ethernet (here):      ETH_LAB_MODEL truth (via ethernetSwitching.ts) · script, predictions and checks ·
 *                         copy → packet-view mapping · table rows and "Why?" · device facts · free play
 *
 * CLI: SW1 only (the managed switch), Cisco and Junos, through the generic CLITerminal and this lesson's adapter;
 * one session per vendor × device, all reading the same lab state. DESK-SW (unmanaged) and hosts get no CLI.
 * State isolation: the network lives only in this lab's runner; nothing here receives the ScenarioEngine, the
 * lesson snapshot or the progress store.
 */

export const ETH_LAB_SEGMENT_MS = 1100;
const LOOP = ["Predict", "Send", "Observe", "Verify"];
const COLOR = { unicast: "#38bdf8", broadcast: "#f59e0b", accepted: "#10b981", discarded: "#94a3b8", stop: "#f87171" };
/**
 * Phone layout of the SAME network (same devices, links and HOST-B attachment): taller and narrower, so the copies'
 * pills (which ride above the nodes) don't cover device labels. Node tags are left out here (they would sit on the
 * edge labels); the tables and cue chips carry the same facts. Ethernet-local — the framework has no layout logic.
 */
const COMPACT_POS: Record<string, { x: number; y: number }> = { "HOST-A": { x: 18, y: 20 }, "HOST-C": { x: 12, y: 52 }, SW1: { x: 52, y: 50 }, "DESK-SW": { x: 36, y: 84 } };
const compactNodes = (net: EthLabState["net"]) => ethNodes(net).map((n) => ({ ...n, ...(n.id === "HOST-B" ? (net.hostB === "SW1 ge-0/0/2" ? { x: 78, y: 20 } : { x: 78, y: 84 }) : COMPACT_POS[n.id]) }));
const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const letter = (h: EthHost) => h.slice(-1);

/** `revealStale`: the STALE marker appears only once the learner has diagnosed the incident (or in free play). */
function fdbRows(lab: EthLabState, sw: EthSwitch, revealStale: boolean): LiveStateRow[] {
  const tx = lab.last?.type === "send" ? lab.tx : undefined;
  return lab.net.fdb[sw].map((e) => {
    const l = tx?.learned.find((x) => x.sw === sw && x.mac === e.mac);
    const age = lab.net.clock - e.lastSeen;
    const host = macName(e.mac) as EthHost;
    const real = hostAttachment(lab.net, host);
    const stale = revealStale && sw === "SW1" && !(real.sw === "SW1" && real.port === e.port) && !(real.sw === "DESK-SW" && e.port === "ge-0/0/4");
    return {
      key: e.mac,
      primary: `${host} · ${e.mac}`,
      secondary: `${e.port}${sw === "SW1" ? ` (Cisco ${ethInterfaceAlias("cisco", e.port)})` : ""} · dynamic · age ${age} s${l?.kind === "refreshed" ? " · refreshed now" : ""}${stale ? ` · STALE — ${host} is on ${real.port}` : ""}`,
      fresh: !!l && l.kind !== "refreshed",
      why: `${sw} learned ${host} from the SOURCE MAC of a frame that arrived on ${e.port}${l?.kind === "moved" ? ` (it had been on ${l.from} — the MAC moved)` : ""}. Last seen as a source at t=${e.lastSeen} s, so age ${age} s; it expires after ${FDB_AGING_SEC} s without a frame from ${host}.${stale ? ` STALE: ${host} is now plugged into ${real.sw} ${real.port}, but has not sent a frame from there, and ${e.port} never went down.` : ""}`,
    };
  });
}

function deviceRows(id: EthDevice, lab: EthLabState): [string, string][] {
  const net = lab.net;
  const tx = lab.last?.type === "send" ? lab.tx : undefined;
  const table = (sw: EthSwitch) => net.fdb[sw].map((e) => `${who(e.mac)} → ${e.port} (${net.clock - e.lastSeen} s)`).join(" · ") || "empty";
  const decision = (sw: EthSwitch) => {
    const d = tx?.decisions.find((x) => x.sw === sw);
    if (!d) return tx ? "no copy of the last frame" : "—";
    const kind = d.kind === "broadcast" ? "broadcast → flood" : d.kind === "unknown-unicast" ? "unknown unicast → flood" : "known unicast → forward";
    return `${kind}${d.egress.length ? ` out ${d.egress.join(", ")}` : " — no egress port"}`;
  };
  if (id === "SW1")
    return [
      ...SW1_PORTS.map((p): [string, string] => {
        const n = sw1PortNeighbor(net, p);
        return [p, n ? `${n} · up` : net.downPorts.includes(`SW1 ${p}`) ? "DOWN (no link)" : "—"];
      }),
      [`Table (${net.fdb.SW1.length})`, table("SW1")],
      ["Last frame", decision("SW1")],
    ];
  if (id === "DESK-SW")
    return [
      ["Management", "none — unmanaged switch (simulation view)"],
      ...DESK_PORTS.map((p): [string, string] => {
        const n = deskPortNeighbor(net, p);
        return [p, n ? `${n}${n === "SW1" ? " ge-0/0/4" : ""} · up` : "empty"];
      }),
      [`Table (${net.fdb["DESK-SW"].length})`, table("DESK-SW")],
      ["Last frame", decision("DESK-SW")],
    ];
  const host = id as EthHost;
  const at = hostAttachment(net, host);
  const got = tx?.received.find((r) => r.host === host);
  return [
    ["MAC", ETH_MAC[host]],
    ["Plugged into", `${at.sw} ${at.port}`],
    ["Last frame", !tx ? "—" : tx.src === host ? "sent it" : got ? (got.accepted ? "received · accepted" : "received a flooded copy · discarded") : "no copy received"],
  ];
}

function copyNotes(lab: EthLabState, seg: EthSegment): Record<string, string> {
  const dst = lab.tx!.frame.layers[0].fields.find((f) => f.label === "Destination MAC")!.value;
  const to = seg.to;
  const dstNote =
    to === "SW1" || to === "DESK-SW"
      ? `${to} looks this up in its own table`
      : dst === BROADCAST_MAC
        ? "broadcast — every receiving host accepts"
        : dst === ETH_MAC[to as EthHost]
          ? `${to}'s own MAC → accepted`
          : `${who(dst)}, not ${to} → discarded`;
  return { "Destination MAC": dstNote, "Source MAC": "what each switch learns, against its ingress port" };
}

interface EthernetLabWorkspaceProps {
  open: boolean;
  onClose: () => void;
}

export function EthernetLabWorkspace({ open, onClose }: EthernetLabWorkspaceProps) {
  const runner = useLabRunner(ETH_LAB_MODEL, { segmentMs: ETH_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [cursor, setCursor] = useState(0);
  const [freePlay, setFreePlay] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, string[]>>({});
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<EthDevice | undefined>(undefined);
  const [packetSeg, setPacketSeg] = useState<string | undefined>(undefined);
  const [openWhy, setOpenWhy] = useState<string | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [composer, setComposer] = useState<{ src: EthHost; dst: EthHost | "broadcast" }>({ src: "HOST-A", dst: "HOST-B" });
  /** SW1's terminal: one session per vendor (same lab state, separate transcript/history/input). */
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [cliFocus, setCliFocus] = useState(0);

  const inFlight = isInFlight(lab);
  const busy = inFlight || runner.busy;
  const next = !freePlay ? ETH_LAB_SCRIPT[cursor] : undefined;
  const prev = cursor > 0 ? ETH_LAB_SCRIPT[cursor - 1] : undefined;
  const unanswered = next?.predict?.some((p) => !(answers[p.id]?.length));
  const tx = lab.tx;
  const showFrame = !!tx && (lab.last?.type === "send" || !!runner.replayFrame);
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

  function inspectDevice(id: EthDevice) {
    setSelected(id);
    setPacketSeg(undefined);
    markSeen(`dev:${id}`);
  }
  /** A click always opens (and counts as inspecting) the device card; it closes with its × button. */
  function selectDevice(id: string) {
    inspectDevice(id as EthDevice);
  }
  function inspectCopy(segId: string) {
    setPacketSeg(segId);
    setSelected(undefined);
    markSeen(`pkt:${segId}`);
  }

  function act(action: EthLabAction) {
    setPacketSeg(undefined);
    runner.run(action);
  }
  function performNext() {
    if (!next || busy || gate) return;
    if (next.repair) {
      // The learner's chosen fix; the lesson's applyEthRepair decides whether it changes anything.
      const choice = answer("repair-choice")[0];
      act({ type: "repair", choice });
      if (choice === ETH_REPAIR_CORRECT) setCursor((c) => c + 1);
      return;
    }
    setRevealed((r) => ({ ...r, ...ethRevealFor(next, lab) }));
    setCursor((c) => c + 1);
    act(next.action);
  }
  function sendComposed() {
    if (busy || composer.src === composer.dst) return;
    act({ type: "send", src: composer.src, dst: composer.dst });
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
  }
  /** Only successfully executed commands are reported (never Tab or `?`); mid-flight output can't prove a result. */
  function onExecuted(e: CliExecutedEvent) {
    markSeen(`cli:${e.commandId}`);
  }
  function putCommand(v: CliVendor, text: string) {
    setVendor(v);
    setCliSessions((m) => withSessionInput(m, cliSessionKey(v, SW1_HOSTNAME), text));
    setMobileTab("cli");
    setCliFocus((n) => n + 1);
  }
  function openCli() {
    setMobileTab("cli");
    setCliFocus((n) => n + 1);
  }
  function onWhy(id: string | undefined) {
    setOpenWhy(id);
    if (id) markSeen(`card:${id.startsWith("SW1") ? "SW1" : "DESK-SW"}`);
  }

  const ctx = { lab, seen, seenSince, answer, onAnswer, onInspectDevice: inspectDevice, onInspectCopy: inspectCopy, onPutCommand: putCommand };
  const solved = ethIncidentSolved(ctx);
  const gate = unanswered
    ? "Answer the prediction above first"
    : next?.repair && !solved
      ? "Finish the investigation first: evidence, hypothesis, test"
      : next?.repair && !answer("repair-choice").length
        ? "Choose a fix above"
        : undefined;
  const revealStale = freePlay || cursor > ETH_LAB_REPAIR_INDEX || solved;
  const cliSets = ethernetSw1CliSets(lab.net);
  const checksDone = prev ? ethStepChecksDone(prev.id, ctx) : true;
  const loop = inFlight ? 2 : freePlay ? -1 : !checksDone ? 3 : unanswered ? 0 : next ? 1 : -1;
  const stage = prev?.stage ?? 0;

  const packets: LabPacketView[] =
    showFrame && tx
      ? ethVisibleSegments(tx, shownWave).map(({ seg, moving }) => {
          const bcast = tx.dst === "broadcast";
          const base = bcast ? `${letter(tx.src)}→all` : `${letter(tx.src)}→${letter(tx.dst as EthHost)}`;
          const rest = seg.outcome === "accepted" ? { label: `✓ ${base}`, color: COLOR.accepted } : seg.outcome === "discarded" ? { label: "✗ discard", color: COLOR.discarded } : { label: seg.outcome === "filtered" ? "filtered" : "no port", color: COLOR.stop };
          return {
            id: `${tx.id}:${seg.id}:${runner.replayFrame?.id ?? "live"}`,
            path: [seg.from, seg.to],
            hop: moving ? 0 : 1,
            done: !moving,
            label: moving ? base : rest.label,
            color: moving ? (bcast ? COLOR.broadcast : COLOR.unicast) : rest.color,
            description: `${tx.frame.summary} — copy ${seg.from} ${seg.egress} → ${seg.to}${seg.outcome && !moving ? ` (${seg.outcome})` : ""}`,
            onSelect: () => inspectCopy(seg.id),
          };
        })
      : [];
  const movingIds = packets.filter((p) => !p.done).flatMap((p) => p.path);

  const nodeTags: Record<string, string> = {};
  if (lab.last?.type === "send" && tx && !runner.replayFrame)
    tx.learned.forEach((l) => {
      if (l.kind !== "refreshed") nodeTags[l.sw] = `${nodeTags[l.sw] ? `${nodeTags[l.sw]} ` : ""}+ ${who(l.mac)}`;
    });
  const cues: string[] = [];
  if (lab.last?.type === "send" && tx) {
    tx.decisions.forEach((d) => cues.push(`${d.sw}: ${d.kind === "broadcast" ? "BROADCAST → flood" : d.kind === "unknown-unicast" ? "UNKNOWN UNICAST → flood" : "KNOWN UNICAST → one port"}${d.egress.length ? "" : " · no egress"}`));
    if (tx.wave >= tx.waves && tx.dst !== "broadcast" && !tx.received.some((r) => r.host === tx.dst && r.accepted)) cues.push(`Frame lost — ${tx.dst} never received it`);
  } else if (lab.last?.type === "move-b") cues.push(lab.last.to === "desk" ? "SW1 ge-0/0/2 DOWN · HOST-B behind DESK-SW" : "SW1 ge-0/0/2 UP · DESK-SW port 2 DOWN");
  else if (lab.last?.type === "time") cues.push(`t=${lab.net.clock} s · ${lab.last.expired.length} expired`);

  const pktSeg = packetSeg && tx ? tx.segments.find((g) => g.id === packetSeg) : undefined;
  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={compact ? compactNodes(lab.net) : ethNodes(lab.net)}
      edges={ethEdges(lab.net).map((e) => ({ ...e, state: "full" as const }))}
      regions={ETH_REGIONS}
      activeNodeIds={movingIds}
      selectedNodeId={selected}
      onNodeClick={selectDevice}
      packets={packets}
      segmentMs={ETH_LAB_SEGMENT_MS}
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

  const select = (value: string, onChange: (v: string) => void, options: string[], label: string) => (
    <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  const smallBtn = (label: string, onClick: () => void, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-full border border-pv-border px-2.5 py-1 text-[11px] font-semibold text-pv-text-muted hover:text-pv-text disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      {label}
    </button>
  );

  const topologyFooter = (
    <>
      {selected && (
        <LabDeviceDetails
          title={selected === "DESK-SW" ? "DESK-SW · simulation view" : selected === "SW1" ? "SW1 · managed switch" : selected}
          rows={deviceRows(selected, lab)}
          onClose={() => setSelected(undefined)}
          action={selected === "SW1" ? <InspectInCliButton onClick={openCli} /> : undefined}
        />
      )}
      {pktSeg && tx && (
        <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5">
          <button type="button" onClick={() => setPacketSeg(undefined)} aria-label="Close packet fields" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
            ×
          </button>
          <p className="mb-1.5 pr-5 text-[12px] font-semibold text-pv-text">
            Copy {pktSeg.from} {pktSeg.egress} → {pktSeg.to}
            {pktSeg.outcome && <span className="ml-1.5 font-normal text-pv-text-muted">· {pktSeg.outcome}</span>}
          </p>
          <LabPacketFields packet={tx.frame} notes={copyNotes(lab, pktSeg)} />
        </div>
      )}
      {freePlay && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Free play controls">
          {select(composer.src, (v) => setComposer((c) => ({ ...c, src: v as EthHost })), ETH_HOSTS, "From")}
          {select(composer.dst, (v) => setComposer((c) => ({ ...c, dst: v as EthHost | "broadcast" })), [...ETH_HOSTS.filter((h) => h !== composer.src), "broadcast"], "To")}
          {smallBtn("+60 s", () => act({ type: "time", seconds: 60 }), busy)}
          {smallBtn("+310 s", () => act({ type: "time", seconds: 310 }), busy)}
          {lab.net.hostB === "SW1 ge-0/0/2" ? smallBtn("Move HOST-B to hot desk", () => act({ type: "move-b", to: "desk" }), busy) : smallBtn("Move HOST-B back to SW1", () => act({ type: "move-b", to: "sw1" }), busy)}
          {smallBtn("Clear SW1 entry for HOST-B", () => act({ type: "clear-b" }), busy)}
        </div>
      )}
    </>
  );

  const primaryAction = (compact: boolean) =>
    freePlay ? (
      <Button size="sm" onClick={sendComposed} disabled={busy || composer.src === composer.dst}>
        Send {compact ? "" : `${composer.src} → ${composer.dst}`} →
      </Button>
    ) : next ? (
      <Button size="sm" onClick={performNext} disabled={busy || !!gate} title={gate}>
        {compact ? next.label.replace(/^Send |^Verify: /, "") : next.label} →
      </Button>
    ) : null;

  const controls = (
    <>
      {smallBtn("↻ Replay frame", () => tx && runner.replay(tx.waves), !tx || lab.last?.type !== "send" || busy)}
      {smallBtn("Inspect packet", () => tx && inspectCopy(tx.segments[0].id), !tx || lab.last?.type !== "send" || inFlight)}
      {!freePlay && smallBtn("Skip to free play", () => setFreePlay(true), busy)}
    </>
  );

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Ethernet Lab"
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={ETH_LAB_STAGES.map((label, i) => ({ id: `t${i}`, label }))}
      currentStage={stage}
      stageSuffix={freePlay ? <span className="rounded-full border border-pv-violet/50 px-2 py-0.5 text-[11px] font-semibold text-pv-violet">Free play</span> : undefined}
      loop={{ labels: LOOP, current: loop }}
      primaryAction={primaryAction}
      topology={topology}
      topologyClassName="h-[520px] sm:h-[clamp(220px,34vh,320px)]"
      topologyFooter={topologyFooter}
      controls={controls}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{lab.log[lab.log.length - 1]?.text}</p>}
      board={<EthernetLabBoard {...ctx} revealed={revealed} cursor={cursor} freePlay={freePlay} inFlight={inFlight} gate={gate} />}
      liveState={
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <LiveStateCard title="SW1 forwarding table" caption="MAC → PORT · AGE" rows={fdbRows(lab, "SW1", revealStale)} pulseKey={lab.seq} openWhy={openWhy} onWhy={onWhy} whyHeading="Why is this entry here?" />
          <LiveStateCard title="DESK-SW table · Simulation view" caption="UNMANAGED · NO MGMT INTERFACE" rows={fdbRows(lab, "DESK-SW", revealStale)} pulseKey={lab.seq} openWhy={openWhy} onWhy={onWhy} whyHeading="Why is this entry here?" />
          <p className="text-[10.5px] text-pv-text-faint sm:col-span-2 lg:col-span-1 xl:col-span-2">
            Lab clock t={lab.net.clock} s · aging time {FDB_AGING_SEC} s · DESK-SW has no management interface — its table is shown from the simulation.
          </p>
        </div>
      }
      eventLog={<LabEventLog entries={lab.log} />}
      cliHeader={<p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">SW1 CLI · managed switch · DESK-SW is unmanaged (no CLI) · hosts have no switch CLI</p>}
      cli={
        <CLITerminal
          commandSets={cliSets}
          sessions={cliSessions}
          onSessionsChange={setCliSessions}
          focusRequest={cliFocus}
          vendor={vendor}
          onVendorChange={setVendor}
          deviceRole="Access Switch"
          contextLabel={`Ethernet Lab · T${stage} ${ETH_LAB_STAGES[stage]}`}
          onExecuted={onExecuted}
          stateVersion={runner.revision}
          footer="PacketVerse CLI supports the commands relevant to this lesson (read-only). Cisco names SW1's ports Gi1/0/1–4; Junos and this lesson call them ge-0/0/1–4."
        />
      }
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    />
  );
}
