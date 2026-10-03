"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { CLITerminal, cliSessionKey, withSessionInput, type CliExecutedEvent, type CliSessionMap } from "@/components/protocol/CLITerminal";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { LabDeviceDetails, InspectInCliButton } from "@/components/practice-lab/LabDeviceDetails";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import type { CliVendor } from "@/lib/cli/types";
import { ARP_LAB_MODEL, ARP_LAB_PATHS, ARP_LAB_PHASES, ARP_LAB_REMOTE_DESTINATION, arpLabPacket, isInFlight, nextTransmission, type ArpLabNode, type ArpLabState, type ArpLabTransmissionKind } from "@/lib/sim-engine/scenarios/arpLab";
import { ADDR, DEVICE_HOSTNAME, SUBNETS } from "@/lib/sim-engine/scenarios/firstConnection";
import { firstConnectionCliSets, interfaceAlias } from "../cliAdapter";
import { arpLabCliView } from "../arpLabCli";
import { ARP_LAB_SEGMENT_MS, ArpLabTopology } from "./ArpLabTopology";
import { ArpLabTables } from "./ArpLabTables";
import { ArpLabTeachingBoard, type LabChallengeState, type LabStage } from "./ArpLabTeachingBoard";

/**
 * ARP Lab workspace — the ARP composition of the generic Practice Lab
 * framework, on the SAME network as the guided lesson (Laptop, Access
 * Switch SW1, Router R1, Server).
 *
 *   generic (framework):  PracticeLabShell layout · useLabRunner timing,
 *                         Replay and Reset · LabEventLog · LabDeviceDetails ·
 *                         LabPacketFields · CLITerminal sessions
 *   ARP-specific (here):  ARP_LAB_MODEL truth · stages, gates and
 *                         predictions · inspection keys · topology diagram ·
 *                         board content · device facts · CLI adapter
 *
 * State isolation: the network state lives only in this lab's runner.
 * Nothing here receives the ScenarioEngine, the lesson snapshot or the
 * progress store, so the lab cannot change lesson progress, XP or answers.
 */

type CliDevice = "switch" | "router";

const ACTION_LABEL: Record<ArpLabTransmissionKind, string> = {
  "arp-request": "Send ARP Request",
  "arp-reply": "Send ARP Reply",
  "ip-frame": "Send IP Frame",
};
const EMPTY_CHALLENGES: LabChallengeState = { answers: {}, revealed: [] };
const STAGE_LABEL = ["Baseline", "ARP Request", "ARP Reply", "Resolved"];
const LOOP = ["Predict", "Send", "Observe", "Verify"];

