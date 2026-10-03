"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  PracticeLabShell,
  type PracticeLabTab,
} from "@/components/practice-lab/PracticeLabShell";
import {
  LabTopology,
  type LabPacketView,
} from "@/components/practice-lab/LabTopology";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import {
  LabDeviceDetails,
  InspectInCliButton,
} from "@/components/practice-lab/LabDeviceDetails";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import {
  CLITerminal,
  type CliExecutedEvent,
  type CliSessionMap,
} from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import { Button } from "@/components/ui/Button";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { R1_ROUTES, maskOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import {
  INCOMPLETE,
  V4_LAB_BAD_GATEWAY,
  V4_LAB_HOSTS,
  V4_LAB_MODEL,
  V4_LAB_REPAIR_CORRECT,
  V4_LAB_PORTS,
  V4_STATIONS,
  fieldOf,
  v4CurrentRecord,
  v4IsInFlight,
  v4Owner,
  type V4Host,
  type V4LabAction,
  type V4LabDevice,
  type V4LabState,
} from "@/lib/sim-engine/scenarios/ipv4Lab";
import { V4_LAB_EDGES, V4_LAB_NODES, V4_REGIONS } from "../topology";
import { r1CliSets, r1InterfaceAlias } from "../cliAdapter";
import {
  V4_LAB_SCRIPT,
  V4_LAB_STAGES,
  V4LabBoard,
  v4ConfigInspected,
  v4IncidentSolved,
  v4RevealFor,
  v4StepChecksDone,
} from "./Ipv4LabBoard";
import { V4DecisionPanel, V4HostCard, V4RouterCard } from "./Ipv4LabDecision";
import { V4PacketDiff } from "./Ipv4LabPacketDiff";

/**
 * IPv4 Lab workspace — the IPv4 composition of the generic Practice Lab framework, on the IPv4 Basics network plus a
 * lab-only HOST-C. Its runner and state are its own; nothing here receives the ScenarioEngine, the guided snapshot or
 * the progress store.
 *
 *   generic (framework):  PracticeLabShell (tabLabels: Topology / Decision / R1 CLI) · useLabRunner timing, Replay,
 *                         Reset · LabTopology · LabEventLog · LabDeviceDetails · LabPacketFields · CLITerminal ·
 *                         board primitives
 *   IPv4 (here):          V4_LAB_MODEL truth · script, predictions, checks, incident · decision panel and bit view ·
 *                         host/R1 cards · before/after packet diff · R1 CLI adapter · frame → marker mapping · free play
 *
 * CLI: R1 only (the managed router), Cisco and Junos sessions. Hosts and switches get no Cisco/Junos CLI.
 */

export const V4_LAB_SEGMENT_MS = 900;
const LOOP = ["Predict", "Act", "Observe", "Verify"];
const COLOR = { arp: "#f59e0b", ip: "#60a5fa", ok: "#10b981", fail: "#f87171" };
const last = (ip: string) => `.${ip.split(".")[3]}`;
/** Phone layout of the SAME network (right-most node at x ≤ 76 % so marker pills don't wrap). */
const COMPACT_POS: Record<string, { x: number; y: number }> = {
  "HOST-A": { x: 12, y: 24 },
  "HOST-C": { x: 12, y: 80 },
  "SW-A": { x: 30, y: 52 },
  R1: { x: 50, y: 24 },
  "SW-B": { x: 63, y: 66 },
  "HOST-B": { x: 76, y: 30 },
};

export function Ipv4LabWorkspace({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const runner = useLabRunner(V4_LAB_MODEL, { segmentMs: V4_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [before, setBefore] = useState<V4LabState | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [freePlay, setFreePlay] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, string[]>>({});
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<V4LabDevice | undefined>(undefined);
  const [frameSel, setFrameSel] = useState<
    { rec: number; frame: number } | undefined
  >(undefined);
  const [diffRec, setDiffRec] = useState<number | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [repairTried, setRepairTried] = useState<string | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [cliFocus, setCliFocus] = useState(0);
  const [fpSrc, setFpSrc] = useState<V4Host>("HOST-A");
  const [fpDst, setFpDst] = useState<string>(V4_STATIONS["HOST-B"].ip);

  const inFlight = v4IsInFlight(lab);
  const busy = inFlight || runner.busy;
  const next = !freePlay ? V4_LAB_SCRIPT[cursor] : undefined;
  const prev = cursor > 0 ? V4_LAB_SCRIPT[cursor - 1] : undefined;
  const unanswered = next?.predict?.some((p) => !answers[p.id]?.length);
  const rec = v4CurrentRecord(lab);
  const recIndex = lab.tx?.rec;

  /** Inspections count only after the latest event has fully landed. */
  const seen = (key: string) => seenKeys.has(`${lab.seq}|${key}`);
  const seenSince = (fromSeq: number, key: string) =>
    [...seenKeys].some(
      (k) =>
        k.endsWith(`|${key}`) && Number(k.slice(0, k.indexOf("|"))) >= fromSeq,
    );
  function markSeen(key: string) {
    if (inFlight) return;
    const k = `${lab.seq}|${key}`;
    if (!seenKeys.has(k)) setSeenKeys((s) => new Set([...s, k]));
  }
  const answer = (key: string) => answers[key] ?? [];
  const onAnswer = (key: string, v: string[]) =>
    setAnswers((a) => ({ ...a, [key]: v }));

  function inspectDevice(id: V4LabDevice) {
    setSelected(id);
    setFrameSel(undefined);
    markSeen(`dev:${id}`);
  }
  function inspectDecision(src: V4Host) {
    setMobileTab("state");
    markSeen(`dec:${src}`);
  }
  function inspectConfig() {
    setSelected("HOST-A");
    setFrameSel(undefined);
    markSeen("cfg:HOST-A");
    markSeen("dev:HOST-A");
  }
  function inspectFrame(r: number, frame: number) {
    setFrameSel({ rec: r, frame });
    setSelected(undefined);
    setMobileTab("topology");
    markSeen(`pkt:${lab.records[r].id}-${frame}`);
  }
  function openDiff(r: number) {
    setDiffRec(r);
    setMobileTab("topology");
    markSeen(`diff:${lab.records[r].id}`);
  }
  function openCli() {
    setMobileTab("cli");
    setCliFocus((n) => n + 1);
  }
  function onExecuted(e: CliExecutedEvent) {
    markSeen(`cli:${e.commandId}`);
  }
  function act(action: V4LabAction) {
    setFrameSel(undefined);
    setDiffRec(undefined);
    setBefore(lab);
    runner.run(action);
  }

  const ctxBase = {
    lab,
    before,
    seen,
    seenSince,
    answer,
    onAnswer,
    onInspectDevice: inspectDevice,
    onInspectDecision: inspectDecision,
    onInspectConfig: inspectConfig,
    onInspectFrame: inspectFrame,
    onOpenDiff: openDiff,
  };
  const conceal =
    !freePlay &&
    lab.incident.active &&
    !lab.incident.repaired &&
    !v4ConfigInspected({ lab, seenSince });
  const ctx = { ...ctxBase, conceal };
  const solved = v4IncidentSolved(ctx);
  const gate = unanswered
    ? "Answer the prediction above first"
    : next?.repair && !solved
      ? "Finish the investigation first: evidence, hypothesis, test"
      : next?.repair && !answer("repair-choice").length
        ? "Choose a fix above"
        : undefined;

  function performNext() {
    if (!next || busy || gate) return;
    if (next.repair) {
      const choice = answer("repair-choice")[0];
      setRepairTried(choice);
      act({ type: "repair", choice });
      if (choice === V4_LAB_REPAIR_CORRECT) setCursor((c) => c + 1);
      return;
    }
    setRevealed((r) => ({ ...r, ...v4RevealFor(next, lab) }));
    setCursor((c) => c + 1);
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
    setFrameSel(undefined);
    setDiffRec(undefined);
    setRepairTried(undefined);
    setCliSessions({});
    setFpSrc("HOST-A");
    setFpDst(V4_STATIONS["HOST-B"].ip);
  }

  const checksDone = prev ? v4StepChecksDone(prev.id, ctx) : true;
  const loop = inFlight
    ? 2
    : freePlay
      ? -1
      : !checksDone
        ? 3
        : unanswered
          ? 0
          : next
            ? 1
            : -1;
  const stage = prev?.stage ?? 0;

  // ------------------------------------------------------------- frames on the topology
  const packets: LabPacketView[] = (() => {
    if (
      !rec ||
      recIndex === undefined ||
      lab.last?.type !== "traffic" ||
      !rec.waves.length
    )
      return [];
    const shown = runner.replayFrame
      ? runner.replayFrame.hop
      : (lab.tx?.wave ?? 0);
    const moving = shown < rec.waves.length;
    const wave = rec.waves[Math.min(shown, rec.waves.length - 1)];
    return wave.copies.map((c, i) => {
      const kind = rec.frameKinds[c.frame];
      const f = rec.frames[c.frame];
      const target =
        kind === "ipv4"
          ? last(fieldOf(f, /^IPv4/, "Destination"))
          : last(fieldOf(f, /^ARP/, "Target IP"));
      const label =
        kind === "arp-request"
          ? `ARP who-has ${target}?`
          : kind === "arp-reply"
            ? `ARP ${last(fieldOf(f, /^ARP/, "Sender IP"))} is-at`
            : `IPv4 → ${target}`;
      const rest =
        rec.result === "arp-failed" && kind === "arp-request"
          ? { label: "no ARP reply", color: COLOR.fail }
          : kind === "ipv4" && rec.result === "at-router"
            ? { label: `at R1 · IPv4 → ${target}`, color: COLOR.ip }
            : kind === "ipv4"
              ? { label: `✓ IPv4 delivered`, color: COLOR.ok }
              : { label, color: COLOR.arp };
      return {
        id: `${rec.id}:${shown}:${i}:${runner.replayFrame?.id ?? "live"}`,
        path: [c.from, c.to],
        hop: moving ? 0 : 1,
        done: !moving,
        label: moving ? label : rest.label,
        color: moving ? (kind === "ipv4" ? COLOR.ip : COLOR.arp) : rest.color,
        description: f.summary,
        onSelect: () => inspectFrame(recIndex, c.frame),
      };
    });
  })();
  const movingIds = packets.filter((p) => !p.done).flatMap((p) => p.path);
  const cues: string[] = [];
  if (
    lab.decision &&
    (lab.last?.type === "decide" || lab.last?.type === "traffic")
  )
    cues.push(
      `${lab.decision.src}: ${lab.decision.local ? "LOCAL" : "REMOTE"} → next hop ${lab.decision.nextHop}`,
    );
  if (lab.last?.type === "traffic" && rec)
    cues.push(
      rec.result === "delivered"
        ? `delivered to ${v4Owner(rec.dst)}`
        : rec.result === "at-router"
          ? "waiting at R1"
          : rec.result === "arp-failed"
            ? "ARP unanswered — nothing sent"
            : "no route",
    );

  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={
        compact
          ? V4_LAB_NODES.map((n) => ({ ...n, ...COMPACT_POS[n.id] }))
          : V4_LAB_NODES
      }
      edges={
        compact
          ? V4_LAB_EDGES.map((e) => ({ ...e, label: undefined }))
          : V4_LAB_EDGES
      }
      regions={compact ? [] : V4_REGIONS}
      activeNodeIds={movingIds}
      selectedNodeId={selected}
      onNodeClick={(id) => inspectDevice(id as V4LabDevice)}
      packets={packets}
      segmentMs={V4_LAB_SEGMENT_MS}
      cues={cues}
    />
  );
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );

  // ------------------------------------------------------------- device details
  function deviceRows(id: V4LabDevice): [string, string][] {
    if (id === "SW-A" || id === "SW-B")
      return [
        [
          "Ports",
          V4_LAB_PORTS[id].map((p) => `${p.port} → ${p.to}`).join(" · "),
        ],
        [
          "Does",
          "forwards Ethernet frames by MAC; floods broadcasts (like ARP requests)",
        ],
        ["IPv4", "never reads IPv4 addresses or masks"],
      ];
    if (id === "R1")
      return [
        ...R1_ROUTES.map((r): [string, string] => [
          `${r.iface} (${r1InterfaceAlias("cisco", r.iface)})`,
          `${r.addr} · connected ${r.prefix}`,
        ]),
        ["IPv4 routed", String(lab.r1Forwarded)],
        [
          "ARP cache",
          Object.entries(lab.arp.R1)
            .map(([ip, mac]) => `${ip} → ${mac}`)
            .join(" · ") || "empty",
        ],
        ["Proxy ARP", "off — answers ARP only for its own addresses"],
      ];
    const h = id as V4Host;
    const cfg = lab.config[h];
    const hide = conceal && h === "HOST-A";
    return [
      [
        "IPv4",
        hide
          ? `${V4_STATIONS[h].ip} / concealed — use “Inspect configuration”`
          : `${V4_STATIONS[h].ip}/${cfg.prefix} (${maskOf(cfg.prefix)})`,
      ],
      ["Gateway", cfg.gateway],
      ["MAC", V4_STATIONS[h].mac],
      [
        "ARP cache",
        Object.entries(lab.arp[h])
          .map(
            ([ip, mac]) => `${ip} → ${mac === INCOMPLETE ? "INCOMPLETE" : mac}`,
          )
          .join(" · ") || "empty",
      ],
      ["Packets received", String(lab.delivered[h])],
      ...(h === "HOST-C"
        ? ([["Note", "Practice-Lab-only host on SW-A p3"]] as [
            string,
            string,
          ][])
        : []),
    ];
  }

  const selFrame = frameSel
    ? lab.records[frameSel.rec]?.frames[frameSel.frame]
    : undefined;
  const diff = diffRec !== undefined ? lab.records[diffRec] : undefined;
  const smallBtn = (label: string, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-pv-border px-2.5 py-1 text-[11px] font-semibold text-pv-text-muted hover:text-pv-text disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
    >
      {label}
    </button>
  );
  const dstChoices = V4_LAB_HOSTS.filter((h) => h !== fpSrc).map(
    (h) => V4_STATIONS[h].ip,
  );
  const topologyFooter = (
    <>
      {selected && (
        <LabDeviceDetails
          title={selected === "HOST-C" ? "HOST-C · lab only" : selected}
          rows={deviceRows(selected)}
          onClose={() => setSelected(undefined)}
          action={
            selected === "R1" ? (
              <InspectInCliButton onClick={openCli} />
            ) : selected === "HOST-A" && conceal ? (
              <InspectInCliButton
                label="Inspect configuration →"
                onClick={inspectConfig}
              />
            ) : undefined
          }
        />
      )}
      {selFrame && (
        <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5">
          <button
            type="button"
            onClick={() => setFrameSel(undefined)}
            aria-label="Close frame fields"
            className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text"
          >
            ×
          </button>
          <p className="mb-1.5 pr-5 text-[12px] font-semibold text-pv-text">
            {selFrame.summary}
          </p>
          <LabPacketFields
            packet={selFrame}
            notes={
              selFrame.protocol === "ARP"
                ? { "Target IP": "the next hop chosen by the IPv4 decision" }
                : {
                    "Destination MAC": `the next hop on this link: ${v4Owner(fieldOf(selFrame, /^Ethernet/, "Destination MAC")) ?? "?"}`,
                    Destination: "the final destination — never the router",
                  }
            }
          />
        </div>
      )}
      {diff?.routing && diff.routing.outFrame >= 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setDiffRec(undefined)}
            aria-label="Close comparison"
            className="absolute right-2 top-1.5 z-10 text-pv-text-faint hover:text-pv-text"
          >
            ×
          </button>
          <V4PacketDiff
            before={diff.frames[diff.routing.inFrame]}
            after={diff.frames[diff.routing.outFrame]}
            why={{
              TTL: "R1 decrements TTL by one per hop",
              "Header Checksum":
                "recomputed because the TTL (part of the header) changed",
              "Source MAC": "R1's egress interface",
              "Destination MAC":
                "the next hop on the new link (resolved by R1's ARP)",
            }}
          />
        </div>
      )}
      {freePlay && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2"
          aria-label="Free play controls"
        >
          <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
            From
            <select
              value={fpSrc}
              onChange={(e) => {
                const s = e.target.value as V4Host;
                setFpSrc(s);
                if (V4_STATIONS[s].ip === fpDst)
                  setFpDst(V4_STATIONS[V4_LAB_HOSTS.find((h) => h !== s)!].ip);
              }}
              className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text"
            >
              {V4_LAB_HOSTS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
            To
            <select
              value={fpDst}
              onChange={(e) => setFpDst(e.target.value)}
              className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text"
            >
              {dstChoices.map((ip) => (
                <option key={ip} value={ip}>
                  {ip} ({v4Owner(ip)})
                </option>
              ))}
            </select>
          </label>
          {smallBtn(
            "Decide",
            () => act({ type: "decide", src: fpSrc, dst: fpDst }),
            busy,
          )}
          {smallBtn(
            "Send",
            () =>
              act({
                type: "send",
                src: fpSrc,
                dst: fpDst,
                throughRouter: true,
              }),
            busy || !!lab.r1Queue,
          )}
          {lab.r1Queue &&
            smallBtn(
              "R1 routes the waiting packet",
              () => act({ type: "route" }),
              busy,
            )}
          <span className="text-[11px] text-pv-text-faint">HOST-A prefix</span>
          {[24, 25, 26, 27].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => act({ type: "set-prefix", prefix: p })}
              disabled={busy}
              aria-pressed={lab.config["HOST-A"].prefix === p}
              className={clsx(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                lab.config["HOST-A"].prefix === p
                  ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft"
                  : "border-pv-border text-pv-text-muted",
              )}
            >
              /{p}
            </button>
          ))}
          {lab.config["HOST-A"].gateway === V4_LAB_BAD_GATEWAY
            ? smallBtn(
                "Restore gateway .1",
                () => act({ type: "set-gateway", gateway: V4_STATIONS.R1L.ip }),
                busy,
              )
            : smallBtn(
                `Wrong gateway (${V4_LAB_BAD_GATEWAY})`,
                () => act({ type: "set-gateway", gateway: V4_LAB_BAD_GATEWAY }),
                busy,
              )}
          {smallBtn("Clear ARP caches", () => act({ type: "clear-arp" }), busy)}
        </div>
      )}
    </>
  );

  const primaryAction = (compact: boolean) =>
    !freePlay && next ? (
      <Button
        size="sm"
        onClick={performNext}
        disabled={busy || !!gate}
        title={gate}
        className={compact ? "whitespace-nowrap" : undefined}
      >
        {compact ? next.short : next.label} →
      </Button>
    ) : null;
  const controls = (
    <>
      {smallBtn(
        "↻ Replay",
        () => rec && runner.replay(rec.waves.length),
        !rec || !rec.waves.length || busy || lab.last?.type !== "traffic",
      )}
      {rec?.routing &&
        rec.routing.outFrame >= 0 &&
        recIndex !== undefined &&
        smallBtn("Before / after R1", () => openDiff(recIndex), inFlight)}
      {!freePlay &&
        smallBtn(
          next ? "Skip to free play" : "Free play",
          () => setFreePlay(true),
          busy,
        )}
    </>
  );

  const fresh = (k: "HOST-A" | "HOST-C" | "HOST-B" | "R1") =>
    !!before &&
    !inFlight &&
    JSON.stringify(before.arp[k]) !== JSON.stringify(lab.arp[k]);
  /** ARP result of the send that made the current decision (a later R1 action doesn't replace it). */
  const latestArp = [...lab.records]
    .reverse()
    .find((r) => r.kind === "send" && r.decision === lab.decision)?.arp[0];

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="IPv4 Lab"
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={V4_LAB_STAGES.map((label, i) => ({ id: `t${i}`, label }))}
      currentStage={stage}
      stageSuffix={
        freePlay ? (
          <span className="rounded-full border border-pv-violet/50 px-2 py-0.5 text-[11px] font-semibold text-pv-violet">
            Free play
          </span>
        ) : undefined
      }
      loop={{ labels: LOOP, current: loop }}
      primaryAction={primaryAction}
      topology={topology}
      topologyClassName="h-[340px] sm:h-[clamp(220px,32vh,300px)]"
      topologyFooter={topologyFooter}
      controls={controls}
      eventStrip={
        <p
          className="truncate text-[11.5px] text-pv-text-muted"
          aria-live="polite"
        >
          {lab.log[lab.log.length - 1]?.text}
        </p>
      }
      board={
        <V4LabBoard
          {...ctx}
          revealed={revealed}
          cursor={cursor}
          freePlay={freePlay}
          inFlight={inFlight}
          gate={gate}
          repairTried={next?.repair ? repairTried : undefined}
        />
      }
      liveState={
        <div className="space-y-2">
          <V4DecisionPanel
            lab={lab}
            arp={latestArp}
            conceal={conceal}
            onInspect={inspectDecision}
          />
          {rec && recIndex !== undefined && lab.last?.type === "traffic" && (
            <section
              className="rounded-xl border border-pv-border p-2.5"
              aria-label="Frames this action put on the wire"
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
                Frames this action put on the wire
              </p>
              <ul className="space-y-0.5">
                {rec.frames.map((f, i) =>
                  rec.routing?.inFrame === i && rec.kind === "route" ? null : (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => inspectFrame(recIndex, i)}
                        className="w-full rounded px-1.5 py-0.5 text-left pv-mono text-[10.5px] text-pv-text-muted hover:bg-white/[0.04] hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
                      >
                        <span
                          className={
                            rec.frameKinds[i] === "ipv4"
                              ? "text-[#60a5fa]"
                              : "text-pv-warning"
                          }
                        >
                          {rec.frameKinds[i] === "ipv4" ? "IPv4" : "ARP"}
                        </span>{" "}
                        {f.summary}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <V4HostCard
              lab={lab}
              host="HOST-A"
              conceal={conceal}
              onInspectConfig={inspectConfig}
              fresh={fresh("HOST-A")}
            />
            <V4HostCard
              lab={lab}
              host="HOST-C"
              conceal={false}
              fresh={fresh("HOST-C")}
            />
            <V4HostCard
              lab={lab}
              host="HOST-B"
              conceal={false}
              fresh={fresh("HOST-B")}
            />
            <V4RouterCard lab={lab} fresh={fresh("R1")} />
          </div>
          <p className="text-[10.5px] text-pv-text-faint">
            HOST-C is a Practice-Lab-only host, added so local and remote
            forwarding can be compared. Not simulated: ICMP, fragmentation, ARP
            aging, other routes.
          </p>
        </div>
      }
      eventLog={<LabEventLog entries={lab.log} />}
      cliHeader={
        <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">
          R1 CLI · the only managed device here · hosts and switches have no
          Cisco/Junos CLI
        </p>
      }
      cli={
        <CLITerminal
          commandSets={r1CliSets(lab)}
          sessions={cliSessions}
          onSessionsChange={setCliSessions}
          focusRequest={cliFocus}
          vendor={vendor}
          onVendorChange={setVendor}
          deviceRole="Router"
          contextLabel={`IPv4 Lab · T${stage} ${V4_LAB_STAGES[stage]}`}
          onExecuted={onExecuted}
          stateVersion={runner.revision}
          footer="PacketVerse CLI supports the commands relevant to this lesson (read-only). Cisco names R1's ports Gi0/0 and Gi0/1; Junos and this lesson call them ge-0/0/0 and ge-0/0/1."
        />
      }
      tabLabels={{ topology: "Topology", state: "Decision", cli: "R1 CLI" }}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    />
  );
}
