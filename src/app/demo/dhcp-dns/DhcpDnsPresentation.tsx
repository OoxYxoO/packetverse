"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoNode, type TopoRegion, type TopoView } from "@/components/presentation/Visuals";
import { DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, POOL } from "@/lib/sim-engine/scenarios/dhcpDns";

/**
 * DHCP + DNS — the presentation before the lesson, on the lesson's network (CLIENT — SW1 — R1 relay — SW2 —
 * DHCP-SRV / DNS-SRV) and incident (Option 6 points at 10.20.20.99; fixing the server doesn't rewrite a lease the
 * client already holds). Presentation state only.
 */

type Id = "why" | "nothing" | "discover" | "relay" | "offer" | "request" | "ack" | "dora" | "renew" | "dns-why" | "query" | "answer" | "ttl" | "incident" | "names-fail" | "trouble" | "renew-fix" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const RC = DH_ADDR["R1:CLIENT"];
const SRV = DH_ADDR["DHCP-SRV"];
const DNS = DH_ADDR["DNS-SRV"];
const IP = DH_ADDR.CLIENT;

const STEPS: Step[] = [
  { id: "why", chapter: "Why DHCP exists", title: "A new laptop plugs in. It has no IP address.", body: <p>To talk to anything, a host needs four settings: an <Bb>IP address</Bb>, a <Bb>mask</Bb>, a <Bb>default gateway</Bb> and a <Bb>DNS server</Bb>. Typing them on every device doesn&apos;t scale and invites mistakes. <Bb>DHCP</Bb> hands them out automatically.</p> },
  { id: "nothing", chapter: "Why DHCP exists", title: "It starts from nothing: source 0.0.0.0, destination “everyone”.", body: <p>The client doesn&apos;t know its own address or the server&apos;s, so it sends from <M>0.0.0.0</M> to the broadcast <M>255.255.255.255</M>, UDP port 68 → 67.</p> },
  { id: "discover", chapter: "D · Discover", title: "DISCOVER: “Is there a DHCP server out there?”", body: <p>SW1 floods the broadcast across the client LAN. But the DHCP server is on <Bb>another network</Bb>, and routers don&apos;t forward broadcasts.</p> },
  { id: "relay", chapter: "D · Discover", title: "R1 relays it as a unicast, stamping giaddr.", body: <p>R1 is a <Bb>DHCP relay agent</Bb>: it writes its client-side address into <M>giaddr = {RC}</M> and unicasts the message to the server {SRV} (UDP 67 → 67). giaddr tells the server which subnet the client is on.</p> },
  { id: "offer", chapter: "O · Offer", title: `OFFER: “You can have ${IP}.”`, body: <p>The server picks the pool matching giaddr ({POOL.subnet}), offers {IP}, and replies to the relay. The client asked for broadcast replies (it has no address yet), so R1 broadcasts the OFFER onto the client LAN.</p> },
  { id: "request", chapter: "R · Request", title: "REQUEST: “I'll take it, from that server.”", body: <p>Still broadcast, carrying <Bb>Option 50</Bb> (requested IP) and <Bb>Option 54</Bb> (server identifier), so every server learns which offer was accepted. The transaction ID (xid) stays the same through all four messages.</p> },
  { id: "ack", chapter: "A · Acknowledge", title: "ACK: the lease is confirmed. The client is BOUND.", body: <p>The client now has {IP}/24, gateway {RC}, DNS {DNS} (<Bb>Option 6</Bb>) and a lease of {LEASE_SECONDS / 3600} hours.</p> },
  { id: "dora", chapter: "DORA", title: "Discover · Offer · Request · Acknowledge.", body: <p>Four messages, one transaction, relayed across the router.</p> },
  { id: "renew", chapter: "Leases", title: "Halfway through the lease, the client renews directly.", body: <p>Now it has an address, so the renewal is a plain <Bb>unicast REQUEST</Bb> from {IP} straight to {SRV}, routed normally, not relayed. The ACK extends the lease and carries the <Bb>current</Bb> options.</p> },
  { id: "dns-why", chapter: "Why DNS exists", title: "People type names. Packets need IP addresses.", body: <p>The browser wants <M>{DNS_NAME}</M>. Before a single packet can go there, something must turn that name into an IP address. That&apos;s <Bb>DNS</Bb>, using the server DHCP just provided.</p> },
  { id: "query", chapter: "DNS", title: `Query: “What's the A record for ${DNS_NAME}?”`, body: <p>A small UDP message to {DNS} port 53 with a <Bb>Transaction ID</Bb> and RD (recursion desired). {DNS} is remote, so it goes via the gateway like any packet.</p> },
  { id: "answer", chapter: "DNS", title: `Answer: ${DH_ADDR.WEB}, valid for ${DNS_RECORD_TTL} s.`, body: <p>The response echoes the Transaction ID (so the client can match it), sets QR and RA, and carries the answer. The client caches it for the record&apos;s TTL.</p> },
  { id: "ttl", chapter: "DNS", title: "Two different TTLs.", body: <p>The <Bb>DNS record TTL</Bb> ({DNS_RECORD_TTL} s) says how long an answer may be cached. The <Bb>IPv4 TTL</Bb> counts router hops. Same name, unrelated jobs.</p> },
  { id: "incident", chapter: "The incident", title: `Option 6 was set to ${DH_ADDR.WRONG_DNS}.`, body: <p>The client re-acquires a lease and receives a DNS server address <Bb>where no DNS server exists</Bb>.</p> },
  { id: "names-fail", chapter: "The incident", title: "Names fail. IP addresses work.", body: <p>Queries to {DH_ADDR.WRONG_DNS} get no response, so “the internet is down” for the user. But <M>ping {DH_ADDR.WEB}</M> works: routing is fine. That contrast is the key clue.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the configuration back to its source.", body: <p>Client DNS = {DH_ADDR.WRONG_DNS} → where did it come from? → the DHCP lease → the server&apos;s Option 6. Fix the scope option.</p> },
  { id: "renew-fix", chapter: "Troubleshooting", title: "Fixing the server isn't enough: the client must renew.", body: <p>A lease the client already holds isn&apos;t rewritten. After a <Bb>renew</Bb>, the ACK carries DNS {DNS}; the next query is answered. Verify by resolving the name, not just by reading the server config.</p> },
  { id: "recap", chapter: "The whole idea", title: "DHCP gives the host its settings; DNS turns names into addresses.", body: <p>Now follow every message through the relay in the lesson, then find and fix the Option 6 incident.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", nothing: "pkt", discover: "net", relay: "net", offer: "net", request: "net", ack: "net", dora: "dora", renew: "net", "dns-why": "dnswhy", query: "net", answer: "net", ttl: "ttl", incident: "net", "names-fail": "net", trouble: "trouble", "renew-fix": "net", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "c", label: "CLIENT", sub: "no IP yet", icon: "💻", x: 8, y: 55 },
  { id: "sw1", label: "SW1", icon: "⇄", x: 26, y: 55 },
  { id: "r1", label: "R1 relay", sub: RC, icon: "R", x: 47, y: 55 },
  { id: "sw2", label: "SW2", icon: "⇄", x: 66, y: 55 },
  { id: "dhcp", label: "DHCP-SRV", sub: SRV, icon: "🗄", x: 89, y: 33 },
  { id: "dns", label: "DNS-SRV", sub: DNS, icon: "🗄", x: 89, y: 85 },
];
const LINKS = [
  { a: "c", b: "sw1" },
  { a: "sw1", b: "r1" },
  { a: "r1", b: "sw2" },
  { a: "sw2", b: "dhcp" },
  { a: "sw2", b: "dns" },
];
const REGIONS: TopoRegion[] = [
  { x: 0, y: 6, w: 46, h: 88, label: "client LAN 10.10.10.0/24", color: "#22d3ee" },
  { x: 48, y: 6, w: 52, h: 88, label: "server LAN 10.20.20.0/24", color: "#a78bfa" },
];
const at = (n: string) => nodeAt(NODES, n);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const path = (p: string[], o: { label: string; key: string; delay?: number; color?: string; d?: number }) =>
    p.slice(0, -1).map((n, i) => {
      const last = i === p.length - 2;
      return (
        <Mover key={`${k}-${o.key}-${i}`} from={at(n)} to={last ? short(at(n), at(p[i + 1])) : at(p[i + 1])} delay={(o.delay ?? 0) + i * (o.d ?? 600)} duration={o.d ?? 600} stay={last}>
          <Token color={o.color ?? "cyan"}>{o.label}</Token>
        </Mover>
      );
    });

  if (VISUAL[id] === "net") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    let extra: ReactNode = null;
    const bound = ["ack", "renew", "query", "answer", "incident", "names-fail", "renew-fix"].includes(id);
    const nodes = bound ? NODES.map((n) => (n.id === "c" ? { ...n, sub: IP } : n)) : NODES;
    if (id === "why") views.c = { ring: "on", bubble: { text: "IP? mask? gateway? DNS?", tone: "ask" } };
    if (id === "discover") {
      movers = path(["c", "sw1", "r1"], { label: "DISCOVER (broadcast)", key: "1", color: "amber" });
      views.r1 = { ring: "hit", bubble: { text: "broadcasts stop at a router…", tone: "info", delay: 1300 } };
    }
    if (id === "relay") {
      movers = path(["r1", "sw2", "dhcp"], { label: `unicast · giaddr ${RC}`, key: "1", color: "amber" });
      views.r1 = { ring: "on", bubble: { text: "relay: giaddr + unicast", tone: "yes" } };
      views.dhcp = { ring: "target", bubble: { text: `giaddr → pool ${POOL.subnet}`, tone: "yes", delay: 1300 } };
    }
    if (id === "offer") {
      movers = (
        <>
          {path(["dhcp", "sw2", "r1"], { label: `OFFER ${IP}`, key: "1", color: "violet" })}
          {path(["r1", "sw1", "c"], { label: "OFFER (broadcast)", key: "2", delay: 1300, color: "violet" })}
        </>
      );
    }
    if (id === "request") {
      movers = (
        <>
          {path(["c", "sw1", "r1"], { label: "REQUEST · opt 50 + 54", key: "1", color: "amber" })}
          {path(["r1", "sw2", "dhcp"], { label: "relayed", key: "2", delay: 1300, color: "amber" })}
        </>
      );
    }
    if (id === "ack") {
      movers = (
        <>
          {path(["dhcp", "sw2", "r1"], { label: "ACK", key: "1", color: "green" })}
          {path(["r1", "sw1", "c"], { label: "ACK", key: "2", delay: 1300, color: "green" })}
        </>
      );
      views.c = { ring: "target", badge: { text: "BOUND", tone: "yes" } };
      extra = <MiniTable title="CLIENT configuration (from the lease)" cols={["Setting", "Value"]} rows={[{ cells: ["IP / mask", `${IP} / ${MASK}`], state: "new" }, { cells: ["Default gateway (opt 3)", RC], state: "new" }, { cells: ["DNS server (opt 6)", DNS], state: "new" }, { cells: ["Lease", `${LEASE_SECONDS} s`], state: "new" }]} />;
    }
    if (id === "renew") {
      movers = (
        <>
          {path(["c", "sw1", "r1", "sw2", "dhcp"], { label: "REQUEST (unicast)", key: "1", d: 500 })}
          {path(["dhcp", "sw2", "r1", "sw1", "c"], { label: "ACK (unicast)", key: "2", delay: 2200, d: 500, color: "green" })}
        </>
      );
      views.r1 = { bubble: { text: "just routing: no relay needed", tone: "info", delay: 700 } };
    }
    if (id === "query") movers = path(["c", "sw1", "r1", "sw2", "dns"], { label: `A ${DNS_NAME}?`, key: "1", d: 550 });
    if (id === "answer") {
      movers = path(["dns", "sw2", "r1", "sw1", "c"], { label: `A ${DH_ADDR.WEB}`, key: "1", d: 550, color: "green" });
      extra = <MiniTable title="CLIENT DNS cache" cols={["Name", "Address", "TTL"]} rows={[{ cells: [DNS_NAME, DH_ADDR.WEB, `${DNS_RECORD_TTL} s`], state: "new" }]} />;
    }
    if (id === "incident") {
      views.dhcp = { ring: "bad", bubble: { text: `option 6 = ${DH_ADDR.WRONG_DNS}`, tone: "bad" } };
      extra = <MiniTable title="CLIENT configuration (new lease)" cols={["Setting", "Value"]} rows={[{ cells: ["IP / mask", `${IP} / ${MASK}`] }, { cells: ["Default gateway", RC] }, { cells: ["DNS server", DH_ADDR.WRONG_DNS], state: "bad", note: "nothing answers on this address" }]} />;
    }
    if (id === "names-fail") {
      movers = (
        <>
          {path(["c", "sw1", "r1", "sw2"], { label: `A ${DNS_NAME}? → ${DH_ADDR.WRONG_DNS}`, key: "1", d: 550, color: "red" })}
        </>
      );
      views.c = { ring: "bad", bubble: { text: "name lookup times out · ping 203.0.113.80 works", tone: "bad", delay: 1700 } };
      views.sw2 = { ring: "hit", bubble: { text: `${DH_ADDR.WRONG_DNS}? nobody here`, tone: "no", delay: 1700 } };
    }
    if (id === "renew-fix") {
      movers = (
        <>
          {path(["c", "sw1", "r1", "sw2", "dhcp"], { label: "renew REQUEST", key: "1", d: 450 })}
          {path(["dhcp", "sw2", "r1", "sw1", "c"], { label: `ACK · DNS ${DNS}`, key: "2", delay: 1900, d: 450, color: "green" })}
          {path(["c", "sw1", "r1", "sw2", "dns"], { label: `A ${DNS_NAME}?`, key: "3", delay: 3900, d: 450 })}
        </>
      );
      views.dns = { ring: "target", bubble: { text: `answers ${DH_ADDR.WEB} ✓`, tone: "yes", delay: 5800 } };
    }
    return (
      <>
        {head}
        <Topo nodes={nodes} links={LINKS} regions={REGIONS} views={views} ratio={42} minH={230}>
          {movers}
        </Topo>
        {extra}
        {id !== "why" && id !== "incident" && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "nothing":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "Ethernet", color: "#94a3b8", fields: [{ k: "Dst MAC", v: "FF:FF:FF:FF:FF:FF", hi: "key" }, { k: "Src MAC", v: "client's own" }] },
              { name: "IPv4", color: "#a78bfa", fields: [{ k: "Src IP", v: "0.0.0.0", hi: "unknown" }, { k: "Dst IP", v: "255.255.255.255", hi: "key" }] },
              { name: "UDP", color: "#22d3ee", fields: [{ k: "Src port", v: 68 }, { k: "Dst port", v: 67 }] },
              { name: "DHCP", color: "#fbbf24", fields: [{ k: "Message", v: "DISCOVER" }, { k: "xid", v: "random, kept for all 4" }, { k: "flags", v: "BROADCAST" }] },
            ]}
          />
        </>
      );
    case "dora":
      return (
        <>
          {head}
          <Chain
            k="dora"
            items={[
              { t: "DISCOVER · client → everyone (relayed by R1)", tone: "amber" },
              { t: `OFFER · server → client: “${IP}”`, tone: "violet" },
              { t: "REQUEST · client → everyone: “I take that one”", tone: "amber" },
              { t: "ACK · server → client: lease confirmed", tone: "green" },
              { t: "BOUND: IP, mask, gateway, DNS, lease timer", tone: "cyan" },
            ]}
          />
          <Compare items={[{ title: "Without a relay", tone: "red", body: "the broadcast dies at R1; no server, no address" }, { title: "With a relay", tone: "green", body: "R1 forwards as unicast; giaddr selects the right pool" }]} />
        </>
      );
    case "dns-why":
      return (
        <>
          {head}
          <Chain k="dw" items={[{ t: DNS_NAME, tone: "cyan" }, { t: "DNS: name → IP", tone: "violet" }, { t: DH_ADDR.WEB, tone: "cyan" }, { t: "routing → gateway → ARP → frame", tone: "plain" }]} />
        </>
      );
    case "ttl":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "DNS record TTL", tone: "violet", body: <>{DNS_RECORD_TTL} seconds<br />how long the answer may be cached</> },
              { title: "IPv4 TTL", tone: "cyan", body: <>a hop counter<br />each router subtracts 1</> },
            ]}
          />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Symptom: websites by name fail", tone: "red" },
              { t: `Test: ping ${DH_ADDR.WEB} works → routing OK`, tone: "plain" },
              { t: `Evidence: client DNS server = ${DH_ADDR.WRONG_DNS}`, tone: "amber" },
              { t: `Evidence: queries to ${DH_ADDR.WRONG_DNS} get no response`, tone: "amber" },
              { t: "Where did it come from? the DHCP lease (option 6)", tone: "violet" },
              { t: "Root cause: wrong option 6 on DHCP-SRV", tone: "violet" },
              { t: "Fix the scope → client renews → verify a lookup", tone: "green" },
            ]}
          />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain
            k="recap"
            items={[
              { t: "No IP yet: 0.0.0.0 → 255.255.255.255", tone: "plain" },
              { t: "DORA, relayed across the router (giaddr)", tone: "amber" },
              { t: "Lease: IP, mask, gateway, DNS, timer", tone: "green" },
              { t: "Renew: unicast, carries current options", tone: "cyan" },
              { t: "DNS: name → IP over UDP 53, cached for the record TTL", tone: "violet" },
              { t: "Names fail, IPs work → suspect DNS config", tone: "red" },
              { t: "Fix the source, renew, verify", tone: "green" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function DhcpDnsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="DHCP & DNS, from zero"
      kicker="Learn · the DHCP & DNS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
