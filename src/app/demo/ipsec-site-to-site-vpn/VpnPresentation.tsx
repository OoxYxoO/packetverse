"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * IPsec site-to-site VPN — the presentation before the lesson/lab. Builds on the Firewall lesson (private addresses
 * aren't routed on the internet; NAT), on TCP & UDP (UDP 500) and Routing (a gateway decides where traffic goes):
 * HOST-A — GW-A — INTERNET — GW-B — HOST-B, with WEB on the internet. Keys, authentication, what to protect, ESP and
 * steering.
 */
type Id = "why" | "idea" | "split" | "init" | "dh" | "noprop" | "auth" | "psk" | "sas" | "ts" | "tsbad" | "esp" | "spi" | "seq" | "steer" | "dpd" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why a VPN", title: "Two private networks, one public internet.", body: <p>Site A is 10.10.10.0/24, Site B 10.20.20.0/24. The internet between them routes only public addresses — and anyone along the path could read what crosses it.</p> },
  { id: "idea", chapter: "Why a VPN", title: "Wrap the packet, encrypt it, send it gateway to gateway.", body: <p>GW-A encrypts HOST-A&apos;s packet and puts it inside a new one addressed from <Bb>198.51.100.10</Bb> to <Bb>203.0.113.10</Bb>. The internet routes the outside; only GW-B can open the inside.</p> },
  { id: "split", chapter: "Why a VPN", title: "Only site-to-site traffic goes in the tunnel.", body: <p>HOST-A browsing WEB on the internet is routed normally, with source NAT — exactly like the Firewall lesson. The gateway decides per destination (split tunneling).</p> },
  { id: "init", chapter: "IKE_SA_INIT", title: "First, agree on how to talk.", body: <p>GW-A sends <Bb>IKE_SA_INIT</Bb> over UDP 500: the algorithms it proposes, a Diffie-Hellman public value and a nonce. GW-B picks a proposal and answers with its own values.</p> },
  { id: "dh", chapter: "IKE_SA_INIT", title: "Diffie-Hellman: same keys, never sent.", body: <p>Each side combines its private value with the other&apos;s public one and gets the same secret. An eavesdropper who saw both public values can&apos;t compute it. But nobody knows yet <Bb>who</Bb> is on the other side.</p> },
  { id: "noprop", chapter: "IKE_SA_INIT", title: "No common proposal: no keys.", body: <p>If GW-B only accepts AES-CBC-128 with group 14 and GW-A offers AES-GCM-256 with group 19, GW-B answers <Bb>NO_PROPOSAL_CHOSEN</Bb> to the very first message.</p> },
  { id: "auth", chapter: "IKE_AUTH", title: "Then prove who you are.", body: <p>Encrypted with the new keys, <Bb>IKE_AUTH</Bb> carries each gateway&apos;s identity and an AUTH value made with the <Bb>pre-shared key</Bb>. Each side verifies the other&apos;s — and the IKE SA is ESTABLISHED.</p> },
  { id: "psk", chapter: "IKE_AUTH", title: "Different keys: IKE starts, then stops.", body: <p>Keys were derived, the encrypted exchange starts — and GW-B can&apos;t verify GW-A&apos;s AUTH. <Bb>AUTHENTICATION_FAILED</Bb>.</p> },
  { id: "sas", chapter: "Security associations", title: "The IKE SA protects IKE. CHILD SAs protect data.", body: <p>One IKE SA per pair of gateways. User traffic travels in a <Bb>CHILD SA</Bb>: two one-way ESP SAs, created inside IKE_AUTH (and later by CREATE_CHILD_SA).</p> },
  { id: "ts", chapter: "Traffic selectors", title: "The CHILD SA says what it protects.", body: <p>GW-A proposes <Bb>TSi 10.10.10.0/24</Bb>, <Bb>TSr 10.20.20.0/24</Bb>. GW-B&apos;s policy is the mirror image — local 10.20.20.0/24, remote 10.10.10.0/24 — so it accepts.</p> },
  { id: "tsbad", chapter: "Traffic selectors", title: "Selectors that don't mirror: IKE up, nothing passes.", body: <p>If GW-B&apos;s remote is 10.10.20.0/24, it refuses the CHILD SA with <Bb>TS_UNACCEPTABLE</Bb>. The IKE SA stays up — monitoring says “peer up” while every site packet is dropped.</p> },
  { id: "esp", chapter: "ESP", title: "Tunnel mode: a packet inside a packet.", body: <p>Outer IPv4 (gateway → gateway, protocol 50), ESP header (SPI, sequence number), then the <Bb>encrypted</Bb> original packet and an integrity check value (AES-GCM).</p> },
  { id: "spi", chapter: "ESP", title: "Each direction has its own SPI — the receiver's.", body: <p>A packet to GW-B carries the SPI <Bb>GW-B chose</Bb>, so GW-B can find the right keys; the reply carries GW-A&apos;s. Two SAs, two SPIs.</p> },
  { id: "seq", chapter: "ESP", title: "Sequence numbers stop replays; counters prove use.", body: <p>Every packet gets the next number on its SA; a repeated number is dropped. The encrypt / decrypt counters on both gateways prove real traffic uses the tunnel.</p> },
  { id: "steer", chapter: "Getting traffic in", title: "An up tunnel only carries what you send into it.", body: <p>Cisco encrypts what leaves the WAN interface through the <Bb>crypto map</Bb>; Junos routes the other site into <Bb>st0.0</Bb>. Forget it, and site traffic leaves in the clear — NATed — and dies on the internet.</p> },
  { id: "dpd", chapter: "Getting traffic in", title: "When the peer disappears.", body: <p>GW-B&apos;s link fails: GW-A stops hearing it (dead-peer detection), the SAs are deleted, site traffic is dropped. When the link returns, IKE renegotiates — new SPIs.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "IKE SA, CHILD SA, counters.", body: <p>Read it in that order: is the IKE SA up? is a CHILD SA installed with the right selectors? do the counters climb while you test?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Find the first layer that failed.", body: <p>Answer → proposal → authentication → selectors → steering → counters.</p> },
  { id: "recap", chapter: "The whole idea", title: "Reach, agree, prove, protect, steer.", body: <p>Now follow the negotiation in the lesson, then break and repair both gateways in the VPN Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", idea: "net", split: "net", init: "net", dh: "dh", noprop: "net", auth: "net", psk: "net", sas: "sas", ts: "ts", tsbad: "net", esp: "esp", spi: "net", seq: "seq", steer: "net", dpd: "net", verify: "verify", trouble: "trouble", recap: "recap" };
const NODES: TopoNode[] = [
  { id: "ha", label: "HOST-A", sub: "10.10.10.10", icon: "💻", x: 6, y: 55 },
  { id: "ga", label: "GW-A", sub: "198.51.100.10", icon: "R", x: 28, y: 55 },
  { id: "in", label: "INTERNET", sub: "public only", icon: "☁", x: 50, y: 55 },
  { id: "gb", label: "GW-B", sub: "203.0.113.10", icon: "R", x: 72, y: 55 },
  { id: "hb", label: "HOST-B", sub: "10.20.20.20", icon: "💻", x: 94, y: 55 },
  { id: "w", label: "WEB", sub: "192.0.2.80", icon: "🖥", x: 50, y: 90 },
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
    const espPath = ["idea", "spi"].includes(id);
    const links: TopoLink[] = [
      { a: "ha", b: "ga", state: ["idea", "split", "steer", "spi"].includes(id) ? "active" : "up" },
      { a: "ga", b: "in", label: espPath ? "ESP" : undefined, state: ["idea", "split", "init", "auth", "noprop", "psk", "steer", "spi", "tsbad"].includes(id) ? "active" : "up" },
      { a: "in", b: "gb", label: espPath ? "ESP" : undefined, state: id === "dpd" ? "down" : ["idea", "init", "auth", "noprop", "psk", "spi"].includes(id) ? "active" : "up" },
      { a: "gb", b: "hb", state: ["idea", "spi"].includes(id) ? "active" : "up" },
      { a: "in", b: "w", state: id === "split" ? "active" : "up" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      movers = go("ga", "in", { label: "10.10.10.10 → 10.20.20.20 ?", key: "1", stay: true, color: "red" });
      views.in = { ring: "bad", bubble: { text: "no route to private addresses", tone: "bad", delay: 500 } };
    }
    if (id === "idea")
      movers = (
        <>
          {go("ha", "ga", { label: "10.10.10.10 → 10.20.20.20", key: "1" })}
          {go("ga", "in", { label: "ESP 198.51.100.10 → 203.0.113.10", key: "2", delay: 700, color: "violet" })}
          {go("in", "gb", { label: "ESP", key: "3", delay: 1400, color: "violet" })}
          {go("gb", "hb", { label: "10.10.10.10 → 10.20.20.20", key: "4", delay: 2100 })}
        </>
      );
    if (id === "split")
      movers = (
        <>
          {go("ha", "ga", { label: "→ 192.0.2.80", key: "1" })}
          {go("ga", "in", { label: "198.51.100.10 → 192.0.2.80 (NAT, clear)", key: "2", delay: 700, color: "amber" })}
          {go("in", "w", { label: "clear", key: "3", delay: 1400, color: "amber" })}
        </>
      );
    if (id === "init" || id === "noprop" || id === "auth" || id === "psk") {
      const ex = id === "init" || id === "noprop" ? "IKE_SA_INIT" : "IKE_AUTH";
      movers = (
        <>
          {go("ga", "in", { label: `${ex} req`, key: "1", color: "violet" })}
          {go("in", "gb", { label: `${ex} req`, key: "2", delay: 600, color: "violet" })}
          {go("gb", "in", { label: id === "noprop" ? "NO_PROPOSAL_CHOSEN" : id === "psk" ? "AUTHENTICATION_FAILED" : `${ex} resp`, key: "3", delay: 1300, color: id === "noprop" || id === "psk" ? "red" : "green" })}
        </>
      );
      if (id === "noprop") views.gb = { ring: "bad", bubble: { text: "AES-GCM-256/g19? I only take AES-CBC-128/g14", tone: "bad", delay: 700 } };
      if (id === "psk") views.gb = { ring: "bad", bubble: { text: "AUTH doesn't verify with my key", tone: "bad", delay: 700 } };
      if (id === "auth") views.gb = { ring: "on", bubble: { text: "GW-A authenticated · IKE SA up", tone: "yes", delay: 700 } };
      if (id === "init") views.ga = { bubble: { text: "SA · KE · Ni (in the clear)", tone: "info" } };
    }
    if (id === "tsbad") {
      views.gb = { ring: "bad", bubble: { text: "TSi 10.10.10.0/24 ∉ my 10.10.20.0/24 → TS_UNACCEPTABLE", tone: "bad" } };
      views.ga = { bubble: { text: "IKE SA up · no CHILD SA", tone: "warn", delay: 500 } };
    }
    if (id === "spi") {
      views.ga = { bubble: { text: "sends SPI 0xa1b2… (GW-B's)", tone: "info" } };
      views.gb = { bubble: { text: "replies with SPI 0xb1c2… (GW-A's)", tone: "info", delay: 500 } };
    }
    if (id === "steer") {
      movers = (
        <>
          {go("ha", "ga", { label: "→ 10.20.20.20", key: "1" })}
          {go("ga", "in", { label: "198.51.100.10 → 10.20.20.20 (clear!)", key: "2", delay: 700, stay: true, color: "red" })}
        </>
      );
      views.ga = { ring: "bad", bubble: { text: "not steered into IPsec", tone: "bad", delay: 300 } };
      views.in = { bubble: { text: "no route to 10.20.20.20", tone: "bad", delay: 1200 } };
    }
    if (id === "dpd") {
      views.gb = { ring: "bad", bubble: { text: "link down", tone: "bad" } };
      views.ga = { bubble: { text: "peer dead → SAs deleted", tone: "warn", delay: 500 } };
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={46} minH={240}>
          {movers}
        </Topo>
        {["why", "idea", "split", "init", "noprop", "auth", "psk", "steer"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "dh":
      return (
        <>
          {head}
          <Compare items={[{ title: "Sent in the clear", tone: "amber", body: "proposal · GW-A's public value · GW-B's public value · nonces" }, { title: "Never sent", tone: "green", body: "each private value — and the shared secret both compute from them" }]} />
        </>
      );
    case "sas":
      return (
        <>
          {head}
          <MiniTable title="Two kinds of security association" cols={["SA", "Protects", "How many"]} rows={[{ cells: ["IKE SA", "IKE messages (control)", "one per gateway pair"] }, { cells: ["CHILD SA", "user traffic (ESP)", "a pair: one per direction"], state: "hit" }]} />
        </>
      );
    case "ts":
      return (
        <>
          {head}
          <MiniTable title="The selectors must mirror each other" cols={["", "GW-A", "GW-B"]} rows={[{ cells: ["local", "10.10.10.0/24", "10.20.20.0/24"] }, { cells: ["remote", "10.20.20.0/24", "10.10.10.0/24"], state: "hit" }]} />
          <Compare items={[{ title: "Cisco", tone: "cyan", body: "the crypto ACL: permit ip 10.10.10.0 0.0.0.255 10.20.20.0 0.0.0.255" }, { title: "Junos", tone: "violet", body: "traffic-selector ts1 { local-ip 10.10.10.0/24; remote-ip 10.20.20.0/24; }" }]} />
        </>
      );
    case "esp":
      return (
        <>
          {head}
          <PacketCard layers={[{ name: "Outer IPv4", color: "#22d3ee", fields: [{ k: "src → dst", v: "198.51.100.10 → 203.0.113.10", hi: "key" }, { k: "protocol", v: "50 (ESP)" }] }, { name: "ESP header", color: "#f472b6", fields: [{ k: "SPI", v: "0xa1b2c3d4 (GW-B's)", hi: "key" }, { k: "sequence", v: "1" }] }, { name: "Encrypted (AES-GCM)", color: "#a78bfa", fields: [{ k: "inner IPv4", v: "10.10.10.10 → 10.20.20.20" }, { k: "ICMP", v: "echo request" }, { k: "+ ICV", v: "integrity" }] }]} />
        </>
      );
    case "seq":
      return (
        <>
          {head}
          <MiniTable title="After three pings" cols={["Gateway", "Encrypted", "Decrypted"]} rows={[{ cells: ["GW-A", "3", "3"] }, { cells: ["GW-B", "3", "3"], state: "hit" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS" cols={["Question", "Command"]} rows={[{ cells: ["IKE SA up?", "show crypto ikev2 sa"] }, { cells: ["CHILD SA, SPIs, counters", "show crypto ipsec sa"] }, { cells: ["Steered?", "show crypto map"] }, { cells: ["Why it failed", "show logging"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["IKE SA up?", "show security ike security-associations"] }, { cells: ["CHILD SA, SPIs", "show security ipsec security-associations"] }, { cells: ["Counters", "show security ipsec statistics"] }, { cells: ["Steered?", "show route (via st0.0)"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "IKE_SA_INIT answered? (peer, link)", tone: "red" }, { t: "Common proposal? (NO_PROPOSAL_CHOSEN)", tone: "amber" }, { t: "Authenticated? (AUTHENTICATION_FAILED)", tone: "violet" }, { t: "CHILD SA installed? (TS_UNACCEPTABLE)", tone: "cyan" }, { t: "Steered in? Counters moving?", tone: "amber" }, { t: "Fix one layer, ping, watch the counters", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "IKE_SA_INIT: answer, common proposal, Diffie-Hellman keys" }, { t: "IKE_AUTH: pre-shared key proves identity — IKE SA up", tone: "amber" }, { t: "CHILD SA: mirrored selectors, two SPIs (the receiver's)", tone: "violet" }, { t: "ESP tunnel mode: outer public, inner encrypted, sequence numbers", tone: "cyan" }, { t: "Steering decides what enters; counters prove it", tone: "green" }]} />
        </>
      );
  }
  return head;
}
export function VpnPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="Site-to-site IPsec, from zero" kicker="Learn · the VPN presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
