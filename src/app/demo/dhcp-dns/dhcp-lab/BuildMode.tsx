"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { DNS_NAME } from "@/lib/sim-engine/scenarios/dhcpDns";
import type { DlAction, DlNode, DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { PLAN, ZONE, evalDhcp, evalDns, nextHint, r1RunningConfig, type TestResult } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";
import { MissionBar } from "./Mission";
import type { BuildSnap } from "./buildApi";
import { Journal } from "./Journal";

/**
 * Build it yourself. The student builds DHCP and DNS by working on the devices themselves (tap a device on the
 * topology → its console: R1's CLI, the servers' configuration files and services). This panel only holds what a
 * real engineer would have beside them: the brief, a test bench that proves the service from a new laptop, hints that
 * get stronger only when asked, and, once it works, the proof. Nothing here configures a device.
 */

export { INITIAL_BUILD, makeBuildApi, type BuildSnap } from "./buildApi";

const DHCP_TEST: DlAction[] = [{ type: "new-client" }, { type: "dhcp-all" }, { type: "ping-gateway" }];
const DNS_TEST: DlAction[] = [{ type: "flush" }, { type: "resolve", name: DNS_NAME }, { type: "resolve", name: "mail.packetverse.test" }, { type: "ping-name", name: DNS_NAME }];
type TestKind = "dhcp" | "dns" | "accept";
const FIX_DEVICE: Record<"dhcp" | "relay" | "dns", DlNode> = { dhcp: "DHCP-SRV", relay: "R1", dns: "DNS-SRV" };

const Box = ({ title, tone = "cyan", children }: { title: string; tone?: "cyan" | "violet" | "warning" | "success"; children: ReactNode }) => (
  <div className={clsx("min-w-0 space-y-1.5 rounded-xl border p-2.5", tone === "cyan" ? "border-pv-cyan/40 bg-pv-cyan/[0.04]" : tone === "violet" ? "border-pv-violet/40 bg-pv-violet/[0.05]" : tone === "warning" ? "border-pv-warning/45 bg-pv-warning/[0.05]" : "border-pv-success/45 bg-pv-success/[0.05]")}>
    <p className={clsx("text-[10.5px] font-bold uppercase tracking-[0.12em]", tone === "cyan" ? "text-pv-cyan-soft" : tone === "violet" ? "text-pv-violet" : tone === "warning" ? "text-pv-warning" : "text-pv-success")}>{title}</p>
    {children}
  </div>
);
const Code = ({ children }: { children: string }) => <pre className="overflow-x-auto rounded-lg border border-pv-border bg-[#05080d] p-2 pv-mono text-[11px] leading-relaxed text-pv-text">{children}</pre>;

function Brief() {
  return (
    <Box title="The brief (from the network team)" tone="violet">
      <p className="text-[13px] text-pv-text-muted">Nothing on this network is configured yet for DHCP or DNS. Make it work: laptops plugged into the laptops&apos; network must get their settings automatically and be able to use names.</p>
      <ul className="grid gap-x-4 gap-y-0.5 text-[12.5px] text-pv-text sm:grid-cols-2">
        <li>Laptops&apos; network: <b className="pv-mono">{PLAN.clientNet}/24</b></li>
        <li>Addresses for laptops: <b className="pv-mono">{PLAN.range.start} – {PLAN.range.end}</b></li>
        <li>Their router: <b className="pv-mono">{PLAN.router}</b> (R1)</li>
        <li>DHCP server: <b className="pv-mono">{PLAN.dhcpServer}</b> · DNS server: <b className="pv-mono">{PLAN.dnsServer}</b></li>
        {Object.entries(PLAN.names).map(([n, ip]) => (
          <li key={n}>
            <b className="pv-mono">{n}</b> must answer <b className="pv-mono">{ip}</b>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-pv-text">
        <b>Done means:</b> a brand-new laptop gets an address in the range, the right router and DNS server, resolves both names, and reaches the web server by name.
      </p>
    </Box>
  );
}

function ResultView({ title, r, proves, notProves, onFollow, onDevice }: { title: string; r: TestResult; proves: string; notProves: string; onFollow: () => void; onDevice: (n: DlNode) => void }) {
  const [reveal, setReveal] = useState(false);
  const d = r.diagnosis;
  return (
    <div className={clsx("space-y-1.5 rounded-xl border p-2.5", r.pass ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-danger/45 bg-pv-danger/[0.04]")}>
      <p className={clsx("text-[13.5px] font-bold", r.pass ? "text-pv-success" : "text-pv-danger")}>
        {r.pass ? "✓" : "✕"} {title}: {r.pass ? "works" : "does not work yet"}
      </p>
      <ul className="space-y-0.5">
        {r.checks.map((k) => (
          <li key={k.id} className="text-[12.5px]">
            <span className={k.ok ? "text-pv-success" : "text-pv-danger"}>{k.ok ? "✓" : "✕"}</span> <span className="text-pv-text">{k.label}</span> <span className="pv-mono text-[11.5px] text-pv-text-faint">· {k.seen}</span>
          </li>
        ))}
      </ul>
      {r.pass ? (
        <p className="text-[12.5px] text-pv-text-muted">
          <b className="text-pv-text">This proves:</b> {proves} <b className="text-pv-text">It doesn&apos;t prove:</b> {notProves}
        </p>
      ) : (
        d && (
          <div className="space-y-1 rounded-lg border border-pv-border bg-pv-bg/60 p-2">
            <p className="text-[12.5px] text-pv-text">
              <b>Where the evidence stops:</b> {d.where}. {d.evidence}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={onFollow} className="rounded-full border border-pv-cyan/60 px-2.5 py-0.5 text-[12px] font-semibold text-pv-cyan-soft">
                Follow the traffic →
              </button>
              {d.where !== "WEB" && (
                <button type="button" onClick={() => onDevice(d.where)} className="rounded-full border border-pv-violet/60 px-2.5 py-0.5 text-[12px] font-semibold text-pv-text">
                  Show {d.where} on the topology
                </button>
              )}
              <button type="button" onClick={() => setReveal(!reveal)} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] text-pv-text-muted hover:text-pv-text">
                {reveal ? "Hide what's responsible" : "Which part of my build is responsible?"}
              </button>
            </div>
            {reveal && (
              <div className="pv-pop space-y-1">
                <p className="text-[12.5px] text-pv-text-muted">
                  <b className="text-pv-text">Settings involved:</b> {d.involved.join(" · ")}
                </p>
                <p className="text-[12.5px] text-pv-text">
                  <b>{d.area}:</b> {d.cause}
                </p>
                <p className="text-[12.5px] text-pv-text-muted">
                  Fix it on <b className="text-pv-text">{FIX_DEVICE[d.fix]}</b>: open it from the topology.{" "}
                  <button type="button" onClick={() => onDevice(FIX_DEVICE[d.fix])} className="font-semibold text-pv-cyan-soft hover:underline">
                    Where is it?
                  </button>
                </p>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function Hints({ snap, setSnap, onDevice }: { snap: BuildSnap; setSnap: Dispatch<SetStateAction<BuildSnap>>; onDevice: (n: DlNode) => void }) {
  const h = nextHint(snap.config, snap.records, snap.r1);
  const level = h ? (snap.hints[h.id] ?? 0) : 0;
  const open = (n: number) => h && setSnap((s) => ({ ...s, hints: { ...s.hints, [h.id]: Math.max(s.hints[h.id] ?? 0, n) } }));
  if (!h) return <p className="text-[12.5px] text-pv-text-muted">No hint needed: as far as the configuration goes, everything is in place. Prove it with the tests.</p>;
  return (
    <div className="space-y-1.5">
      {level === 0 && (
        <button type="button" onClick={() => open(1)} className="rounded-full border border-pv-warning/60 px-3 py-1 text-[12.5px] font-semibold text-pv-text">
          I&apos;m stuck: give me a hint
        </button>
      )}
      {level >= 1 && (
        <div className="rounded-lg border border-pv-warning/45 bg-pv-warning/[0.05] p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-warning">Hint 1 · where to look</p>
          <p className="text-[13px] text-pv-text">{h.where}</p>
          <button type="button" onClick={() => onDevice(h.device)} className="mt-0.5 text-[12px] font-semibold text-pv-cyan-soft hover:underline">
            Show me which device on the topology
          </button>
        </div>
      )}
      {level >= 2 && (
        <div className="rounded-lg border border-pv-warning/45 bg-pv-warning/[0.05] p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-warning">Hint 2 · what&apos;s missing</p>
          <p className="text-[13px] text-pv-text">{h.what}</p>
        </div>
      )}
      {level >= 3 && (
        <div className="rounded-lg border border-pv-danger/40 bg-pv-danger/[0.04] p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-danger">Hint 3 · the configuration</p>
          <Code>{h.how}</Code>
        </div>
      )}
      {level >= 1 && level < 3 && (
        <button type="button" onClick={() => open(level + 1)} className="text-[12px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
          {level === 1 ? "Still stuck: what kind of configuration is missing?" : "Show me the configuration"}
        </button>
      )}
    </div>
  );
}

export function BuildMode({ lab, act, onBatch, snap, setSnap, onFollow, onDevice }: { lab: DlState; act: (a: DlAction) => void; onBatch?: (from: number) => void; snap: BuildSnap; setSnap: Dispatch<SetStateAction<BuildSnap>>; onFollow: () => void; onDevice: (n: DlNode) => void }) {
  const [test, setTest] = useState<{ kind: TestKind; marker: number } | undefined>(undefined);
  const [testSeq, setTestSeq] = useState<number | undefined>(undefined);
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    setTestSeq(lab.seq);
  }, [lab.seq]);
  const run = (kind: TestKind) => {
    const marker = lab.capture.length ? lab.capture[lab.capture.length - 1].no : 0;
    (kind === "dhcp" ? DHCP_TEST : kind === "dns" ? DNS_TEST : [...DHCP_TEST, ...DNS_TEST]).forEach((a) => act(a));
    // The topology replays everything this test sent (from this marker on), so the student watches it cross the network.
    onBatch?.(marker);
    pending.current = true;
    setTest({ kind, marker });
  };
  const fresh = test && testSeq === lab.seq;
  const dhcpR = fresh && test.kind !== "dns" ? evalDhcp(lab, test.marker) : undefined;
  const dnsR = fresh && test.kind !== "dhcp" ? evalDns(lab, test.marker) : undefined;
  const accepted = !!(fresh && test.kind === "accept" && dhcpR?.pass && dnsR?.pass);
  const hintsUsed = Object.values(snap.hints);
  const strongest = hintsUsed.length ? Math.max(...hintsUsed) : 0;
  const mission = accepted
    ? { task: "You built it, and proved it", look: "the proof below", next: "break it on purpose and watch the tests catch it" }
    : fresh && (dhcpR?.pass === false || dnsR?.pass === false)
      ? { task: "Something in your build isn't working yet", look: "the failed test: where the evidence stops", next: "open that device from the topology, find the cause, fix it, test again" }
      : { task: "Build DHCP and DNS for the laptops", look: "the topology: which device has to do something?", next: "click a device to open it, work inside it, close it, then test" };
  const btn = (kind: TestKind, label: string, cmds: string) => (
    <div className="space-y-0.5">
      <button type="button" onClick={() => run(kind)} className={clsx("rounded-full px-4 py-1.5 text-[13px] font-bold", kind === "accept" ? "bg-pv-success/80 text-[#03131a]" : "bg-pv-cyan text-[#03131a]")}>
        ▶ {label}
      </button>
      <p className="pv-mono text-[10.5px] text-pv-text-faint">{cmds}</p>
    </div>
  );
  return (
    <section aria-label="Level 7" className="space-y-3">
      <MissionBar station="Build it yourself" task={mission.task} look={mission.look} next={mission.next} />
      <Brief />

      <Box title="Test bench: a new laptop, plugged in" tone="cyan">
        <div className="flex flex-wrap gap-3">
          {btn("dhcp", "Test DHCP", "ipconfig /renew · ipconfig /all · ping <gateway>")}
          {btn("dns", "Test DNS", "ipconfig /flushdns · nslookup www · nslookup mail · ping www")}
          {btn("accept", "Prove the whole service", "both, from a brand-new laptop")}
        </div>
        {test && !fresh && <p className="text-[12px] text-pv-text-faint">The network changed since this test ran: run it again.</p>}
        {dhcpR && <ResultView title="DHCP" r={dhcpR} proves="a new laptop gets an address in the range, a router that answers and the planned DNS server." notProves="that names work." onFollow={onFollow} onDevice={onDevice} />}
        {dnsR && <ResultView title="DNS" r={dnsR} proves="the laptop asks the right DNS server, the records are right, and the web server answers by name." notProves="that names outside the brief exist." onFollow={onFollow} onDevice={onDevice} />}
      </Box>

      <Journal lab={lab} journal={snap.journal} onDevice={onDevice} />

      {!accepted && (
        <Box title="Hints, only if you want them" tone="warning">
          <Hints snap={snap} setSnap={setSnap} onDevice={onDevice} />
        </Box>
      )}

      {accepted && (
        <Box title="Proof: your network works" tone="success">
          <ul className="space-y-0.5 text-[13px] text-pv-text">
            <li>✓ A new laptop received {lab.client.ip} (in {PLAN.range.start} – {PLAN.range.end})</li>
            <li>✓ Its router is {lab.client.gw}, and it answers</li>
            <li>✓ Its DNS server is {lab.client.dns}</li>
            {Object.entries(PLAN.names).map(([n, ip]) => (
              <li key={n}>
                ✓ {n} resolves to {ip}
              </li>
            ))}
            <li>✓ ping {DNS_NAME} reaches the web server</li>
          </ul>
          <p className="text-[12.5px] text-pv-text-muted">{strongest === 0 ? "Built without any hints." : strongest === 3 ? `Built with ${hintsUsed.length} hint(s), including the exact configuration for at least one part. Try it again from scratch without them.` : `Built with ${hintsUsed.length} hint(s), never the exact configuration.`}</p>
          <div className="grid gap-2 lg:grid-cols-3">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-pv-text">DHCP-SRV · /etc/dhcp/dhcpd.conf</p>
              <Code>{snap.files.dhcpd}</Code>
            </div>
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-pv-text">R1 · running-config (interfaces)</p>
              <Code>{r1RunningConfig(snap.r1, "cisco").split("\n").filter((l) => !/^(hostname|ip route|end|!)/.test(l)).join("\n")}</Code>
            </div>
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-pv-text">DNS-SRV · db.{ZONE}</p>
              <Code>{snap.files.zone}</Code>
            </div>
          </div>
        </Box>
      )}
      {accepted && (
        <Box title="Now break it yourself" tone="warning">
          <p className="text-[12.5px] text-pv-text-muted">Change one thing on a device, prove the service again, and read what fails and where the evidence stops. Then put it back.</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-pv-text">
            <li>On R1, move the helper address to the servers&apos; interface.</li>
            <li>On R1, point the helper at the DNS server instead.</li>
            <li>On DHCP-SRV, give out the DHCP server&apos;s own address as the DNS server (option 6).</li>
            <li>On DHCP-SRV, remove one semicolon, restart, and read the service status.</li>
            <li>On DNS-SRV, mistype the address of www, then reload.</li>
          </ul>
        </Box>
      )}
    </section>
  );
}
