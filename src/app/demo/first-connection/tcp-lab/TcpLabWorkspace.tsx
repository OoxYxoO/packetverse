"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { LabDeviceDetails } from "@/components/practice-lab/LabDeviceDetails";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import { Button } from "@/components/ui/Button";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { ADDR, DEVICE_HOSTNAME, GRAPH_LINKS, GRAPH_NODES } from "@/lib/sim-engine/scenarios/firstConnection";
import { TCP_LAB_CONNS, TCP_LAB_MODEL, TCP_LAB_PAYLOADS, TCP_LAB_PATH, currentRecord, epText, isInFlight, tcbFor, tcpLabPacket, type TcpCaptureRecord, type TcpConnId, type TcpHost, type TcpLabAction, type TcpLabNode, type TcpLabState } from "@/lib/sim-engine/scenarios/tcpLab";
import { TCP_LAB_REPAIR_INDEX, TCP_LAB_SCRIPT, TCP_LAB_STAGES, TCP_REPAIR_CORRECT, TcpLabBoard, tcpIncidentSolved, tcpRevealFor, tcpStepChecksDone } from "./TcpLabBoard";
import { TcpByteBar, TcpLadder, TcpSocketCards } from "./TcpLabConnection";
import { TcpCapture, fieldNotes, type TcpCaptureView } from "./TcpLabCapture";

/**
 * TCP Lab workspace — the TCP composition of the generic Practice Lab framework, on the first-connection network
 * (Laptop → SW1 → R1 → Server), sharing the page with the ARP Lab but nothing else: its own runner and state.
 *
 *   generic (framework):  PracticeLabShell (tabLabels: Topology / Connection / Capture) · useLabRunner timing,
 *                         Replay, Reset · LabTopology · LabEventLog · LabDeviceDetails · LabPacketFields · board primitives
 *   TCP (here):           TCP_LAB_MODEL truth · script, predictions, checks, incident · socket cards, exchange ladder,
 *                         byte bar · capture points · segment → marker mapping · free play
 *
 * No CLI: the endpoints are hosts, not Cisco/Junos devices. Operational evidence = sockets, captures, segment fields.
 * State isolation: nothing here receives the ScenarioEngine, the guided snapshot, the ARP Lab or the progress store.
 */

export const TCP_LAB_SEGMENT_MS = 1000;
const LOOP = ["Predict", "Send", "Observe", "Verify"];
const COLOR = { tcp: "#a78bfa", ok: "#10b981", lost: "#f87171", rst: "#f59e0b" };
const LAB_LABEL: Record<TcpLabNode, string> = { laptop: "Laptop", switch: DEVICE_HOSTNAME.switch, router: DEVICE_HOSTNAME.router, server: "Server" };
const NODES = GRAPH_NODES.map((n) => ({ ...n, label: LAB_LABEL[n.id], subLabel: n.id === "laptop" ? ADDR.laptop.ip : n.id === "server" ? ADDR.server.ip : n.id === "router" ? "routes · TTL −1" : "forwards frames" }));
/** Phone layout of the SAME chain: a gentle zig-zag; the right-most node stays at x ≤ 76 % so marker pills don't wrap. */
const COMPACT_POS: Record<string, { x: number; y: number }> = { laptop: { x: 15, y: 28 }, switch: { x: 35, y: 72 }, router: { x: 56, y: 28 }, server: { x: 76, y: 72 } };
const EDGES = GRAPH_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, label: l.id === "router-server" ? "10.20.20.0/24" : l.id === "switch-router" ? "192.168.10.0/24" : undefined, state: "full" as const }));

const marker = (r: TcpCaptureRecord) => {
  const f = r.seg.flags;
  return f.includes("RST") ? "RST" : f.includes("SYN") ? (f.includes("ACK") ? "SYN-ACK" : "SYN") : r.seg.payload ? `DATA ${r.seg.payload.length}B` : "ACK";
};
const hostOf = (n: TcpLabNode): TcpHost | undefined => (n === "laptop" ? "client" : n === "server" ? "server" : undefined);

