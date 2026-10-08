"use client";

import { clsx } from "clsx";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { CLITerminal, type CliSessionMap } from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import { fmtT, type DlNode, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { FollowView, Saw, StateTables, type InvestigateSel } from "./Investigate";
import { INSPECTABLE, type Coach, type InspectNode } from "./dhcpObserve";
import { DeviceCard } from "./DeviceCard";
import { dlCliSets, SHELL } from "./dhcpCli";
import { ConceptChips, conceptsForPacket, type ConceptId } from "./Concepts";

/**
 * The engineering workspace's tool pane: ONE tool open at a time, chosen by the task or by the student.
 *   Follow   — one message, device by device (where did it go, where did it stop)
 *   Device   — one device: what it knows and did, then its captures (and, from Troubleshoot on, its tables)
 *   CLI      — that device's terminal (Troubleshoot and Build)
 *   Timeline — everything the lab sent, and the lab log
 */

export type Station = "follow" | "troubleshoot" | "build";
type Tool = InvestigateSel["tab"];
const TOOLS: { id: Tool; label: string; hint: string; from: Station[] }[] = [
  { id: "follow", label: "Follow", hint: "One message, device by device: where it went and where it stopped.", from: ["follow", "troubleshoot", "build"] },
  { id: "device", label: "Device", hint: "One device: what it knows, what it just did, and what each of its cables captured.", from: ["follow", "troubleshoot"] },
  { id: "cli", label: "CLI", hint: "The selected device's command line: its configuration and state, in its own words.", from: ["troubleshoot"] },
  { id: "timeline", label: "Timeline", hint: "Everything the lab has sent, in order, and the lab log. Pick a message to follow it.", from: ["follow", "troubleshoot", "build"] },
];

function Timeline({ lab, onPick }: { lab: DlState; onPick: (p: DlPacket) => void }) {
  if (lab.capture.length === 0) return <p className="pv-mono text-[12px] text-pv-text-faint">Nothing sent yet.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-pv-border">
      <table className="w-full min-w-[480px] text-left pv-mono text-[11px]">
        <thead className="sticky top-0 bg-pv-bg text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="px-2 py-1">No.</th>
            <th className="px-2">Source</th>
            <th className="px-2">Destination</th>
            <th className="px-2">Info</th>
            <th className="px-2">Ended at</th>
          </tr>
        </thead>
        <tbody>
          {lab.capture.map((p) => (
            <tr key={p.no} onClick={() => onPick(p)} className={clsx("cursor-pointer border-t border-pv-border/60 hover:bg-white/[0.03]", p.lost && "text-pv-danger", lab.lastPackets.includes(p.no) && "bg-pv-cyan/[0.06]")}>
              <td className="px-2 py-0.5">{p.no}</td>
              <td className="px-2">{p.src}</td>
              <td className="px-2">{p.dst}</td>
              <td className="px-2">{p.info}</td>
              <td className="px-2">{p.hops[p.hops.length - 1].node}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Workbench({ lab, sel, setSel, coach, setCoach, station, onConcept, vendor, setVendor, sessions, setSessions }: { lab: DlState; sel: InvestigateSel; setSel: (s: InvestigateSel) => void; coach: Coach; setCoach: (c: Coach) => void; station: Station; onConcept: (id: ConceptId) => void; vendor: CliVendor; setVendor: (v: CliVendor) => void; sessions: CliSessionMap; setSessions: (u: (m: CliSessionMap) => CliSessionMap) => void}) {
  const tools = TOOLS.filter((t) => t.from.includes(station));
  const tool = tools.find((t) => t.id === sel.tab) ?? tools[0];
  const node: InspectNode = sel.node === "WEB" ? "CLIENT" : sel.node;
  const extra = (p: DlPacket) => <ConceptChips ids={conceptsForPacket(p)} onOpen={onConcept} />;
  const full = station !== "follow";
  return (
    <section aria-label="Engineering tools" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Tool" className="flex gap-0.5 rounded-xl border border-pv-border p-0.5">
          {tools.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tool.id === t.id} onClick={() => setSel({ ...sel, tab: t.id, pick: undefined })} className={clsx("rounded-lg px-3 py-1 text-[12.5px] font-semibold", tool.id === t.id ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Coaching" className="flex gap-0.5 rounded-full border border-pv-border p-0.5 text-[10.5px]">
          {(["guide", "hints", "off"] as Coach[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={coach === c} onClick={() => setCoach(c)} className={clsx("rounded-full px-2 py-0.5 font-semibold", coach === c ? "bg-pv-violet/20 text-pv-violet" : "text-pv-text-faint hover:text-pv-text")}>
              {c === "guide" ? "Guide me" : c === "hints" ? "Hints" : "No help"}
            </button>
          ))}
        </div>
      </div>
      {coach !== "off" && <p className="text-[11.5px] text-pv-text-faint">{tool.hint}</p>}

      {tool.id === "follow" && <FollowView lab={lab} sel={sel} setSel={setSel} coach={coach} extra={extra} />}

      {tool.id === "device" && station !== "build" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {INSPECTABLE.map((n) => (
              <button key={n} type="button" onClick={() => setSel({ ...sel, node: n, iface: undefined, pick: undefined })} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", n === node ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
                {n}
              </button>
            ))}
          </div>
          <DeviceCard
            embedded
            lab={lab}
            node={node}
            level={full ? 6 : 5}
            onClose={() => undefined}
            onCapture={(i) => setSel({ ...sel, node, iface: i, view: "saw", pick: undefined })}
            onFollow={() => setSel({ ...sel, tab: "follow", journey: undefined, pick: undefined })}
            onTables={() => setSel({ ...sel, node, view: "state", pick: undefined })}
            onTerminal={() => setSel({ ...sel, node, tab: "cli" })}
          />
          {full && (
            <div role="tablist" className="flex gap-1">
              {(
                [
                  ["saw", "Captures on its cables"],
                  ["state", "Its tables, status and logs"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" role="tab" aria-selected={sel.view === v} onClick={() => setSel({ ...sel, view: v })} className={clsx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", sel.view === v ? "bg-white/10 text-pv-text" : "text-pv-text-faint hover:text-pv-text")}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {full && sel.view === "state" ? <StateTables lab={lab} node={node} coach={coach} /> : <Saw lab={lab} sel={{ ...sel, node }} setSel={setSel} coach={coach} extra={extra} />}
        </div>
      )}

      {tool.id === "cli" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {INSPECTABLE.map((n) => (
              <button key={n} type="button" onClick={() => setSel({ ...sel, node: n })} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", n === node ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
                {n}
              </button>
            ))}
          </div>
          <CLITerminal
            commandSets={dlCliSets(lab, node as DlNode)}
            sessions={sessions}
            onSessionsChange={setSessions}
            vendor={vendor}
            onVendorChange={setVendor}
            shellLabel={SHELL[node]}
            deviceRole={node === "R1" ? "Gateway + DHCP relay" : node === "SW1" || node === "SW2" ? "Access switch" : node === "CLIENT" ? "Laptop" : node === "DHCP-SRV" ? "DHCP server" : "DNS server"}
            contextLabel="DHCP & DNS Lab"
            stateVersion={lab.seq}
            footer="Read-only. Output is trimmed to what matters in this lab and reads the same network state as every other tool. Press ? for this device's commands."
          />
        </div>
      )}

      {tool.id === "timeline" && (
        <div className="space-y-2">
          <Timeline lab={lab} onPick={(p) => setSel({ ...sel, tab: "follow", journey: p.journey, pick: undefined })} />
          <LabEventLog title="Lab log" entries={lab.log.map((l) => ({ id: l.id, tag: fmtT(lab.clock), text: l.text, kind: l.kind === "learn" ? "learn" : "info" }))} />
        </div>
      )}
    </section>
  );
}
