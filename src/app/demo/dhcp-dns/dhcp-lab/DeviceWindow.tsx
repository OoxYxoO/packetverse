"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { DL_IFACES, DL_NODE_IFACES, configured, dhcpProblem, dhcpRunning, fmtT, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { parseDhcpd, parseZone, r1RunningConfig, ZONE } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";
import type { EditorSpec } from "./NanoEditor";
import { junosText } from "./routerConfig";
import { useIfName } from "./ifNames";
import { DeviceCard } from "./DeviceCard";
import { Saw, StateTables, INITIAL_SEL, type InvestigateSel } from "./Investigate";
import type { Coach, InspectNode } from "./dhcpObserve";
import { Code, FileEditor, Note, type BuildApi } from "./DeviceConsole";
import { clientPromptSet, dlBuildCliSets } from "./dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleOs, type ConsoleSession } from "./ConsoleTerminal";
import { VerifyStrip } from "./Journal";

/**
 * Build it yourself, Packet Tracer style: the topology is the lab desk; clicking a device opens THAT device in its own
 * window. Windows float over the desk (drag by the title bar, resize from the corner), several can be open, and they
 * minimize to a tray. On phones a device opens full screen with a way back to the topology. Each device's window
 * looks and works like its kind: a router (CLI first), a switch (ports and CLI), a server (its service, files and
 * shell), a PC (desktop apps: IP configuration and Command Prompt).
 */

