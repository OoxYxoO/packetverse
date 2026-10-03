"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { CLITerminal, cliSessionKey, withSessionInput, type CliExecutedEvent, type CliSessionMap } from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import {
  ARP_LAB_PATHS,
  ARP_LAB_PHASES,
  ARP_LAB_REMOTE_DESTINATION,
  arpLabPacket,
  arriveNextHop,
  createArpLabState,
  deliverTransmission,
  isInFlight,
  nextTransmission,
  startTransmission,
  type ArpLabNode,
  type ArpLabState,
  type ArpLabTransit,
  type ArpLabTransmissionKind,
} from "@/lib/sim-engine/scenarios/arpLab";
import { ADDR, DEVICE_HOSTNAME, SUBNETS } from "@/lib/sim-engine/scenarios/firstConnection";
import { firstConnectionCliSets, interfaceAlias } from "../cliAdapter";
import { arpLabCliView } from "../arpLabCli";
import { ARP_LAB_SEGMENT_MS, ArpLabTopology } from "./ArpLabTopology";
import { ArpLabTables } from "./ArpLabTables";
import { ArpLabTeachingBoard, type LabChallengeState, type LabStage } from "./ArpLabTeachingBoard";

/**
 * ARP Lab workspace — an optional sandbox on the SAME network as the
 * guided lesson (Laptop, Access Switch SW1, Router R1, Server).
 *
 * State isolation: the network state lives only in this component's
 * ArpLabState (scenarios/arpLab.ts). Shared *definitions* (names,
 * addresses, subnets, packets) come from firstConnection.ts; nothing
 * here receives the ScenarioEngine, the lesson snapshot or the progress
 * store, so the lab cannot change lesson progress, XP or answers. The
 * terminal is the shared CLITerminal fed only by `arpLabCliView(lab)`.
 *
 * Layout: desktop = topology (sticky, left ~60%) beside live tables +
 * terminal (right ~40%); mobile = Topology / State / CLI tabs under a
 * persistent phase strip.
 */

type CliDevice = "switch" | "router";
type MobileTab = "topology" | "state" | "cli";

const ACTION_LABEL: Record<ArpLabTransmissionKind, string> = {
  "arp-request": "Send ARP Request",
  "arp-reply": "Send ARP Reply",
  "ip-frame": "Send IP Frame",
};
const PAUSE_BETWEEN_MS = 900;
const EMPTY_CHALLENGES: LabChallengeState = { answers: {}, revealed: [] };
const STAGE_LABEL = ["Baseline", "ARP Request", "ARP Reply", "Resolved"];
const LOOP = ["Predict", "Send", "Observe", "Verify"] as const;

const FIELD_NOTE: Record<string, Record<string, string>> = {
  "arp-request": { "Destination MAC": "broadcast — floods the whole LAN", "Target MAC": "unknown: this is the question" },
  "arp-reply": { "Destination MAC": "the Laptop — unicast, straight back", "Target MAC": "the Laptop, copied from the request" },
  "ip-frame": { "Destination MAC": "the Router (gateway), from the ARP cache", "Destination IP": "the Server — unchanged end to end" },
};

/** UI stage: T2 also covers "reply landed, first-frame prediction not answered yet"; T3 starts once it is. */
function labStage(lab: ArpLabState, dstAnswered: boolean): LabStage {
  if (lab.phase === "baseline") return 0;
  if (lab.phase === "request") return 1;
  if (lab.phase === "reply") return 2;
  return dstAnswered ? 3 : 2;
}

/** Predict → Send → Observe → Verify, derived from lab state + what the learner has done. -1 = loop complete. */
function loopStep(stage: LabStage, lab: ArpLabState, answers: LabChallengeState["answers"], inspected: Set<string>): number {
  const inFlight = isInFlight(lab);
  if (inFlight) return 2;
  if (stage === 0) return answers["arp-target"] ? 1 : 0;
  if (stage === 1) return !(inspected.has("1:switch:mac-table") && inspected.has("1:router:arp-table")) ? 3 : answers["predict-reply"] ? 1 : 0;
  if (stage === 2) return !(inspected.has("2:switch:mac-table") && inspected.has("2:laptop:view")) ? 3 : 0;
  if (!lab.ipFrameDelivered) return 1;
  return inspected.has("3:switch:mac-table") ? -1 : 3;
}

