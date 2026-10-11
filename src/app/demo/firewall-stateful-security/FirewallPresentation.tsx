"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * Stateful firewall — the presentation before the lesson/lab. Builds on TCP & UDP (the handshake, ports), Routing (a
 * route decides the egress interface) and VLANs (separating groups of hosts): FW1 between trust (CLIENT, LAB), dmz
 * (the company web server) and untrust (ISP → WEB, OUT). Zones and rule order, the default deny, sessions, source
 * and destination NAT, and what a half-open session tells you.
 */
type Id = "why" | "zones" | "pair" | "order" | "deny" | "shadow" | "session" | "reply" | "stray" | "snat" | "pat" | "badnat" | "dnat" | "real" | "dmzout" | "half" | "refused" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why a firewall", title: "A router forwards everything it has a route for.", body: <p>That&apos;s exactly what you don&apos;t want at the internet edge. The office should start connections out; the internet should reach only what you publish; and private addresses must never leave. A <Bb>firewall</Bb> routes — and decides.</p> },
  { id: "zones", chapter: "Zones", title: "Interfaces belong to zones.", body: <p>FW1&apos;s three interfaces sit in three <Bb>zones</Bb>: trust (the office), dmz (servers the internet may reach) and untrust (the ISP and the internet). The route lookup tells FW1 which zone a packet is going to.</p> },
  { id: "pair", chapter: "Zones", title: "Policy is written per zone pair, per direction.", body: <p>trust → untrust, untrust → dmz, trust → dmz… each is its own list. A rule for trust → untrust says nothing about untrust → trust — and nothing needs to: replies are handled by sessions.</p> },
  { id: "order", chapter: "Rules", title: "Top-down, first match wins.", body: <p>Each rule matches source, destination and application. FW1 walks the list of that zone pair from the top and stops at the <Bb>first match</Bb>: permit or deny.</p> },
  { id: "deny", chapter: "Rules", title: "Nothing matched? The implicit default deny.", body: <p>Every zone pair ends with an invisible last rule that denies everything. Allow what you mean; everything else is already blocked.</p> },
  { id: "shadow", chapter: "Rules", title: "A deny that is too broad hides the allows below.", body: <p>BLOCK-LAB was meant for the lab PCs (10.10.10.128/25). Typed as the whole office (10.10.10.0/24), it matches every HTTPS attempt before ALLOW-WEB is reached. Ping still works — it&apos;s allowed above.</p> },
  { id: "session", chapter: "Sessions", title: "The first packet creates a session.", body: <p>CLIENT&apos;s SYN: no session → route → policy permits → FW1 writes a <Bb>session</Bb>: both addresses, both ports, the translation, the TCP state (SYN_SENT).</p> },
  { id: "reply", chapter: "Sessions", title: "Replies match the session in reverse.", body: <p>WEB&apos;s SYN-ACK arrives from untrust. FW1 checks the session table <Bb>first</Bb>: it&apos;s the reverse of session 3001 — translated back and forwarded, no rule needed. After the ACK: ESTABLISHED.</p> },
  { id: "stray", chapter: "Sessions", title: "No session, no entry.", body: <p>An ACK from the internet that belongs to no session is dropped: only a SYN can start a session, and only if a rule allows it. Stateful means the firewall knows what it is waiting for.</p> },
  { id: "snat", chapter: "Source NAT", title: "Private addresses can't travel on the internet.", body: <p>On the way out FW1 rewrites the <Bb>source</Bb>: 10.10.10.10:51000 becomes 198.51.100.2:40001 — FW1&apos;s own public address, which the ISP routes back to us. The destination is untouched.</p> },
  { id: "pat", chapter: "Source NAT", title: "Many clients, one address: ports.", body: <p>Every connection gets its own public port (PAT). Only the session table knows that 40002 belongs to CLIENT&apos;s HTTP and 40003 to LAB&apos;s ping.</p> },
  { id: "badnat", chapter: "Source NAT", title: "Translated to the wrong address: replies go nowhere.", body: <p>With 198.51.100.99 as the source, WEB answers to an address the ISP doesn&apos;t route to us. The policy said ALLOW, the session exists — and stays <Bb>SYN_SENT</Bb> forever.</p> },
  { id: "dnat", chapter: "Publishing a server", title: "Destination NAT: the internet reaches the DMZ.", body: <p>OUT connects to 198.51.100.2:443. FW1 rewrites the <Bb>destination</Bb> to the DMZ server 172.16.0.10:443, routes it to the dmz zone and checks untrust → dmz.</p> },
  { id: "real", chapter: "Publishing a server", title: "The policy sees the real address.", body: <p>Destination NAT happens <Bb>before</Bb> the policy lookup. A rule written for 198.51.100.2 never matches: write it for 172.16.0.10 (DMZ-WEB). Junos and the IOS zone-based firewall agree.</p> },
  { id: "dmzout", chapter: "Publishing a server", title: "The DMZ needs source NAT too.", body: <p>When the DMZ server fetches updates, its private source must be translated as well. Without SNAT-DMZ the SYN leaves as 172.16.0.10 and the reply has no route home.</p> },
  { id: "half", chapter: "Reading the path", title: "A half-open session points past the firewall.", body: <p>Session created by PUBLISH-WEB, never ESTABLISHED: the server answered to the wrong gateway. FW1 never saw the reply. Denied packets never create sessions — half-open ones mean <Bb>look at the return path</Bb>.</p> },
  { id: "refused", chapter: "Reading the path", title: "Timeout or refused?", body: <p>A <Bb>timeout</Bb>: something dropped the packet silently (a deny, a missing route). <Bb>Connection refused</Bb>: it arrived, and the host answered RST — nothing listens on that port. Different problems, different places.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Rules, sessions, translations, logs.", body: <p>Hit counts show which rule takes the traffic; the session table shows how far a connection got; translations show what the internet saw; logs say what was dropped and why.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the first packet, then the reply.", body: <p>Zone → rule → translation → session → reply. Fix the one step that failed.</p> },
  { id: "recap", chapter: "The whole idea", title: "Route, decide, remember, translate.", body: <p>Now follow one HTTPS connection in the lesson, then break and repair FW1 in the Firewall Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", zones: "net", pair: "net", order: "order", deny: "net", shadow: "shadow", session: "net", reply: "net", stray: "net", snat: "snat", pat: "pat", badnat: "net", dnat: "net", real: "net", dmzout: "net", half: "net", refused: "refused", verify: "verify", trouble: "trouble", recap: "recap" };
const NODES: TopoNode[] = [
  { id: "c", label: "CLIENT", sub: "10.10.10.10", icon: "💻", x: 7, y: 26 },
  { id: "l", label: "LAB", sub: "10.10.10.200", icon: "💻", x: 7, y: 70 },
  { id: "fw", label: "FW1", sub: "trust · dmz · untrust", icon: "🛡", x: 34, y: 48 },
  { id: "d", label: "DMZ", sub: "172.16.0.10", icon: "🖥", x: 34, y: 88 },
  { id: "isp", label: "ISP", sub: "198.51.100.1", icon: "R", x: 63, y: 48 },
  { id: "w", label: "WEB", sub: "203.0.113.80", icon: "🖥", x: 93, y: 26 },
  { id: "o", label: "OUT", sub: "203.0.113.50", icon: "💻", x: 93, y: 70 },
];
const at = (n: string) => nodeAt(NODES, n);
function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={650} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "net") {
    const links: TopoLink[] = [
      { a: "c", b: "fw", label: id === "zones" ? "trust" : undefined, state: ["session", "reply", "badnat"].includes(id) ? "active" : "up" },
      { a: "l", b: "fw", label: id === "zones" ? "trust" : undefined },
      { a: "fw", b: "d", label: id === "zones" ? "dmz" : undefined, state: ["dnat", "half", "dmzout"].includes(id) ? "active" : "up" },
      { a: "fw", b: "isp", label: id === "zones" ? "untrust" : undefined, state: ["session", "reply", "dnat", "badnat", "dmzout", "half"].includes(id) ? "active" : "up" },
      { a: "isp", b: "w", state: ["session", "reply", "badnat", "dmzout"].includes(id) ? "active" : "up" },
      { a: "isp", b: "o", state: ["dnat", "half", "stray"].includes(id) ? "active" : "up" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") views.fw = { bubble: { text: "route… and decide", tone: "info" } };
    if (id === "pair") {
      views.fw = { ring: "on", bubble: { text: "trust → untrust · untrust → dmz · trust → dmz", tone: "info" } };
    }
    if (id === "deny") {
      movers = go("c", "fw", { label: "SSH → WEB", key: "1", stay: true, color: "red" });
      views.fw = { ring: "bad", bubble: { text: "no rule matches → default deny", tone: "bad" } };
    }
    if (id === "session")
      movers = (
        <>
          {go("c", "fw", { label: "SYN", key: "1" })}
          {go("fw", "isp", { label: "SYN", key: "2", delay: 700 })}
          {go("isp", "w", { label: "SYN", key: "3", delay: 1300 })}
        </>
      );
    if (id === "session") views.fw = { bubble: { text: "no session → route → ALLOW-WEB → session 3001", tone: "yes", delay: 600 } };
    if (id === "reply") {
      movers = (
        <>
          {go("w", "isp", { label: "SYN-ACK", key: "1", color: "green" })}
          {go("isp", "fw", { label: "SYN-ACK", key: "2", delay: 600, color: "green" })}
          {go("fw", "c", { label: "SYN-ACK", key: "3", delay: 1200, color: "green" })}
        </>
      );
      views.fw = { ring: "on", bubble: { text: "matches session 3001 in reverse", tone: "yes", delay: 600 } };
    }
    if (id === "stray") {
      movers = (
        <>
          {go("o", "isp", { label: "ACK?", key: "1", color: "violet" })}
          {go("isp", "fw", { label: "ACK?", key: "2", delay: 600, stay: true, color: "violet" })}
        </>
      );
      views.fw = { ring: "bad", bubble: { text: "no session · not a SYN → drop", tone: "bad", delay: 900 } };
    }
    if (id === "badnat") {
      movers = (
        <>
          {go("w", "isp", { label: "SYN-ACK → .99", key: "1", stay: true, color: "red" })}
        </>
      );
      views.isp = { ring: "bad", bubble: { text: "no route to 198.51.100.99", tone: "bad" } };
      views.fw = { bubble: { text: "session 3001: SYN_SENT…", tone: "warn", delay: 400 } };
    }
    if (id === "dnat" || id === "real") {
      movers = (
        <>
          {go("o", "isp", { label: "→ 198.51.100.2:443", key: "1" })}
          {go("isp", "fw", { label: "→ 198.51.100.2:443", key: "2", delay: 600 })}
          {id === "dnat" ? go("fw", "d", { label: "→ 172.16.0.10:443", key: "3", delay: 1300 }) : null}
        </>
      );
      views.fw = id === "dnat" ? { ring: "on", bubble: { text: "DNAT → 172.16.0.10 · policy untrust → dmz", tone: "yes", delay: 700 } } : { ring: "bad", bubble: { text: "rule says 198.51.100.2 — policy sees 172.16.0.10", tone: "bad", delay: 700 } };
    }
    if (id === "dmzout") {
      movers = (
        <>
          {go("d", "fw", { label: "SYN from 172.16.0.10", key: "1" })}
          {go("fw", "isp", { label: "src 172.16.0.10 (no SNAT)", key: "2", delay: 700, color: "red" })}
        </>
      );
      views.isp = { ring: "bad", bubble: { text: "reply to 172.16.0.10? no route", tone: "bad", delay: 1300 } };
    }
    if (id === "half") {
      movers = go("d", "fw", { label: "SYN-ACK → .254 ?", key: "1", stay: true, color: "red" });
      views.d = { ring: "bad", bubble: { text: "gateway 172.16.0.254 never answers ARP", tone: "bad" } };
      views.fw = { bubble: { text: "session created · still SYN_SENT", tone: "warn", delay: 400 } };
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={50} minH={250}>
          {movers}
        </Topo>
        {["deny", "session", "reply", "stray", "badnat", "dnat", "real", "dmzout", "half"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "order":
      return (
        <>
          {head}
          <MiniTable title="trust → untrust (top to bottom)" cols={["#", "Rule", "Source → destination", "App", "Action"]} rows={[{ cells: ["1", "ALLOW-PING", "CLIENTS → any", "icmp", "permit"] }, { cells: ["2", "BLOCK-LAB", "LAB-PCS → any", "any", "deny"] }, { cells: ["3", "ALLOW-WEB", "CLIENTS → any", "https", "permit"], state: "hit" }, { cells: ["4", "ALLOW-HTTP", "CLIENTS → any", "http", "permit"] }, { cells: ["5", "(implicit)", "any → any", "any", "deny"] }]} />
        </>
      );
    case "shadow":
      return (
        <>
          {head}
          <MiniTable title="BLOCK-LAB typed with the wrong source" cols={["#", "Rule", "Source", "App", "Hits"]} rows={[{ cells: ["1", "ALLOW-PING", "CLIENTS", "icmp", "12"] }, { cells: ["2", "BLOCK-LAB (deny)", "CLIENTS ✗ (meant LAB-PCS)", "any", "348"], state: "hit" }, { cells: ["3", "ALLOW-WEB", "CLIENTS", "https", "0"] }]} />
          <Compare items={[{ title: "Symptom", tone: "amber", body: "HTTPS fails for everyone; ping works" }, { title: "Evidence", tone: "cyan", body: "the deny counts, the allow below stays at 0" }]} />
        </>
      );
    case "snat":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <PacketCard layers={[{ name: "On FW1's trust side", color: "#22d3ee", fields: [{ k: "src", v: "10.10.10.10:51000", hi: "key" }, { k: "dst", v: "203.0.113.80:443" }, { k: "flags", v: "SYN" }] }]} />
            <PacketCard layers={[{ name: "On FW1's untrust side", color: "#f59e0b", fields: [{ k: "src", v: "198.51.100.2:40001", hi: "key" }, { k: "dst", v: "203.0.113.80:443" }, { k: "flags", v: "SYN" }] }]} />
          </div>
        </>
      );
    case "pat":
      return (
        <>
          {head}
          <MiniTable title="One public address, one port per connection" cols={["Inside", "Outside (after PAT)", "To"]} rows={[{ cells: ["10.10.10.10:51000", "198.51.100.2:40001", "WEB:443"] }, { cells: ["10.10.10.10:51001", "198.51.100.2:40002", "WEB:80"] }, { cells: ["10.10.10.200 (ping)", "198.51.100.2:40003", "WEB"] }]} />
        </>
      );
    case "refused":
      return (
        <>
          {head}
          <Compare items={[{ title: "Timeout", tone: "amber", body: "no answer at all — a deny, a missing route, a lost reply" }, { title: "Connection refused", tone: "red", body: "an RST came back — the host is reachable, nothing listens" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS zone-based firewall" cols={["Question", "Command"]} rows={[{ cells: ["Which class takes it?", "show policy-map type inspect zone-pair"] }, { cells: ["How far did it get?", "show policy-map type inspect zone-pair sessions"] }, { cells: ["What was translated?", "show ip nat translations"] }, { cells: ["What was dropped?", "show logging (%FW-6-DROP_PKT)"] }]} />
            <MiniTable title="Junos SRX" cols={["Question", "Command"]} rows={[{ cells: ["Which policy takes it?", "show security policies hit-count"] }, { cells: ["How far did it get?", "show security flow session"] }, { cells: ["What was translated?", "show security nat source rule all"] }, { cells: ["What was dropped?", "show log messages (RT_FLOW)"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Symptom: denied, hanging or refused?", tone: "red" }, { t: "Did it reach FW1 — in which zone?", tone: "cyan" }, { t: "Which rule matched (hit counts, deny log)?", tone: "violet" }, { t: "What was translated (SNAT out, DNAT in)?", tone: "amber" }, { t: "Session ESTABLISHED — or half-open: follow the reply", tone: "amber" }, { t: "Fix one step; prove allowed AND still-blocked traffic", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Zones; policy per zone pair; first match; default deny" }, { t: "Sessions admit replies — and nothing unsolicited", tone: "green" }, { t: "Source NAT to an address the internet routes back", tone: "amber" }, { t: "Destination NAT before policy: rules use the real address", tone: "violet" }, { t: "Half-open session = the reply died past the firewall", tone: "cyan" }]} />
        </>
      );
  }
  return head;
}
export function FirewallPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="Stateful firewalls, from zero" kicker="Learn · the firewall presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