function deviceRows(id: TcpLabNode, lab: TcpLabState): [string, string][] {
  const sockets = (h: TcpHost) => lab.sockets[h].map((t): [string, string] => [t.state === "LISTEN" ? `*:${t.local.port}` : `:${t.local.port} ↔ ${t.remote ? epText(t.remote) : "*"}`, `${t.error === "refused" ? "CLOSED (refused)" : t.state}${t.rcvNxt !== undefined ? ` · RCV.NXT ${t.rcvNxt}` : ""}${t.sndNxt !== undefined ? ` · SND.NXT ${t.sndNxt}` : ""}`]);
  if (id === "laptop") return [["IP / MAC", `${ADDR.laptop.ip} · ${ADDR.laptop.mac}`], ["Role", "TCP client (opens connections)"], ...sockets("client"), ...(lab.sockets.client.length ? [] : ([["TCP sockets", "none yet"]] as [string, string][]))];
  if (id === "server") return [["IP / MAC", `${ADDR.server.ip} · ${ADDR.server.mac}`], ["Role", "TCP server (listens)"], ...sockets("server")];
  if (id === "router") return [["Interfaces", `${ADDR.gateway.ip} (LAN) · ${ADDR.routerWan.ip} (Server side)`], ["Does", "routes IPv4, builds a new Ethernet header, decrements the TTL"], ["TCP", "not an endpoint: it keeps no TCP connection state and reads no ports or sequence numbers"]];
  return [["Does", "forwards Ethernet frames by MAC (Laptop ↔ R1)"], ["TCP", "never looks above the Ethernet header"]];
}