export interface WinState {
  id: InspectNode;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
const KIND: Record<InspectNode, { kind: string; icon: string; tone: string; model: string }> = {
  R1: { kind: "Router", icon: "R", tone: "#22d3ee", model: "Gateway for 10.10.10.0/24 · 3 interfaces" },
  SW1: { kind: "Switch", icon: "⇄", tone: "#94a3b8", model: "Access switch · laptops' network" },
  SW2: { kind: "Switch", icon: "⇄", tone: "#94a3b8", model: "Access switch · servers' network" },
  "DHCP-SRV": { kind: "Server", icon: "🗄", tone: "#a78bfa", model: "Linux · isc-dhcp-server · 10.20.20.10" },
  "DNS-SRV": { kind: "Server", icon: "🗄", tone: "#a78bfa", model: "Linux · BIND named · 10.20.20.53" },
  CLIENT: { kind: "PC", icon: "💻", tone: "#34d399", model: "Laptop · Ethernet adapter on SW1" },
};

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setNarrow(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return narrow;
}

interface Ctx {
  lab: DlState;
  api: BuildApi;
  coach: Coach;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  /** Console sessions per device and OS: scrollback and history survive closing the window. */
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
}

/** The device's console: R1 and the switches speak IOS or Junos, the servers bash, the laptop cmd.exe. */
function DevConsole({ c, node, className }: { c: Ctx; node: InspectNode; className?: string }) {
  const net = node === "R1" || node === "SW1" || node === "SW2";
  const os: ConsoleOs = net ? (c.vendor === "cisco" ? "ios" : "junos") : node === "CLIENT" ? "windows" : "linux";
  const key0 = `${node}:${net ? (c.vendor === "cisco" ? "ios" : "junos") : node === "CLIENT" ? "windows" : "linux"}`;
  const api = { ...c.api, history: c.consoles[key0]?.history ?? [] };
  const all = node === "CLIENT" ? { cisco: withShellHistory(clientPromptSet(c.lab, c.api.act), "windows", api.history) } : dlBuildCliSets(c.lab, node, api, c.api.cisco, c.api.setCisco, c.api.junosMode, c.api.setJunosMode);
  const hist = c.api.junosHist;
  const sets = net ? all : { cisco: all.cisco };
  const key = `${node}:${os}`;
  // The servers' files can be edited in the terminal with nano; saving writes the same file everything else reads.
  const editor = (id: string): EditorSpec | undefined => {
    if ((node !== "DHCP-SRV" && node !== "DNS-SRV") || (id !== "b-nano" && id !== "b-nano-ro")) return undefined;
    const dhcp = node === "DHCP-SRV";
    const path = dhcp ? "/etc/dhcp/dhcpd.conf" : `/etc/bind/db.${ZONE}`;
    if (id === "b-nano-ro") return { path, text: dhcp ? c.api.dhcpdText : c.api.zoneText, save: () => "Permission denied", openNote: `[ File '${path}' is unwritable ]` };
    return { path, text: dhcp ? c.api.dhcpdText : c.api.zoneText, save: (t) => ((dhcp ? c.api.saveDhcpd : c.api.saveZone)(t), undefined) };
  };
  return (
    <ConsoleTerminal
      key={key}
      sets={sets}
      vendor={net ? c.vendor : "cisco"}
      setVendor={net ? c.setVendor : undefined}
      os={os}
      host={node}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      onExecuted={(id, ok, line) => ok && c.api.noteCheck(node, id, line)}
      notes={c.notes}
      setNotes={c.setNotes}
      editor={editor}
      question={c.api.question?.node === node ? c.api.question : undefined}
      pipeCtx={
        node === "R1"
          ? {
              config: (which, path) => {
                const e = which === "committed" ? hist[0] : hist[which];
                return e ? junosText(e.cfg, path) : undefined;
              },
              rollbacks: hist.length,
            }
          : undefined
      }
      className={className}
    />
  );
}

function Tabs<T extends string>({ tabs, cur, set }: { tabs: [T, string][]; cur: T; set: (t: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-0.5 border-b border-pv-border px-2 pt-1.5">
      {tabs.map(([id, l]) => (
        <button key={id} type="button" role="tab" aria-selected={cur === id} onClick={() => set(id)} className={clsx("rounded-t-md border border-b-0 px-3 py-1 text-[12px] font-semibold", cur === id ? "border-pv-border bg-pv-bg text-pv-text" : "border-transparent text-pv-text-faint hover:text-pv-text")}>
          {l}
        </button>
      ))}
    </div>
  );
}
function Evidence({ lab, node, coach, state }: { lab: DlState; node: InspectNode; coach: Coach; state?: boolean }) {
  const [sel, setSel] = useState<InvestigateSel>({ ...INITIAL_SEL, node, tab: "device" });
  return state ? <StateTables lab={lab} node={node} coach={coach} /> : <Saw lab={lab} sel={sel} setSel={setSel} coach={coach} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Device interiors
// ---------------------------------------------------------------------------------------------------------------
function RouterUI({ c }: { c: Ctx }) {
  const [tab, setTab0] = useState<"cli" | "config" | "status" | "traffic">("cli");
  const setTab = (t: typeof tab) => {
    if (t === "config") c.api.noteCheck("R1", "view-config", "the Running config tab");
    setTab0(t);
  };
  return (
    <>
      <Tabs tabs={[["cli", "CLI"], ["config", "Running config"], ["status", "Status"], ["traffic", "Traffic"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-2.5">
        {tab === "cli" && (
          <>
            <Note>Click in the console and type. Read before you change, and read again after: a change is only done when you have seen it take effect. Press <b>?</b> at any prompt.</Note>
            <DevConsole c={c} node="R1" />
            <details className="rounded-lg border border-pv-border px-2 py-1">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-pv-text-muted">Command reference (syntax, not answers)</summary>
              <div className="mt-1 grid gap-2 text-[11.5px] text-pv-text-muted sm:grid-cols-2">
                <div className="pv-mono">
                  <p className="font-sans font-semibold text-pv-text">Cisco IOS</p>
                  <p>configure terminal</p>
                  <p>interface &lt;name&gt;</p>
                  <p>ip helper-address &lt;address&gt;</p>
                  <p>no ip helper-address &lt;address&gt;</p>
                  <p>end · do show running-config</p>
                </div>
                <div className="pv-mono">
                  <p className="font-sans font-semibold text-pv-text">Junos</p>
                  <p>configure</p>
                  <p>set forwarding-options dhcp-relay server-group &lt;name&gt; &lt;address&gt;</p>
                  <p>set forwarding-options dhcp-relay group &lt;name&gt; active-server-group &lt;server-group&gt;</p>
                  <p>set forwarding-options dhcp-relay group &lt;name&gt; interface &lt;ifname&gt;</p>
                  <p>commit · exit</p>
                </div>
              </div>
            </details>
          </>
        )}
        {tab === "config" && (
          <>
            <Note>What R1 runs right now (as {c.vendor === "cisco" ? "Cisco IOS" : "Junos"} shows it). Change it from the CLI tab.</Note>
            <Code>{c.vendor === "cisco" ? r1RunningConfig(c.api.helpers, "cisco") : junosText(c.api.junosHist[0].cfg)}</Code>
          </>
        )}
        {tab === "status" && (
          <>
            <DeviceCard embedded lab={c.lab} node="R1" level={6} onClose={() => undefined} onCapture={() => setTab("traffic")} onFollow={() => undefined} onTables={() => undefined} onTerminal={() => setTab("cli")} />
            <Evidence lab={c.lab} node="R1" coach={c.coach} state />
          </>
        )}
        {tab === "traffic" && <Evidence lab={c.lab} node="R1" coach={c.coach} />}
      </div>
    </>
  );
}

function SwitchUI({ c, node }: { c: Ctx; node: "SW1" | "SW2" }) {
  const nm = useIfName();
  const [tab, setTab] = useState<"ports" | "cli" | "traffic">("ports");
  return (
    <>
      <Tabs tabs={[["ports", "Ports"], ["cli", "CLI"], ["traffic", "Traffic"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-2.5">
        {tab === "ports" && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {DL_NODE_IFACES[node].map((i) => {
                const k = c.lab.net.counters[i];
                return (
                  <div key={i} className="min-w-[8.5rem] rounded-lg border border-pv-border p-1.5">
                    <p className="flex items-center gap-1.5 pv-mono text-[11.5px] text-pv-text">
                      <span className="h-2 w-2 rounded-full bg-pv-success" aria-hidden />
                      {nm(i)}
                    </p>
                    <p className="text-[11px] text-pv-text-muted">→ {DL_IFACES[i].faces}</p>
                    <p className="pv-mono text-[10.5px] text-pv-text-faint">
                      in {k.inPkts} · out {k.outPkts}
                    </p>
                  </div>
                );
              })}
            </div>
            <Evidence lab={c.lab} node={node} coach={c.coach} state />
            <Note>All ports are up and forwarding. Nothing in a switch&apos;s configuration is about DHCP or DNS: it carries every frame, broadcasts included, without reading it.</Note>
          </>
        )}
        {tab === "cli" && <DevConsole c={c} node={node} />}
        {tab === "traffic" && <Evidence lab={c.lab} node={node} coach={c.coach} />}
      </div>
    </>
  );
}

function ServerUI({ c, node }: { c: Ctx; node: "DHCP-SRV" | "DNS-SRV" }) {
  const dhcp = node === "DHCP-SRV";
  const [tab, setTab0] = useState<"service" | "terminal" | "status" | "traffic">("terminal");
  const setTab = (t: typeof tab) => {
    if (t === "status") c.api.noteCheck(node, "view-status", "the Status & logs tab");
    setTab0(t);
  };
  const running = dhcp ? dhcpRunning(c.lab.config) : c.lab.config.dnsUp;
  return (
    <>
      <Tabs tabs={[["terminal", "Terminal"], ["service", dhcp ? "File view" : "Zone file view"], ["status", "Status & logs"], ["traffic", "Traffic"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-2.5">
        {tab === "service" &&
          (dhcp ? (
            <>
              <Note>An optional view of the same file you edit in the Terminal (sudo nano /etc/dhcp/dhcpd.conf). isc-dhcp-server reads it only when it (re)starts.</Note>
              <FileEditor
                key="dhcpd"
                path="/etc/dhcp/dhcpd.conf"
                saved={c.api.dhcpdText}
                onSave={c.api.saveDhcpd}
                check={(t) => {
                  const r = parseDhcpd(t);
                  return r.error ? { error: `${r.error}\nConfiguration file errors encountered -- exiting` } : { ok: `no errors (subnets: ${r.subnets.join(", ")})` };
                }}
                apply={(t) => (c.api.restartDhcp(t).error ? { error: 'Job for isc-dhcp-server.service failed because the control process exited with error code.\nSee "systemctl status isc-dhcp-server.service" and "journalctl -xeu isc-dhcp-server.service" for details.' } : {})}
                applyLabel="Restart the service"
                applyCmd="sudo systemctl restart isc-dhcp-server"
                checkCmd="sudo dhcpd -t"
                status={running ? <span className="text-pv-success">● active (running)</span> : c.lab.config.serverUp ? <span className="text-pv-danger">● failed: {dhcpProblem(c.lab.config)}</span> : <span className="text-pv-text-faint">○ inactive (never started)</span>}
                reference={
                  <>
                    <pre className="pv-mono text-pv-text">{`subnet <network> netmask <mask> {\n  range <first-address> <last-address>;\n  option routers <address>;\n  option domain-name-servers <address>;\n}`}</pre>
                    <p>Every statement ends with a semicolon. Options outside any subnet apply to all subnets. # starts a comment.</p>
                  </>
                }
              />
            </>
          ) : (
            <>
              <Note>An optional view of the same file you edit in the Terminal (sudo nano /etc/bind/db.{ZONE}). named keeps answering from the version it loaded last until you reload.</Note>
              <FileEditor
                key="zone"
                path={`/etc/bind/db.${ZONE}`}
                saved={c.api.zoneText}
                onSave={c.api.saveZone}
                check={(t) => {
                  const r = parseZone(t);
                  return r.error ? { error: `zone ${ZONE}/IN: ${r.error}\nzone ${ZONE}/IN: not loaded due to errors.` } : { ok: `zone ${ZONE}/IN: loaded serial 1 (${Object.keys(r.records).length} host record(s))\nOK` };
                }}
                apply={(t) => (c.api.reloadZone(t), { out: "server reload successful" })}
                applyLabel="Reload the zone"
                applyCmd="sudo rndc reload"
                checkCmd={`named-checkzone ${ZONE} /etc/bind/db.${ZONE}`}
                status={running ? <span className="text-pv-success">● named running · {Object.keys(c.lab.records).length} name(s) served</span> : <span className="text-pv-danger">● named stopped</span>}
                reference={
                  <>
                    <pre className="pv-mono text-pv-text">{`<name>    IN  A      <IPv4 address>\n<alias>   IN  CNAME  <name>`}</pre>
                    <p>A name without a final dot is inside the zone (www means www.{ZONE}). ; starts a comment. Keep the SOA and NS lines.</p>
                  </>
                }
              />
            </>
          ))}
        {tab === "terminal" && (
          <>
            <Note>
              You are logged in to {node.toLowerCase()}. Press <b>?</b> to see what you can type here; the configuration file is edited with nano, right in this terminal.
            </Note>
            <DevConsole c={c} node={node} />
          </>
        )}
        {tab === "status" && (
          <>
            <DeviceCard embedded lab={c.lab} node={node} level={6} onClose={() => undefined} onCapture={() => setTab("traffic")} onFollow={() => undefined} onTables={() => undefined} onTerminal={() => setTab("terminal")} />
            <Evidence lab={c.lab} node={node} coach={c.coach} state />
          </>
        )}
        {tab === "traffic" && <Evidence lab={c.lab} node={node} coach={c.coach} />}
      </div>
    </>
  );
}

function PcUI({ c }: { c: Ctx }) {
  const [app, setApp] = useState<"desktop" | "ipconfig" | "cmd" | "traffic">("desktop");
  const cl = c.lab.client;
  const tile = (id: typeof app, icon: string, label: string) => (
    <button type="button" onClick={() => setApp(id)} className="flex w-24 flex-col items-center gap-1 rounded-xl border border-pv-border p-2 text-center hover:border-pv-success/60">
      <span className="text-[24px]" aria-hidden>
        {icon}
      </span>
      <span className="text-[11.5px] font-semibold text-pv-text">{label}</span>
    </button>
  );
  return (
    <div className="p-2.5">
      {app === "desktop" ? (
        <div className="space-y-3 rounded-xl border border-pv-border bg-gradient-to-br from-pv-success/[0.06] to-transparent p-3">
          <div className="flex flex-wrap gap-2">
            {tile("ipconfig", "🖧", "IP Configuration")}
            {tile("cmd", "⌨", "Command Prompt")}
            {tile("traffic", "📈", "Network traffic")}
          </div>
          <Note>This laptop is the user. It has nothing to configure for DHCP or DNS (it obtains everything automatically): use it to check what it received and whether the service works.</Note>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => setApp("desktop")} className="text-[12px] text-pv-text-faint hover:text-pv-text">
            ← Desktop
          </button>
          {app === "ipconfig" && (
            <div className="space-y-1.5 rounded-lg border border-pv-border p-2.5 text-[12.5px]">
              <p className="font-semibold text-pv-text">Ethernet adapter · IPv4 settings</p>
              <p className="text-pv-text">◉ Obtain an IP address automatically (DHCP) &nbsp; ○ Use the following address</p>
              <p className="text-pv-text">◉ Obtain DNS server address automatically &nbsp; ○ Use the following DNS server</p>
              <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-y-0.5 pv-mono text-[12px]">
                <span className="font-sans text-pv-text-muted">IPv4 address</span>
                <span className="text-pv-text">{cl.ip ?? "—"}{cl.phase === "APIPA" ? " (self-assigned)" : ""}</span>
                <span className="font-sans text-pv-text-muted">Default gateway</span>
                <span className="text-pv-text">{cl.gw ?? "—"}</span>
                <span className="font-sans text-pv-text-muted">DNS server</span>
                <span className="text-pv-text">{cl.dns ?? "—"}</span>
                <span className="font-sans text-pv-text-muted">Lease</span>
                <span className="text-pv-text">{configured(cl) ? `from ${cl.serverId}, until ${fmtT((cl.leaseStart ?? 0) + (cl.lease ?? 0))}` : "none"}</span>
              </div>
              <Note>The manual options exist on every PC, but this network&apos;s design is that laptops get these values from DHCP. That&apos;s what you are building.</Note>
            </div>
          )}
          {app === "cmd" && (
            <>
              <Note>A real prompt: ipconfig /renew asks DHCP, nslookup asks DNS, ping tests reachability. What it prints is what the network did. Type help for the commands.</Note>
              <DevConsole c={c} node="CLIENT" />
            </>
          )}
          {app === "traffic" && <Evidence lab={c.lab} node="CLIENT" coach={c.coach} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Window chrome and the desk
// ---------------------------------------------------------------------------------------------------------------
function DeviceWin({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: WinState; c: Ctx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const k = KIND[w.id];
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const body =
    w.id === "R1" ? <RouterUI c={c} /> : w.id === "SW1" || w.id === "SW2" ? <SwitchUI c={c} node={w.id} /> : w.id === "CLIENT" ? <PcUI c={c} /> : <ServerUI c={c} node={w.id} />;
  return (
    <section
      role="dialog"
      aria-label={`${w.id} ${k.kind.toLowerCase()} window`}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        // Escape belongs to the window (minimize), never to the lab behind it.
        if (e.key === "Escape") {
          e.stopPropagation();
          onMin();
        }
      }}
      className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")}
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(760px, calc(100vw - 32px))", height: "min(600px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
    >
      <header
        className={clsx("flex select-none items-center gap-2 border-b border-pv-border px-3 py-2", !narrow && "cursor-move")}
        style={{ background: `linear-gradient(90deg, ${k.tone}22, transparent)` }}
        onPointerDown={(e) => {
          if (narrow || (e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - w.x, dy: e.clientY - w.y };
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* capture is a nicety: dragging still works without it */
          }
        }}
        onPointerMove={(e) => drag.current && onMove(Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy)))}
        onPointerUp={() => (drag.current = undefined)}
      >
        {narrow && (
          <button type="button" onClick={onMin} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text">
            ← Topology
          </button>
        )}
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border text-[14px] font-bold" style={{ borderColor: k.tone, color: k.tone }} aria-hidden>
          {k.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {w.id} <span className="font-normal text-pv-text-muted">· {k.kind}</span>
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{k.model}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${w.id}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${w.id}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      {(w.id === "R1" || w.id === "DHCP-SRV" || w.id === "DNS-SRV") && <VerifyStrip lab={c.lab} journal={c.api.journal} node={w.id} />}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}

/** All open device windows, plus the tray of minimized ones. Portalled so they float above the whole lab. */
export function DeviceDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: WinState[]; setWindows: (u: (w: WinState[]) => WinState[]) => void; focus?: InspectNode; setFocus: (n: InspectNode | undefined) => void; ctx: Ctx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: InspectNode) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  return createPortal(
    <>
      {windows.map((w) => (
        <DeviceWin
          key={w.id}
          w={w}
          c={ctx}
          narrow={narrow}
          focused={focus === w.id}
          onFocus={() => focus !== w.id && raise(w.id)}
          onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))}
          onMin={() => (setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, minimized: true } : v))), setFocus(undefined))}
          onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))}
        />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex -translate-x-1/2 gap-1 rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {windows.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : (setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, minimized: true } : v))), setFocus(undefined)))} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            <span aria-hidden>{KIND[w.id].icon}</span>
            {w.id}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}

export function openWindow(ws: WinState[], id: InspectNode): WinState[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  const have = ws.find((w) => w.id === id);
  if (have) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  // Open on the right, over the tools pane, so the topology (the lab desk) stays in view; cascade for each new one.
  const x = typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - Math.min(760, window.innerWidth - 32) - 24 - n * 32);
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 620, 72 + n * 28));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
export type { Ctx as DeskCtx };