interface ArpLabWorkspaceProps {
  open: boolean;
  onClose: () => void;
  vendor: CliVendor;
  onVendorChange: (v: CliVendor) => void;
}

export function ArpLabWorkspace({ open, onClose, vendor, onVendorChange }: ArpLabWorkspaceProps) {
  const [lab, setLab] = useState<ArpLabState>(createArpLabState);
  const [animate, setAnimate] = useState(true);
  const [cliDevice, setCliDevice] = useState<CliDevice>("switch");
  /** The lab's own CLI sessions (vendor × device). Network state is shared by all of them; transcripts and histories are not. */
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [cliFocus, setCliFocus] = useState(0);
  const [inspected, setInspected] = useState<Set<string>>(() => new Set());
  const [challenges, setChallenges] = useState<LabChallengeState>(EMPTY_CHALLENGES);
  const [packetOpen, setPacketOpen] = useState(false);
  const [openWhy, setOpenWhy] = useState<string | undefined>(undefined);
  const [selectedDevice, setSelectedDevice] = useState<ArpLabNode | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<MobileTab>("topology");
  const [resetCount, setResetCount] = useState(0);
  const [running, setRunning] = useState(false);
  /** Animation-only copy of the last frame. Never touches ArpLabState, so replay can't re-learn or re-log anything. */
  const [replay, setReplay] = useState<ArpLabTransit | undefined>(undefined);
  const [replayCount, setReplayCount] = useState(0);
  const timers = useRef<number[]>([]);
  const replayTimers = useRef<number[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const stage = labStage(lab, !!challenges.answers["t3-dst-mac"]);
  const inFlight = isInFlight(lab);
  const next = nextTransmission(lab);
  const loop = loopStep(stage, lab, challenges.answers, inspected);
  const cliSets = useMemo(() => firstConnectionCliSets(cliDevice, arpLabCliView(lab)), [cliDevice, lab]);
  /** Network revision for the stale-output hint: changes exactly when a lab table changes. */
  const stateVersion = `${resetCount}:${Object.keys(lab.laptopArp).length}:${Object.keys(lab.routerArp).length}:${Object.keys(lab.switchMac).length}`;
  const contextLabel = `ARP Lab · T${stage} ${STAGE_LABEL[stage]}`;

  const gate: string | undefined =
    next === "arp-request" && !challenges.answers["arp-target"] ? "Answer the prediction on the board first" : next === "ip-frame" && !challenges.answers["t3-dst-mac"] ? "Predict the destination MAC first" : undefined;

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      replayTimers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  function stopReplay() {
    replayTimers.current.forEach((t) => window.clearTimeout(t));
    replayTimers.current = [];
    setReplay(undefined);
  }

  function send(kind: ArpLabTransmissionKind, then?: () => void) {
    stopReplay();
    setPacketOpen(false);
    if (!animate) {
      setLab((s) => deliverTransmission(s, kind));
      then?.();
      return;
    }
    setLab((s) => startTransmission(s, kind));
    const hops = ARP_LAB_PATHS[kind].length - 1;
    for (let h = 1; h <= hops; h++) timers.current.push(window.setTimeout(() => setLab((s) => arriveNextHop(s)), h * ARP_LAB_SEGMENT_MS));
    if (then) timers.current.push(window.setTimeout(then, hops * ARP_LAB_SEGMENT_MS + PAUSE_BETWEEN_MS));
  }

  function replayLast() {
    const last = lab.transit;
    if (!last || !last.done) return;
    stopReplay();
    const hops = ARP_LAB_PATHS[last.kind].length - 1;
    setReplay({ ...last, id: -(replayCount + 1), hop: 0, done: false });
    setReplayCount((c) => c + 1);
    for (let h = 1; h <= hops; h++) replayTimers.current.push(window.setTimeout(() => setReplay((r) => (r ? { ...r, hop: h, done: h === hops } : r)), h * ARP_LAB_SEGMENT_MS));
    replayTimers.current.push(window.setTimeout(() => setReplay(undefined), hops * ARP_LAB_SEGMENT_MS + 800));
  }

  function runFullExchange() {
    setRunning(true);
    send("arp-request", () => send("arp-reply", () => setRunning(false)));
    if (!animate) setRunning(false);
  }

  function reset() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    stopReplay();
    setRunning(false);
    setLab(createArpLabState());
    setInspected(new Set());
    setChallenges(EMPTY_CHALLENGES);
    setPacketOpen(false);
    setOpenWhy(undefined);
    setSelectedDevice(undefined);
    setCliSessions({});
    setResetCount((c) => c + 1);
  }

  function markInspected(key: string) {
    if (!inspected.has(key)) setInspected((s) => new Set([...s, key]));
  }

  /** Engineer checks only count queries made after the frame has landed — mid-flight output can't prove the final state. */
  function onExecuted(e: CliExecutedEvent) {
    if (!inFlight) markInspected(`${stage}:${e.deviceId}:${e.commandId}`);
  }

  function selectDevice(id: ArpLabNode) {
    setSelectedDevice((cur) => (cur === id ? undefined : id));
    if (id === "laptop" && !inFlight) markInspected(`${stage}:laptop:view`);
  }

  function openInCli(device: CliDevice) {
    setCliDevice(device);
    setMobileTab("cli");
  }

  function putInTerminal(device: CliDevice, text: string) {
    setCliDevice(device);
    setMobileTab("cli");
    setCliSessions((m) => withSessionInput(m, cliSessionKey(vendor, DEVICE_HOSTNAME[device]), text));
    setCliFocus((n) => n + 1);
  }

  const shownTransit = replay ?? lab.transit;
  const packet = lab.transit ? arpLabPacket(lab.transit.kind) : undefined;
  const lastEvent = lab.events[lab.events.length - 1];
  const scopeRevealed = !!challenges.answers["arp-target"];

  const primaryButton = (compact?: boolean) =>
    next ? (
      <div className={clsx("flex items-center gap-2", compact ? "" : "flex-wrap")}>
        <button
          type="button"
          onClick={() => send(next)}
          disabled={running || !!gate}
          aria-describedby={gate ? `gate-${compact ? "m" : "d"}` : undefined}
          className={clsx(
            "rounded-full bg-pv-cyan font-semibold text-pv-bg shadow transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan disabled:cursor-not-allowed disabled:opacity-35",
            compact ? "px-3 py-1.5 text-[12px]" : "px-4 py-2 text-[13px]",
          )}
        >
          {ACTION_LABEL[next]} →
        </button>
        {gate && !compact && (
          <span id="gate-d" className="text-[11.5px] text-pv-text-faint">
            {gate}
          </span>
        )}
        {gate && compact && (
          <span id="gate-m" className="sr-only">
            {gate}
          </span>
        )}
      </div>
    ) : (
      <span className={clsx("rounded-full border border-pv-border text-pv-text-faint", compact ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-[12px]")}>
        {inFlight ? "Frame in flight…" : lab.ipFrameDelivered ? "Lab complete — Reset to try again" : "—"}
      </span>
    );

  const inspectCard = selectedDevice && (
    <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5 text-[12px] text-pv-text-muted" role="region" aria-label={`${selectedDevice} details`}>
      <button type="button" onClick={() => setSelectedDevice(undefined)} aria-label="Close device details" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
        ×
      </button>
      {selectedDevice === "laptop" && (
        <Facts
          title="Laptop"
          rows={[
            ["IP", `${ADDR.laptop.ip}/${SUBNETS.lan.prefixLength}`],
            ["Default gateway", ADDR.gateway.ip],
            ["MAC", ADDR.laptop.mac],
            ["ARP cache", Object.entries(lab.laptopArp).map(([ip, mac]) => `${ip} → ${mac}`).join(", ") || "EMPTY"],
          ]}
        />
      )}
      {selectedDevice === "switch" && (
        <Facts
          title={`Access Switch · ${DEVICE_HOSTNAME.switch}`}
          rows={[
            ["Role", "Layer 2 — forwards on MAC addresses, needs no IP or ARP entry to do it"],
            ["Learned MACs", String(Object.keys(lab.switchMac).length)],
            ["Ports", `${interfaceAlias(vendor, { kind: "switch", id: "port1" })} → Laptop · ${interfaceAlias(vendor, { kind: "switch", id: "port2" })} → R1`],
          ]}
          action={<CliButton onClick={() => openInCli("switch")} />}
        />
      )}
      {selectedDevice === "router" && (
        <Facts
          title={`Router · ${DEVICE_HOSTNAME.router}`}
          rows={[
            ["LAN", `${ADDR.gateway.ip}/24 on ${interfaceAlias(vendor, { kind: "router", id: "lan" })}`],
            ["Server side", `${ADDR.routerWan.ip}/24 on ${interfaceAlias(vendor, { kind: "router", id: "server" })}`],
            ["ARP neighbors", Object.entries(lab.routerArp).map(([ip, mac]) => `${ip} → ${mac}`).join(", ") || "none yet"],
          ]}
          action={<CliButton onClick={() => openInCli("router")} />}
        />
      )}
      {selectedDevice === "server" && (
        <Facts
          title="Server"
          rows={[
            ["IP", `${ADDR.server.ip} on ${SUBNETS.server.network}`],
            ["From the Laptop", "Remote — a different subnet, reached through R1"],
            ["In this exchange", "Not a participant in the Laptop's gateway ARP"],
          ]}
        />
      )}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="arp-lab-title"
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose();
      }}
      className={clsx("fixed inset-0 z-[55] flex-col bg-pv-bg", open ? "flex" : "hidden")}
    >
      <header className="shrink-0 border-b border-pv-border bg-pv-bg-elevated/70 px-3 py-2 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id="arp-lab-title" ref={titleRef} tabIndex={-1} className="text-base font-semibold text-pv-text outline-none sm:text-lg">
              ARP Lab
            </h2>
            <span className="hidden rounded-full border border-pv-border px-2 py-0.5 text-[10px] text-pv-text-faint md:inline">Same network as the lesson · sandbox, no progress</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={animate}
              onClick={() => setAnimate((v) => !v)}
              className="hidden rounded-full border border-pv-border px-2.5 py-1 text-[11px] text-pv-text-faint hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan sm:inline"
            >
              Animation: {animate ? "on" : "off"}
            </button>
            <button type="button" onClick={reset} className="rounded-full border border-pv-warning/50 bg-pv-warning/10 px-3 py-1 text-[12px] font-semibold text-pv-warning hover:bg-pv-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-warning">
              ⟲ Reset Lab
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-pv-border px-3 py-1 text-[12px] font-semibold text-pv-text hover:border-pv-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
              ← Return to lesson
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <ol className="flex items-center gap-1" aria-label="ARP Lab timeline">
            {ARP_LAB_PHASES.map((p, i) => {
              const current = p.t === stage;
              const passed = p.t < stage;
              return (
                <li key={p.id} className="flex shrink-0 items-center gap-1" aria-current={current ? "step" : undefined}>
                  {i > 0 && (
                    <span aria-hidden className={clsx("text-xs", passed || current ? "text-pv-cyan-soft" : "text-pv-text-faint")}>
                      →
                    </span>
                  )}
                  <span
                    className={clsx(
                      "flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      current ? "border-pv-cyan/60 bg-pv-cyan/15 font-semibold text-pv-cyan-soft" : passed ? "border-pv-success/40 text-pv-success" : "border-pv-border text-pv-text-faint",
                    )}
                  >
                    <span className="pv-mono text-[10px]">T{p.t}</span>
                    <span className={current ? undefined : "sr-only sm:not-sr-only"}>{STAGE_LABEL[p.t]}</span>
                    {passed && <span className="sr-only"> (done)</span>}
                  </span>
                </li>
              );
            })}
            {lab.ipFrameDelivered && <li className="ml-1 shrink-0 rounded-full border border-pv-success/50 bg-pv-success/10 px-2 py-0.5 text-[11px] font-semibold text-pv-success">✓ IP frame</li>}
          </ol>
          <ol className="flex items-center gap-1 text-[10.5px]" aria-label="Learning loop">
            {LOOP.map((step, i) => {
              const done = loop === -1 || i < loop;
              const current = i === loop;
              return (
                <li key={step} aria-current={current ? "step" : undefined} className={clsx("rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide", current ? "bg-pv-violet/20 text-pv-violet" : done ? "text-pv-success" : "text-pv-text-faint")}>
                  {step}
                  {done ? " ✓" : ""}
                  {current && <span className="sr-only"> (current)</span>}
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-pv-border px-3 py-1.5 lg:hidden">
        <div role="tablist" aria-label="ARP Lab panels" className="flex gap-0.5 rounded-full border border-pv-border p-0.5">
          {(["topology", "state", "cli"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={mobileTab === t} onClick={() => setMobileTab(t)} className={clsx("rounded-full px-3 py-1 text-[12px] font-semibold", mobileTab === t ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint")}>
              {t === "topology" ? "Topology" : t === "state" ? "State" : "CLI"}
            </button>
          ))}
        </div>
        <div className="ml-auto">{primaryButton(true)}</div>
      </div>

      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Topology and mission" className={clsx("h-full min-h-0 overflow-y-auto", mobileTab === "topology" ? "block" : "hidden", "lg:block")}>
          <div className="z-10 space-y-2 border-b lg:sticky lg:top-0 border-pv-border bg-pv-bg/95 px-3 pb-2.5 pt-2 backdrop-blur sm:px-5">
            <div className="mx-auto h-[min(124vw,500px)] max-w-4xl sm:h-[clamp(170px,32vh,290px)]">
              <ArpLabTopology
                lab={lab}
                vendor={vendor}
                transit={shownTransit}
                selectedDevice={selectedDevice}
                onSelectDevice={selectDevice}
                onInspectPacket={() => setPacketOpen((v) => !v)}
                packetSelected={packetOpen}
                scopeRevealed={scopeRevealed}
              />
            </div>
            {inspectCard}
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden lg:block">{primaryButton()}</div>
              {lab.transit?.done && !inFlight && animate && (
                <button type="button" onClick={replayLast} disabled={!!replay} className="rounded-full border border-pv-border px-3 py-1 text-[11.5px] text-pv-text-muted hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:opacity-40">
                  ↻ Replay packet
                </button>
              )}
              {lab.phase === "baseline" && !inFlight && (
                <button type="button" onClick={runFullExchange} disabled={running} className="text-[11.5px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:opacity-40">
                  or run the full ARP exchange automatically
                </button>
              )}
              <button
                type="button"
                aria-pressed={animate}
                onClick={() => setAnimate((v) => !v)}
                className="rounded-full border border-pv-border px-2.5 py-1 text-[11px] text-pv-text-faint hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan sm:hidden"
              >
                Animation: {animate ? "on" : "off"}
              </button>
            </div>
            {packet && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pv-border bg-white/[0.02] px-3 py-1.5" aria-live="polite">
                <p className="min-w-0 text-[12px] text-pv-text-muted">
                  <span className="font-semibold text-pv-text">{lab.transit!.kind === "arp-request" ? "ARP Request · broadcast" : lab.transit!.kind === "arp-reply" ? "ARP Reply · unicast" : `IPv4 to ${ARP_LAB_REMOTE_DESTINATION}`}</span>
                  <span className="text-pv-text-faint"> — </span>
                  {lastEvent.text}
                </p>
                <button type="button" onClick={() => setPacketOpen((v) => !v)} aria-expanded={packetOpen} className="shrink-0 rounded-md border border-pv-border px-2 py-0.5 text-[11px] font-semibold text-pv-text-faint hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
                  {packetOpen ? "Hide packet" : "Inspect packet"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3 px-3 py-3 sm:px-5">
            {packetOpen && packet && (
              <div className="rounded-xl border border-pv-border p-3" aria-label="Packet fields">
                {packet.layers.map((layer) => (
                  <div key={layer.name} className="mb-2 last:mb-0">
                    <p className="mb-1 text-[11px] font-bold" style={{ color: layer.color }}>
                      {layer.name}
                    </p>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pv-mono text-[11px]">
                      {layer.fields.map((f) => (
                        <div key={f.label} className="contents">
                          <dt className="text-pv-text-faint">{f.label}</dt>
                          <dd className="min-w-0 break-words text-pv-text">
                            {f.value}
                            {FIELD_NOTE[lab.transit!.kind]?.[f.label] && <span className="ml-2 font-sans text-[10.5px] text-pv-warning">← {FIELD_NOTE[lab.transit!.kind][f.label]}</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}

            <ArpLabTeachingBoard
              key={`board-${resetCount}`}
              stage={stage}
              lab={lab}
              vendor={vendor}
              inspected={inspected}
              challenges={challenges}
              onAnswer={(id, value) => setChallenges((c) => ({ ...c, answers: { ...c.answers, [id]: value } }))}
              onPutInTerminal={putInTerminal}
              onShowLaptop={() => {
                setSelectedDevice("laptop");
                setMobileTab("topology");
                if (!inFlight) markInspected(`${stage}:laptop:view`);
              }}
            />

          </div>
        </section>

        <section aria-label="Live state and CLI" className={clsx("h-full min-h-0 flex-col overflow-y-auto border-pv-border lg:flex lg:border-l", mobileTab === "topology" ? "hidden" : "flex")}>
          <div className={clsx("space-y-2 px-3 pt-3 sm:px-5", mobileTab === "state" ? "block" : "hidden", "lg:block")}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Live state</p>
            <ArpLabTables lab={lab} vendor={vendor} openWhy={openWhy} onWhy={setOpenWhy} />
            <details className="rounded-xl border border-pv-border p-2.5">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-pv-text-muted outline-none hover:text-pv-text focus-visible:text-pv-cyan-soft">Event Log ({lab.events.length})</summary>
              <ol className="mt-2 space-y-1 pv-mono text-[10.5px]">
                {lab.events.map((ev) => (
                  <li key={ev.id} className="flex gap-2">
                    <span className="shrink-0 text-pv-cyan-soft">T{ev.t}</span>
                    <span className={clsx("min-w-0", ev.kind === "learn" ? "text-pv-success" : "text-pv-text-muted")}>{ev.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          </div>

          <div className={clsx("space-y-2 px-3 pb-3 pt-3 sm:px-5", mobileTab === "cli" ? "block" : "hidden", "lg:block")}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Terminal</p>
              <div role="radiogroup" aria-label="Device" className="flex gap-0.5 rounded-full border border-pv-border p-0.5">
                {(["switch", "router"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={cliDevice === d}
                    onClick={() => {
                      setCliDevice(d);
                    }}
                    className={clsx("rounded-full px-3 py-0.5 pv-mono text-[11.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", cliDevice === d ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
                  >
                    {DEVICE_HOSTNAME[d]}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px] text-pv-text-faint">Queries the lab network live</span>
            </div>
            <CLITerminal
              commandSets={cliSets}
              sessions={cliSessions}
              onSessionsChange={setCliSessions}
              focusRequest={cliFocus}
              vendor={vendor}
              onVendorChange={onVendorChange}
              deviceRole={cliDevice === "switch" ? "Access Switch" : "Router"}
              contextLabel={contextLabel}
              onExecuted={onExecuted}
              stateVersion={stateVersion}
              footer="PacketVerse CLI supports the commands relevant to this lesson. It is a state-driven learning simulator, not a full network operating system emulator."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Facts({ title, rows, action }: { title: string; rows: [string, string][]; action?: ReactNode }) {
  return (
    <div>
      <p className="mb-1 pr-5 text-[12.5px] font-semibold text-pv-text">{title}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-pv-text-faint">{k}</dt>
            <dd className="min-w-0 break-words pv-mono text-pv-text">{v}</dd>
          </div>
        ))}
      </dl>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

function CliButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-pv-cyan/40 px-2 py-0.5 text-[11px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      Inspect in CLI →
    </button>
  );
}
