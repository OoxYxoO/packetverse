"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * EVPN + VXLAN foundations — the presentation before the lesson and the EVPN-VXLAN Lab. Same fabric, VNI, VTEP addresses,
 * route target and RDs as the lab. Presentation state only.
 */

type Id = "problem" | "routed" | "vtep" | "vni" | "encap" | "header" | "spine" | "decap" | "question" | "flood" | "evpn" | "type3" | "type2" | "rdrt" | "learn" | "arp" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The problem", title: "Two hosts, one subnet, two racks.", body: <p>HOST-A (10.10.10.11) sits in one rack behind LEAF1, HOST-B (10.10.10.22) in another behind LEAF2. The application wants them on one Ethernet segment, <B>10.10.10.0/24</B>.</p> },
  { id: "routed", chapter: "The problem", title: "But the fabric is routed.", body: <p>Modern data-center fabrics route between leaf and spine: no VLAN crosses the spine, no spanning tree, every link active. So how does a Layer 2 frame get from one rack to the other?</p> },
  { id: "vtep", chapter: "VXLAN", title: "Every leaf is a VTEP.", body: <p>A <B>VTEP</B> (VXLAN tunnel endpoint) wraps Ethernet frames into IP packets and unwraps them. Its address is its loopback: LEAF1 10.255.0.1, LEAF2 10.255.0.2.</p> },
  { id: "vni", chapter: "VXLAN", title: "VLAN in, VNI across.", body: <p>Each leaf maps its local VLAN to a fabric-wide <B>VNI</B> (VXLAN network identifier): VLAN 10 → VNI 10010. The VLAN number is local to the leaf; the VNI is what the other leaf must agree on — 24 bits, 16 million segments.</p> },
  { id: "encap", chapter: "VXLAN", title: "Wrap the frame.", body: <p>HOST-A sends an ordinary frame to HOST-B. LEAF1 looks up HOST-B&apos;s MAC, finds it behind VTEP 10.255.0.2, and wraps the whole frame in a VXLAN packet addressed to that VTEP.</p> },
  { id: "header", chapter: "VXLAN", title: "Fifty bytes of envelope.", body: <p>Outer Ethernet, outer IP 10.255.0.1 → 10.255.0.2, UDP to port <B>4789</B>, an 8-byte VXLAN header carrying VNI 10010 — then HOST-A&apos;s frame, untouched. The fabric links need an MTU large enough for it.</p> },
  { id: "spine", chapter: "VXLAN", title: "The spine just routes.", body: <p>SPINE1 sees a UDP packet to 10.255.0.2 and routes it. It never looks inside, never learns a host MAC, never knows a VLAN exists.</p> },
  { id: "decap", chapter: "VXLAN", title: "Unwrap, look up, deliver.", body: <p>LEAF2 strips the envelope, reads VNI 10010, maps it to its own VLAN, looks up HOST-B&apos;s MAC and delivers the original frame. HOST-B never knows it crossed a routed fabric.</p> },
  { id: "question", chapter: "The real question", title: "How did LEAF1 know where HOST-B was?", body: <p>VXLAN only moves frames. Something has to tell LEAF1 that HOST-B&apos;s MAC lives behind 10.255.0.2 — and which VTEPs to send a broadcast to.</p> },
  { id: "flood", chapter: "The real question", title: "Flood and learn works — badly.", body: <p>Plain VXLAN can flood unknown frames to every VTEP and learn source MACs from what comes back, like a giant switch. It works, but every unknown MAC costs a flood, and nothing is known until traffic has flowed.</p> },
  { id: "evpn", chapter: "EVPN", title: "Let BGP carry the MACs.", body: <p><B>EVPN</B> puts MAC reachability into BGP. LEAF1 and LEAF2 run an iBGP session between their loopbacks with the EVPN address family, and tell each other what they know.</p> },
  { id: "type3", chapter: "EVPN", title: "Type 3: who has this VNI.", body: <p>Each leaf advertises a <B>Type 3</B> (inclusive multicast) route for every VNI it has. LEAF1 learns that LEAF2 has VNI 10010 — so LEAF2 goes on LEAF1&apos;s flood list for that VNI (ingress replication). This happens before any host has sent anything.</p> },
  { id: "type2", chapter: "EVPN", title: "Type 2: where each MAC lives.", body: <p>When LEAF2 learns HOST-B on its port, it advertises a <B>Type 2</B> (MAC/IP) route: MAC bb:bb:bb:bb:bb:22, IP 10.10.10.22, VNI 10010, next hop 10.255.0.2 — its own VTEP, never the host.</p> },
  { id: "rdrt", chapter: "EVPN", title: "RD keeps it unique, RT imports it.", body: <p>The route carries RD <B>10.255.0.2:10010</B> and route target <B>65000:10010</B>. LEAF1 imports it because its VNI 10010 uses the same route target — the same job the RT does in L3VPN and BGP VPLS.</p> },
  { id: "learn", chapter: "EVPN", title: "Remote MACs come from BGP.", body: <p>LEAF1 installs HOST-B behind 10.255.0.2 from the Type 2 route — not from a frame. A leaf even knows hosts that have never sent anything across the fabric, as long as their own leaf has seen them.</p> },
  { id: "arp", chapter: "EVPN", title: "The first packet: one flood, then unicast.", body: <p>HOST-A&apos;s first ARP request is a broadcast: LEAF1 sends one copy to each VTEP on its flood list. HOST-B&apos;s reply is unicast — LEAF2 already knows HOST-A from LEAF1&apos;s Type 2 route. After that, every frame is a single tunnel packet.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways it fails.", body: <p>A route target that doesn&apos;t match, a VLAN mapped to the wrong VNI, a session without the EVPN family, a VTEP loopback missing from the underlay, a host port in the wrong VLAN.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Can each VTEP reach the other? Is the session up with family evpn? Does each leaf see the other as a remote VTEP for the VNI? Where does each MAC live?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Bottom up.", body: <p>The overlay rests on the underlay; the routes rest on the session; the MACs rest on the routes. Check in that order.</p> },
  { id: "recap", chapter: "The whole idea", title: "VXLAN moves it, EVPN knows where.", body: <p>Now watch it in the lesson, then break and fix it in the EVPN-VXLAN Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["header", "flood", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "HOST-A", label: "HOST-A", sub: "10.10.10.11", icon: "host", x: 8, y: 62 },
  { id: "LEAF1", label: "LEAF1", sub: "VTEP 10.255.0.1", icon: "leaf", x: 28, y: 62 },
  { id: "SPINE1", label: "SPINE1", sub: "10.255.0.254", icon: "spine", x: 50, y: 20 },
  { id: "LEAF2", label: "LEAF2", sub: "VTEP 10.255.0.2", icon: "leaf", x: 72, y: 62 },
  { id: "HOST-B", label: "HOST-B", sub: "10.10.10.22", icon: "host", x: 92, y: 62 },
];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 300);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string }) => {
    const from = nodeAt(FIT.nodes, f);
    const to = nodeAt(FIT.nodes, t);
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "topo") {
    const evpn = ["evpn", "type3", "type2", "rdrt", "learn", "arp"].includes(id);
    const links: TopoLink[] = [
      { a: "HOST-A", b: "LEAF1", state: "up", label: ["vni"].includes(id) ? "VLAN 10" : "" },
      { a: "LEAF2", b: "HOST-B", state: "up", label: ["vni"].includes(id) ? "VLAN 10" : "" },
      { a: "LEAF1", b: "SPINE1", state: evpn ? "dim" : "up", label: id === "routed" ? "routed" : "" },
      { a: "SPINE1", b: "LEAF2", state: evpn ? "dim" : "up", label: id === "routed" ? "routed" : "" },
      ...(evpn ? [{ a: "LEAF1", b: "LEAF2", state: "standby" as TopoLink["state"], label: "iBGP EVPN" }] : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") {
      views["HOST-A"] = { ring: "on" };
      views["HOST-B"] = { ring: "on" };
      views.SPINE1 = { bubble: { text: "same subnet: 10.10.10.0/24", tone: "info" } };
    }
    if (id === "routed") views.SPINE1 = { bubble: { text: "no VLAN up here", tone: "warn" } };
    if (id === "vtep") {
      views.LEAF1 = { badge: { text: "VTEP", tone: "info" } };
      views.LEAF2 = { badge: { text: "VTEP", tone: "info" } };
    }
    if (id === "vni") views.SPINE1 = { bubble: { text: "VLAN 10 → VNI 10010 at both leaves", tone: "yes" } };
    if (id === "encap") movers = <>{go("HOST-A", "LEAF1", { label: "frame → B", key: "1", color: "green" })}{go("LEAF1", "SPINE1", { label: "VXLAN 10010", key: "2", delay: 900, color: "violet" })}</>;
    if (id === "spine") {
      movers = <>{go("LEAF1", "SPINE1", { label: "to 10.255.0.2", key: "1", color: "violet" })}{go("SPINE1", "LEAF2", { label: "to 10.255.0.2", key: "2", delay: 900, color: "violet" })}</>;
      views.SPINE1 = { bubble: { text: "routes the outer IP only", tone: "info", delay: 600 } };
    }
    if (id === "decap") movers = <>{go("SPINE1", "LEAF2", { label: "VXLAN 10010", key: "1", color: "violet" })}{go("LEAF2", "HOST-B", { label: "original frame", key: "2", delay: 900, color: "green" })}</>;
    if (id === "question") views.LEAF1 = { bubble: { text: "HOST-B is where?", tone: "warn" } };
    if (id === "evpn") views.SPINE1 = { bubble: { text: "not part of the session", tone: "info" } };
    if (id === "type3") movers = <>{go("LEAF2", "LEAF1", { label: "Type 3 · VNI 10010 · 10.255.0.2", key: "1", color: "amber" })}</>;
    if (id === "type2") movers = <>{go("HOST-B", "LEAF2", { label: "learned locally", key: "1", color: "green" })}{go("LEAF2", "LEAF1", { label: "Type 2 · bb:…:22 · 10.10.10.22", key: "2", delay: 900, color: "amber" })}</>;
    if (id === "rdrt") {
      views.LEAF2 = { bubble: { text: "RD 10.255.0.2:10010", tone: "info" } };
      views.LEAF1 = { bubble: { text: "imports RT 65000:10010", tone: "yes" } };
    }
    if (id === "learn") views.LEAF1 = { bubble: { text: "bb:…:22 → 10.255.0.2", tone: "yes" } };
    if (id === "arp") movers = <>{go("HOST-A", "LEAF1", { label: "ARP broadcast", key: "1", color: "amber" })}{go("LEAF1", "SPINE1", { label: "one copy per VTEP", key: "2", delay: 800, color: "violet" })}{go("SPINE1", "LEAF2", { label: "flood copy", key: "3", delay: 1600, color: "violet" })}{go("LEAF2", "HOST-B", { label: "ARP", key: "4", delay: 2400, color: "amber" })}</>;
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={50} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "header":
      return (
        <>
          {head}
          <MiniTable title="One VXLAN packet, outside in" cols={["Header", "Contents", "Size"]} rows={[{ cells: ["Outer Ethernet", "next-hop MACs (rewritten per hop)", "14 B"] }, { cells: ["Outer IPv4", "10.255.0.1 → 10.255.0.2", "20 B"] }, { cells: ["UDP", "destination port 4789", "8 B"] }, { cells: ["VXLAN", "VNI 10010", "8 B"], state: "hit" }, { cells: ["Inner Ethernet + payload", "HOST-A → HOST-B, unchanged", "original"] }]} />
        </>
      );
    case "flood":
      return (
        <>
          {head}
          <Compare items={[{ title: "Flood and learn", tone: "amber", body: "unknown frames flooded to every VTEP; remote MACs learned from returning traffic" }, { title: "EVPN", tone: "violet", body: "VTEPs and MACs announced in BGP; floods only for real broadcasts and truly unknown destinations" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an EVPN-VXLAN fabric fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Route target mismatch", "session Established, routes received but not accepted"], state: "hit" }, { cells: ["VLAN → wrong VNI", "routes accepted, VNI unknown; packets dropped at the far leaf"] }, { cells: ["No family evpn", "session Established, zero EVPN routes"] }, { cells: ["VTEP loopback not in the underlay", "session down, nothing works"] }, { cells: ["Host port in the wrong VLAN", "that host silent; its Type 2 route gone"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Can I reach the other VTEP?", "show route 10.255.0.2"] }, { cells: ["Session and EVPN routes?", "show bgp summary"] }, { cells: ["Which routes?", "show route table bgp.evpn.0"] }, { cells: ["Remote VTEPs per VNI?", "show ethernet-switching vxlan-tunnel-end-point remote"] }, { cells: ["Where is each MAC?", "show evpn database"] }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Is the host's port in the right VLAN?", tone: "plain" }, { t: "Can each VTEP reach the other's loopback (underlay)?", tone: "cyan" }, { t: "Is the session up, with family evpn?", tone: "violet" }, { t: "Does the VLAN map to the same VNI on both leaves?", tone: "violet" }, { t: "Are the routes accepted (route target)?", tone: "amber" }, { t: "Fix one thing, ping again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Leaves are VTEPs; VLAN maps to a fabric-wide VNI" }, { t: "VXLAN: UDP/IP envelope between VTEP loopbacks; the spine only routes", tone: "cyan" }, { t: "Type 3: who has the VNI (the flood list)", tone: "violet" }, { t: "Type 2: where each MAC lives — learned from BGP, not the tunnel", tone: "amber" }, { t: "Underlay → session → VNI → route target, in that order", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function EvpnPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="EVPN + VXLAN, from zero"
      kicker="Learn · the EVPN-VXLAN presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