export function TcpLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(TCP_LAB_MODEL, { segmentMs: TCP_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [before, setBefore] = useState<TcpLabState | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [freePlay, setFreePlay] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, string[]>>({});
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<TcpLabNode | undefined>(undefined);
  const [segNo, setSegNo] = useState<number | undefined>(undefined);
  const [capView, setCapView] = useState<TcpCaptureView>("laptop");
  const [capSel, setCapSel] = useState<number | undefined>(undefined);
  const [ladderConn, setLadderConn] = useState<TcpConnId>("main");
  const [openWhy, setOpenWhy] = useState<string | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [repairTried, setRepairTried] = useState<string | undefined>(undefined);
  const [dropNext, setDropNext] = useState(false);
  const [fpConn, setFpConn] = useState<TcpConnId>("main");

  const inFlight = isInFlight(lab);
  const busy = inFlight || runner.busy;
  const next = !freePlay ? TCP_LAB_SCRIPT[cursor] : undefined;
  const prev = cursor > 0 ? TCP_LAB_SCRIPT[cursor - 1] : undefined;
  const unanswered = next?.predict?.some((p) => !answers[p.id]?.length);
  const rec = currentRecord(lab);

  /** Inspections count only after the latest event has fully landed. */
  const seen = (key: string) => seenKeys.has(`${lab.seq}|${key}`);
  const seenSince = (fromSeq: number, key: string) => [...seenKeys].some((k) => k.endsWith(`|${key}`) && Number(k.slice(0, k.indexOf("|"))) >= fromSeq);
  function markSeen(key: string) {
    if (inFlight) return;
    const k = `${lab.seq}|${key}`;
    if (!seenKeys.has(k)) setSeenKeys((s) => new Set([...s, k]));
  }
  const answer = (key: string) => answers[key] ?? [];
  const onAnswer = (key: string, v: string[]) => setAnswers((a) => ({ ...a, [key]: v }));

  function inspectDevice(id: TcpLabNode) {
    setSelected(id);
    setSegNo(undefined);
    markSeen(`dev:${id}`);
  }
  function inspectSegment(no: number) {
    setSegNo(no);
    setSelected(undefined);
    markSeen(`pkt:${no}`);
  }
  function viewCapture(v: TcpCaptureView) {
    setCapView(v);
    setCapSel(undefined);
    setMobileTab("cli");
    markSeen(`cap:${v}`);
  }
  function selectCaptureRow(no: number | undefined) {
    setCapSel(no);
    if (no !== undefined) markSeen(`pkt:${no}`);
  }
  /** LiveStateCard ids are "<card title>:<row key>"; the socket cards are titled "Laptop sockets…" / "Server sockets…". */
  function onWhy(id: string | undefined) {
    setOpenWhy(id);
    if (id?.startsWith("Laptop sockets")) markSeen("card:client");
    if (id?.startsWith("Server sockets")) markSeen("card:server");
  }
  function act(action: TcpLabAction) {
    setSegNo(undefined);
    setBefore(lab);
    runner.run(action);
  }

  const ctxBase = { lab, before, seen, seenSince, answer, onAnswer, onInspectDevice: inspectDevice, onInspectSegment: inspectSegment, onViewCapture: viewCapture };
  const solved = tcpIncidentSolved({ ...ctxBase, concealFault: true });
  const concealFault = !(freePlay || cursor > TCP_LAB_REPAIR_INDEX || solved);
  const ctx = { ...ctxBase, concealFault };
  const gate = unanswered ? "Answer the prediction above first" : next?.repair && !solved ? "Finish the investigation first: evidence, hypothesis, test" : next?.repair && !answer("repair-choice").length ? "Choose a fix above" : undefined;

  function performNext() {
    if (!next || busy || gate) return;
    if (next.repair) {
      // Only the proven fix exists as a lab action; the others change nothing (and are explained on the board).
      const choice = answer("repair-choice")[0];
      setRepairTried(choice);
      if (choice !== TCP_REPAIR_CORRECT) return;
      act(next.action);
      setCursor((c) => c + 1);
      return;
    }
    setRevealed((r) => ({ ...r, ...tcpRevealFor(next, lab) }));
    setCursor((c) => c + 1);
    if (next.id === "t6" || next.id === "t7-syn") setLadderConn(next.id === "t6" ? "refused" : "incident");
    act(next.action);
  }
  function reset() {
    runner.reset();
    setBefore(undefined);
    setCursor(0);
    setFreePlay(false);
    setAnswers({});
    setRevealed({});
    setSeenKeys(new Set());
    setSelected(undefined);
    setSegNo(undefined);
    setCapView("laptop");
    setCapSel(undefined);
    setLadderConn("main");
    setOpenWhy(undefined);
    setRepairTried(undefined);
    setDropNext(false);
    setFpConn("main");
  }

  const checksDone = prev ? tcpStepChecksDone(prev.id, ctx) : true;
  const loop = inFlight ? 2 : freePlay ? -1 : !checksDone ? 3 : unanswered ? 0 : next ? 1 : -1;
  const stage = prev?.stage ?? 0;

  // ------------------------------------------------------------- topology marker for the latest segment
  const packetsFor = (): LabPacketView[] => {
    if (!rec || lab.last?.type !== "send" || lab.last.no !== rec.no) return [];
    const full = TCP_LAB_PATH[rec.dir];
    const hidden = concealFault && rec.drop?.reason === "return-path-fault";
    // Incident (unproven): show only that the Server sent it — where it stopped is for the learner to find.
    const path = hidden ? full.slice(0, 1) : rec.outcome === "dropped" ? full.slice(0, (lab.tx?.hops ?? 0) + 1) : full;
    const hop = hidden ? 0 : runner.replayFrame ? runner.replayFrame.hop : (lab.tx?.hop ?? path.length - 1);
    const done = hidden || hop >= path.length - 1;
    const rest = hidden ? { label: `${marker(rec)} sent`, color: COLOR.tcp } : rec.outcome === "dropped" ? { label: `✕ ${marker(rec)} lost`, color: COLOR.lost } : { label: `✓ ${marker(rec)}`, color: rec.seg.flags.includes("RST") ? COLOR.rst : COLOR.ok };
    return [{ id: `${rec.no}:${runner.replayFrame?.id ?? "live"}`, path, hop: Math.min(hop, path.length - 1), done, label: done ? rest.label : marker(rec), color: done ? rest.color : COLOR.tcp, description: `Segment #${rec.no}: ${rec.seg.flags.join(", ")} seq=${rec.seg.seq}${rec.seg.ack !== undefined ? ` ack=${rec.seg.ack}` : ""}`, onSelect: () => inspectSegment(rec.no) }];
  };
  const packets = packetsFor();
  const movingIds = packets.filter((p) => !p.done).flatMap((p) => p.path);
  const cues: string[] = [];
  if (rec && lab.last?.type === "send") {
    const c = tcbFor(lab, "client", rec.conn);
    const s = tcbFor(lab, "server", rec.conn);
    cues.push(`Laptop: ${c ? (c.error === "refused" ? "CLOSED (refused)" : c.state) : "—"}`, `Server: ${s ? s.state : rec.conn === "refused" ? "no connection" : "LISTEN"}`);
  } else if (lab.last?.type === "fault") cues.push("Ticket open: “the site never loads”");
  else if (lab.last?.type === "repair") cues.push("R1 return path restored — not verified yet");

  const topologyFor = (compact: boolean) => (
    <LabTopology nodes={compact ? NODES.map((n) => ({ ...n, ...COMPACT_POS[n.id] })) : NODES} edges={compact ? EDGES.map((e) => ({ ...e, label: undefined })) : EDGES} activeNodeIds={movingIds} selectedNodeId={selected} onNodeClick={(id) => inspectDevice(id as TcpLabNode)} packets={packets} segmentMs={TCP_LAB_SEGMENT_MS} cues={cues} />
  );
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );

  const seg = segNo !== undefined ? lab.capture[segNo - 1] : undefined;
  const smallBtn = (label: string, onClick: () => void, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-full border border-pv-border px-2.5 py-1 text-[11px] font-semibold text-pv-text-muted hover:text-pv-text disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      {label}
    </button>
  );
  const hostTcb = (h: TcpHost) => tcbFor(lab, h, fpConn);
  const topologyFooter = (
    <>
      {selected && <LabDeviceDetails title={`${LAB_LABEL[selected]}${hostOf(selected) ? ` · TCP ${hostOf(selected)}` : ""}`} rows={deviceRows(selected, lab)} onClose={() => setSelected(undefined)} />}
      {seg && (
        <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5">
          <button type="button" onClick={() => setSegNo(undefined)} aria-label="Close segment fields" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
            ×
          </button>
          <p className="mb-1.5 pr-5 text-[12px] font-semibold text-pv-text">
            Segment #{seg.no} as it left the {seg.dir === "c2s" ? "Laptop" : "Server"}
            {seg.retransmission && <span className="ml-1.5 text-[11px] font-normal text-pv-warning">· retransmission</span>}
          </p>
          <LabPacketFields packet={tcpLabPacket(seg, 0)} notes={fieldNotes(seg)} />
          <p className="mt-1.5 text-[10.5px] text-pv-text-faint">Captures (Capture tab) show the same segment on each link: R1 rewrites the Ethernet header and the TTL; TCP fields never change in transit.</p>
        </div>
      )}
      {freePlay && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Free play controls">
          <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
            Connection
            <select value={fpConn} onChange={(e) => setFpConn(e.target.value as TcpConnId)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
              {(Object.keys(TCP_LAB_CONNS) as TcpConnId[]).map((c) => (
                <option key={c} value={c}>
                  :{TCP_LAB_CONNS[c].clientPort} → :{TCP_LAB_CONNS[c].serverPort}
                </option>
              ))}
            </select>
          </label>
          {!hostTcb("client") && smallBtn("Open (SYN)", () => act({ type: "connect", conn: fpConn }), busy)}
          {smallBtn(`Send “${TCP_LAB_PAYLOADS.first}”`, () => act({ type: "send-data", conn: fpConn, payload: TCP_LAB_PAYLOADS.first, dropAtR1: dropNext }), busy || hostTcb("client")?.state !== "ESTABLISHED")}
          {smallBtn(`Send “${TCP_LAB_PAYLOADS.second}”`, () => act({ type: "send-data", conn: fpConn, payload: TCP_LAB_PAYLOADS.second, dropAtR1: dropNext }), busy || hostTcb("client")?.state !== "ESTABLISHED")}
          <label className="flex items-center gap-1 text-[11px] text-pv-text-muted">
            <input type="checkbox" checked={dropNext} onChange={(e) => setDropNext(e.target.checked)} /> drop data at R1
          </label>
          {smallBtn(`Deliver next reply${lab.pending.length ? ` (${lab.pending.length})` : ""}`, () => act({ type: "deliver" }), busy || !lab.pending.length)}
          {smallBtn("Laptop timer expires", () => act({ type: "timer", host: "client", conn: fpConn }), busy || !hostTcb("client")?.unacked.length)}
          {smallBtn("Server timer expires", () => act({ type: "timer", host: "server", conn: fpConn }), busy || !hostTcb("server")?.unacked.length)}
          {lab.returnPathFault ? smallBtn("Restore R1 return path", () => act({ type: "repair" }), busy) : smallBtn("Break R1 return path", () => act({ type: "fault" }), busy)}
        </div>
      )}
    </>
  );

  const primaryAction = (compact: boolean) =>
    !freePlay && next ? (
      <Button size="sm" onClick={performNext} disabled={busy || !!gate} title={gate} className={compact ? "whitespace-nowrap" : undefined}>
        {compact ? next.short : next.label} →
      </Button>
    ) : null;

  const controls = (
    <>
      {smallBtn("↻ Replay segment", () => lab.tx && runner.replay(lab.tx.hops), !lab.tx || !lab.tx.hops || busy || lab.last?.type !== "send" || (concealFault && rec?.drop?.reason === "return-path-fault"))}
      {smallBtn("Inspect segment", () => rec && inspectSegment(rec.no), !rec || inFlight)}
      {!freePlay && smallBtn(next ? "Skip to free play" : "Free play", () => setFreePlay(true), busy)}
    </>
  );

  const conns = (Object.keys(TCP_LAB_CONNS) as TcpConnId[]).filter((c) => lab.capture.some((r) => r.conn === c));
  const freshKeys = new Set<string>();
  if (before && !inFlight)
    (["client", "server"] as TcpHost[]).forEach((h) =>
      lab.sockets[h].forEach((t) => {
        const b = before.sockets[h].find((x) => x.conn === t.conn && x.local.port === t.local.port);
        if (!b || JSON.stringify(b) !== JSON.stringify(t)) freshKeys.add(`${h} ${t.conn ?? "listen"}`);
      }),
    );

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="TCP Lab"
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={TCP_LAB_STAGES.map((label, i) => ({ id: `t${i}`, label }))}
      currentStage={stage}
      stageSuffix={freePlay ? <span className="rounded-full border border-pv-violet/50 px-2 py-0.5 text-[11px] font-semibold text-pv-violet">Free play</span> : undefined}
      loop={{ labels: LOOP, current: loop }}
      primaryAction={primaryAction}
      topology={topology}
      topologyClassName="h-[300px] sm:h-[clamp(200px,30vh,280px)]"
      topologyFooter={topologyFooter}
      controls={controls}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{lab.log[lab.log.length - 1]?.text}</p>}
      board={<TcpLabBoard {...ctx} revealed={revealed} cursor={cursor} freePlay={freePlay} inFlight={inFlight} gate={gate} repairTried={next?.repair ? repairTried : undefined} />}
      liveState={
        <div className="space-y-2">
          <TcpSocketCards lab={lab} freshKeys={freshKeys} openWhy={openWhy} onWhy={onWhy} />
          <section className="rounded-xl border border-pv-border p-2.5" aria-label="Exchange ladder">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <p className="mr-auto text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">Exchange ladder</p>
              {conns.map((c) => (
                <button key={c} type="button" onClick={() => setLadderConn(c)} aria-pressed={ladderConn === c} className={clsx("rounded-full border px-2 py-0.5 text-[10.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", ladderConn === c ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted")}>
                  :{TCP_LAB_CONNS[c].clientPort}→:{TCP_LAB_CONNS[c].serverPort}
                </button>
              ))}
            </div>
            <TcpLadder lab={lab} conn={ladderConn} selectedNo={segNo} onSelect={inspectSegment} concealFault={concealFault} />
          </section>
          <TcpByteBar lab={lab} conn={ladderConn} />
          <p className="text-[10.5px] text-pv-text-faint">Values come from the lab&apos;s TCP model. Not simulated: window, checksum, options (MSS…), timer durations, FIN/close.</p>
        </div>
      }
      eventLog={<LabEventLog entries={lab.log.map((e) => ({ ...e, kind: e.kind === "state" ? ("learn" as const) : e.kind }))} />}
      cli={<TcpCapture lab={lab} view={capView} onView={viewCapture} selectedNo={capSel} onSelect={selectCaptureRow} concealFault={concealFault} />}
      cliHeader={<p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Capture · educational segment record at each capture point</p>}
      tabLabels={{ topology: "Topology", state: "Connection", cli: "Capture" }}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    />
  );
}