const FIELD_NOTE: Record<ArpLabTransmissionKind, Record<string, string>> = {
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
  if (isInFlight(lab)) return 2;
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
  const runner = useLabRunner(ARP_LAB_MODEL, { segmentMs: ARP_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [cliDevice, setCliDevice] = useState<CliDevice>("switch");
  /** The lab's own CLI sessions (vendor × device). Network state is shared by all of them; transcripts and histories are not. */
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [cliFocus, setCliFocus] = useState(0);
  const [inspected, setInspected] = useState<Set<string>>(() => new Set());
  const [challenges, setChallenges] = useState<LabChallengeState>(EMPTY_CHALLENGES);
  const [packetOpen, setPacketOpen] = useState(false);
  const [openWhy, setOpenWhy] = useState<string | undefined>(undefined);
  const [selectedDevice, setSelectedDevice] = useState<ArpLabNode | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");

  const stage = labStage(lab, !!challenges.answers["t3-dst-mac"]);
  const inFlight = isInFlight(lab);
  const next = nextTransmission(lab);
  const loop = loopStep(stage, lab, challenges.answers, inspected);
  const cliSets = useMemo(() => firstConnectionCliSets(cliDevice, arpLabCliView(lab)), [cliDevice, lab]);
  const contextLabel = `ARP Lab · T${stage} ${STAGE_LABEL[stage]}`;
  const gate: string | undefined =
    next === "arp-request" && !challenges.answers["arp-target"] ? "Answer the prediction on the board first" : next === "ip-frame" && !challenges.answers["t3-dst-mac"] ? "Predict the destination MAC first" : undefined;

  function send(kind: ArpLabTransmissionKind) {
    setPacketOpen(false);
    runner.run(kind);
  }

  function replayLast() {
    if (lab.transit?.done) runner.replay(ARP_LAB_PATHS[lab.transit.kind].length - 1);
  }

  function reset() {
    runner.reset();
    setInspected(new Set());
    setChallenges(EMPTY_CHALLENGES);
    setPacketOpen(false);
    setOpenWhy(undefined);
    setSelectedDevice(undefined);
    setCliSessions({});
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

  // Replay draws the last frame again from the runner's frame counter — lab state is untouched.
  const shownTransit = runner.replayFrame && lab.transit ? { ...lab.transit, id: runner.replayFrame.id, hop: runner.replayFrame.hop, done: runner.replayFrame.done } : lab.transit;
  const packet = lab.transit ? arpLabPacket(lab.transit.kind) : undefined;
  const lastEvent = lab.events[lab.events.length - 1];

  const primaryAction = (compact: boolean) =>
    next ? (
      <div className={clsx("flex items-center gap-2", compact ? "" : "flex-wrap")}>
        <button
          type="button"
          onClick={() => send(next)}
          disabled={runner.busy || !!gate}
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

  const deviceDetails =
    selectedDevice === "laptop" ? (
      <LabDeviceDetails
        title="Laptop"
        label="laptop details"
        onClose={() => setSelectedDevice(undefined)}
        rows={[
          ["IP", `${ADDR.laptop.ip}/${SUBNETS.lan.prefixLength}`],
          ["Default gateway", ADDR.gateway.ip],
          ["MAC", ADDR.laptop.mac],
          ["ARP cache", Object.entries(lab.laptopArp).map(([ip, mac]) => `${ip} → ${mac}`).join(", ") || "EMPTY"],
        ]}
      />
    ) : selectedDevice === "switch" ? (
      <LabDeviceDetails
        title={`Access Switch · ${DEVICE_HOSTNAME.switch}`}
        label="switch details"
        onClose={() => setSelectedDevice(undefined)}
        rows={[
          ["Role", "Layer 2 — forwards on MAC addresses, needs no IP or ARP entry to do it"],
          ["Learned MACs", String(Object.keys(lab.switchMac).length)],
          ["Ports", `${interfaceAlias(vendor, { kind: "switch", id: "port1" })} → Laptop · ${interfaceAlias(vendor, { kind: "switch", id: "port2" })} → R1`],
        ]}
        action={<InspectInCliButton onClick={() => openInCli("switch")} />}
      />
    ) : selectedDevice === "router" ? (
      <LabDeviceDetails
        title={`Router · ${DEVICE_HOSTNAME.router}`}
        label="router details"
        onClose={() => setSelectedDevice(undefined)}
        rows={[
          ["LAN", `${ADDR.gateway.ip}/24 on ${interfaceAlias(vendor, { kind: "router", id: "lan" })}`],
          ["Server side", `${ADDR.routerWan.ip}/24 on ${interfaceAlias(vendor, { kind: "router", id: "server" })}`],
          ["ARP neighbors", Object.entries(lab.routerArp).map(([ip, mac]) => `${ip} → ${mac}`).join(", ") || "none yet"],
        ]}
        action={<InspectInCliButton onClick={() => openInCli("router")} />}
      />
    ) : selectedDevice === "server" ? (
      <LabDeviceDetails
        title="Server"
        label="server details"
        onClose={() => setSelectedDevice(undefined)}
        rows={[
          ["IP", `${ADDR.server.ip} on ${SUBNETS.server.network}`],
          ["From the Laptop", "Remote — a different subnet, reached through R1"],
          ["In this exchange", "Not a participant in the Laptop's gateway ARP"],
        ]}
      />
    ) : undefined;

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="ARP Lab"
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate((v) => !v)}
      stages={ARP_LAB_PHASES.map((p) => ({ id: p.id, label: STAGE_LABEL[p.t] }))}
      currentStage={stage}
      stageSuffix={lab.ipFrameDelivered ? <span className="rounded-full border border-pv-success/50 bg-pv-success/10 px-2 py-0.5 text-[11px] font-semibold text-pv-success">✓ IP frame</span> : undefined}
      loop={{ labels: LOOP, current: loop }}
      primaryAction={primaryAction}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      topology={
        <ArpLabTopology
          lab={lab}
          vendor={vendor}
          transit={shownTransit}
          selectedDevice={selectedDevice}
          onSelectDevice={selectDevice}
          onInspectPacket={() => setPacketOpen((v) => !v)}
          packetSelected={packetOpen}
          scopeRevealed={!!challenges.answers["arp-target"]}
        />
      }
      topologyFooter={deviceDetails}
      controls={
        <>
          {lab.transit?.done && !inFlight && runner.animate && (
            <button type="button" onClick={replayLast} disabled={!!runner.replayFrame} className="rounded-full border border-pv-border px-3 py-1 text-[11.5px] text-pv-text-muted hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:opacity-40">
              ↻ Replay packet
            </button>
          )}
          {lab.phase === "baseline" && !inFlight && (
            <button type="button" onClick={() => runner.runSequence(["arp-request", "arp-reply"])} disabled={runner.busy} className="text-[11.5px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:opacity-40">
              or run the full ARP exchange automatically
            </button>
          )}
        </>
      }
      eventStrip={
        packet && (
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
        )
      }
      board={
        <>
          {packetOpen && packet && lab.transit && <LabPacketFields packet={packet} notes={FIELD_NOTE[lab.transit.kind]} />}
          <ArpLabTeachingBoard
            key={`board-${runner.resetCount}`}
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
        </>
      }
      liveState={<ArpLabTables lab={lab} vendor={vendor} openWhy={openWhy} onWhy={setOpenWhy} />}
      eventLog={<LabEventLog entries={lab.events.map((ev) => ({ id: ev.id, tag: `T${ev.t}`, text: ev.text, kind: ev.kind === "learn" ? "learn" : "info" }))} />}
      cliHeader={
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Terminal</p>
          <div role="radiogroup" aria-label="Device" className="flex gap-0.5 rounded-full border border-pv-border p-0.5">
            {(["switch", "router"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={cliDevice === d}
                onClick={() => setCliDevice(d)}
                className={clsx("rounded-full px-3 py-0.5 pv-mono text-[11.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", cliDevice === d ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
              >
                {DEVICE_HOSTNAME[d]}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-pv-text-faint">Queries the lab network live</span>
        </div>
      }
      cli={
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
          stateVersion={runner.revision}
          footer="PacketVerse CLI supports the commands relevant to this lesson. It is a state-driven learning simulator, not a full network operating system emulator."
        />
      }
    />
  );
}
