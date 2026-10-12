"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS L2VPN (VPWS) — the presentation before the lesson and the L2VPN Lab. Builds on MPLS + LDP (transport labels) and
 * L3VPN (two labels). Same routers, VLANs, PW IDs and labels (IOS XR numbering) as the lab. Presentation state only.
 */

type Id = "two" | "cable" | "wire" | "ac" | "noip" | "pw" | "tldp" | "fec" | "labels" | "direction" | "up" | "push" | "core" | "cw" | "transport" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "two", chapter: "The problem", title: "Two sites, one Ethernet.", body: <p>CUST-A has a switch at site 1 and one at site 2, both in VLAN 100. They want the two sites on the same Ethernet segment — as if one long cable joined them.</p> },
  { id: "cable", chapter: "The problem", title: "The cable would cross a provider.", body: <p>Between the sites sits the provider core you know: PE1, P1, P2, PE2, running IS-IS and LDP. A dedicated circuit per customer is expensive. The provider wants to carry the customer&apos;s Ethernet over the MPLS core it already has.</p> },
  { id: "wire", chapter: "The idea", title: "A virtual wire.", body: <p><B>VPWS</B> (Virtual Private Wire Service) builds an emulated point-to-point link: every frame that enters the customer&apos;s port on PE1 comes out of the port on PE2, and back. No switching, no routing — a wire.</p> },
  { id: "ac", chapter: "The idea", title: "Attachment circuits.", body: <p>The customer&apos;s side of the service at each PE is an <B>attachment circuit</B>: here a port plus one VLAN — <B>ge-0/0/1.100</B> on PE1 and on PE2. Only frames tagged VLAN 100 on that port belong to CUST-A&apos;s wire.</p> },
  { id: "noip", chapter: "The idea", title: "The provider never looks inside.", body: <p>CUST-B uses VLAN 200 and — by coincidence — the same addresses, 192.168.100.1 and .2. No conflict: the PEs never read MAC or IP addresses. The attachment circuit alone decides which wire a frame takes.</p> },
  { id: "pw", chapter: "The pseudowire", title: "PE to PE: a pseudowire.", body: <p>Between the two attachment circuits runs a <B>pseudowire</B> (PW): a label-switched path from PE1 to PE2 for this one service, and one back. CUST-B gets its own pseudowire over the same core.</p> },
  { id: "tldp", chapter: "The pseudowire", title: "Signaled over targeted LDP.", body: <p>PE1 and PE2 aren&apos;t neighbors — they&apos;re four hops apart. So they open a <B>targeted</B> LDP session between their loopbacks, 1.1.1.1 and 4.4.4.4, just to signal pseudowires. P1 and P2 aren&apos;t involved.</p> },
  { id: "fec", chapter: "The pseudowire", title: "The PW FEC names the wire.", body: <p>Each pseudowire is named by its <B>PW FEC</B>: type Ethernet and a <B>PW ID</B> — 5000 for CUST-A, 5100 for CUST-B. Both ends must configure the same PW ID, or they&apos;re talking about different wires.</p> },
  { id: "labels", chapter: "The pseudowire", title: "Each PE picks the label it wants.", body: <p>For PW 5000, PE2 sends a label mapping: &quot;send me CUST-A&apos;s frames with label <B>25001</B>&quot;. PE1 sends its own: &quot;send them to me with <B>24001</B>&quot;. The PW ID is in the signaling; the labels go on the wire.</p> },
  { id: "direction", chapter: "The pseudowire", title: "One label per direction.", body: <p>PE1 → PE2 traffic carries 25001 (PE2&apos;s choice); PE2 → PE1 carries 24001 (PE1&apos;s choice). A pseudowire is two one-way label paths, each chosen by its receiver — like every LDP label.</p> },
  { id: "up", chapter: "The pseudowire", title: "When is the wire up?", body: <p>Both PEs must advertise the same PW ID, and agree on the <B>MTU</B> and the <B>control word</B>. Then each has the other&apos;s label and the pseudowire comes up. Any mismatch keeps it down — on both ends.</p> },
  { id: "push", chapter: "Forwarding", title: "Two labels on the frame.", body: <p>CE1A sends a frame tagged VLAN 100. PE1 pushes the PW label <B>25001</B>, then the transport label toward 4.4.4.4 — <B>24102</B>, the label P1 gave it. The customer&apos;s frame rides underneath, untouched.</p> },
  { id: "core", chapter: "Forwarding", title: "The core switches the top label only.", body: <p>P1 swaps 24102 → 24203. P2 pops the transport label (PHP). PE2 receives just 25001 — &quot;CUST-A&apos;s attachment circuit&quot; — and sends the frame out of ge-0/0/1.100 to CE2A.</p> },
  { id: "cw", chapter: "Forwarding", title: "The control word.", body: <p>Between the labels and the frame, the PEs can insert a 4-byte <B>control word</B>. It stops core routers from mistaking an Ethernet frame for an IP packet when they load-balance, and it carries a sequence field. Both ends must agree to use it.</p> },
  { id: "transport", chapter: "Forwarding", title: "Underneath: the transport LSP.", body: <p>The targeted session runs over plain IP, so it survives a broken LSP. Then IOS XR keeps the pseudowire up while P2 receives a PW label it doesn&apos;t know and drops the frame; Junos keeps the pseudowire down — no LSP to 4.4.4.4.</p> },
  { id: "compare", chapter: "Where it fits", title: "A wire, not a switch, not a router.", body: <p>An L3VPN routes the customer&apos;s IP packets. VPLS (next lessons) switches Ethernet between many sites and learns MAC addresses. VPWS connects exactly two attachment circuits — nothing to learn.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways a pseudowire fails.", body: <p>Different PW IDs, different MTUs, a cross-connect toward the wrong neighbor, an attachment circuit on the wrong VLAN, a broken transport LSP.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the attachment circuit up, on the right VLAN? Is the targeted session up? Does the pseudowire have a remote label, and do MTU and control word match? Is the LSP to the far PE complete?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Walk the ladder.", body: <p>Start at the failing ping and climb: the first rung that is wrong names the layer. Fix one thing, then prove it with a fresh ping.</p> },
  { id: "recap", chapter: "The whole idea", title: "Attachment circuit, pseudowire, two labels.", body: <p>Now watch it in the lesson, then break and fix it in the L2VPN Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1A", label: "CE1A", sub: "VLAN 100", sub2: "CUST-A", icon: "CE", x: 9, y: 18 },
  { id: "CE1B", label: "CE1B", sub: "VLAN 200", sub2: "CUST-B", icon: "CE", x: 9, y: 82 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 27, y: 50 },
  { id: "P1", label: "P1", sub: "2.2.2.2", icon: "P", x: 44, y: 50 },
  { id: "P2", label: "P2", sub: "3.3.3.3", icon: "P", x: 61, y: 50 },
  { id: "PE2", label: "PE2", sub: "4.4.4.4", icon: "PE", x: 78, y: 50 },
  { id: "CE2A", label: "CE2A", sub: "VLAN 100", sub2: "CUST-A", icon: "CE", x: 93, y: 18 },
  { id: "CE2B", label: "CE2B", sub: "VLAN 200", sub2: "CUST-B", icon: "CE", x: 93, y: 82 },
];
const CORE = ["PE1", "P1", "P2", "PE2"];
const ALL: [string, string][] = [["CE1A", "PE1"], ["CE1B", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["PE2", "CE2A"], ["PE2", "CE2B"]];
const A_PATH = ["CE1A", "PE1", "P1", "P2", "PE2", "CE2A"];
const pairs = (p: string[]) => p.slice(1).map((x, i) => [p[i], x] as [string, string]);
const onPath = (p: string[], a: string, b: string) => pairs(p).some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 250);
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
  const along = (p: string[], label: (i: number) => string, color: string, start = 0, step = 650, key = "a") => pairs(p).map(([a, b], i) => go(a, b, { label: label(i), key: `${key}${i}`, delay: start + i * step, color }));

  if (VISUAL[id] === "topo") {
    const lit = ["wire", "push", "core", "cw"].includes(id) ? A_PATH : id === "ac" ? ["CE1A", "PE1"] : ["pw", "tldp", "labels", "direction", "up", "transport"].includes(id) ? CORE : [];
    const links: TopoLink[] = ALL.map(([a, b]) => {
      let state: TopoLink["state"] = onPath(lit, a, b) ? "active" : "up";
      if (id === "transport" && a === "P1" && b === "P2") state = "down";
      if (id === "cable" && onPath(A_PATH, a, b) && !onPath(CORE, a, b)) state = "dim";
      if (id === "ac" && a === "PE2" && b === "CE2A") state = "active";
      return { a, b, state };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "two") {
      views.CE1A = { ring: "on", bubble: { text: "site 1 · VLAN 100", tone: "info" } };
      views.CE2A = { ring: "on", bubble: { text: "site 2 · VLAN 100", tone: "info", delay: 400 } };
    }
    if (id === "cable") views.P1 = { bubble: { text: "IS-IS + LDP core", tone: "info" } };
    if (id === "wire") {
      movers = <>{go("CE1A", "PE1", { label: "frame", key: "1", color: "green" })}{go("PE1", "PE2", { label: "frame", key: "2", delay: 800, color: "violet" })}{go("PE2", "CE2A", { label: "frame", key: "3", delay: 1600, color: "green" })}</>;
      views.PE1 = { bubble: { text: "in one port…", tone: "info" } };
      views.PE2 = { bubble: { text: "…out of the other", tone: "info", delay: 1600 } };
    }
    if (id === "ac") {
      views.PE1 = { ring: "on", bubble: { text: "AC: ge-0/0/1.100", tone: "yes" } };
      views.PE2 = { ring: "on", bubble: { text: "AC: ge-0/0/1.100", tone: "yes", delay: 400 } };
    }
    if (id === "noip") {
      views.CE1A = { bubble: { text: "192.168.100.1", tone: "warn" } };
      views.CE1B = { bubble: { text: "192.168.100.1 too", tone: "warn", delay: 300 } };
      views.PE1 = { ring: "on", bubble: { text: "no MAC, no IP lookup", tone: "yes", delay: 700 } };
    }
    if (id === "pw") {
      views.PE1 = { badge: { text: "PW 5000", tone: "info" } };
      views.PE2 = { badge: { text: "PW 5000", tone: "info" } };
      movers = <>{go("PE1", "PE2", { label: "pseudowire", key: "1", color: "violet" })}</>;
    }
    if (id === "tldp") {
      movers = <>{go("PE1", "PE2", { label: "targeted hello", key: "1", color: "amber" })}{go("PE2", "PE1", { label: "targeted hello", key: "2", delay: 900, color: "amber" })}</>;
      views.P1 = { bubble: { text: "not involved", tone: "no", delay: 1800 } };
    }
    if (id === "fec") {
      views.PE1 = { bubble: { text: "PW ID 5000", tone: "info" } };
      views.PE2 = { bubble: { text: "PW ID 5000", tone: "info", delay: 400 } };
    }
    if (id === "labels") {
      movers = <>{go("PE2", "PE1", { label: "PW 5000 → 25001", key: "1", color: "violet" })}{go("PE1", "PE2", { label: "PW 5000 → 24001", key: "2", delay: 1000, color: "violet" })}</>;
    }
    if (id === "direction") {
      views.PE1 = { bubble: { text: "pushes 25001", tone: "info" } };
      views.PE2 = { bubble: { text: "pushes 24001", tone: "info", delay: 400 } };
    }
    if (id === "up") {
      views.PE1 = { ring: "on", bubble: { text: "ID · MTU · control word", tone: "yes" } };
      views.PE2 = { ring: "on", bubble: { text: "match → up", tone: "yes", delay: 400 } };
    }
    if (id === "push") movers = <>{go("CE1A", "PE1", { label: "frame", key: "1", color: "green" })}{go("PE1", "P1", { label: "24102 | 25001 | frame", key: "2", delay: 900, color: "violet" })}</>;
    if (id === "core") {
      movers = <>{along(A_PATH, (i) => ["frame", "24102 | 25001", "24203 | 25001", "25001", "frame"][i], "violet")}</>;
      views.P2 = { badge: { text: "PHP", tone: "warn" } };
      views.PE2 = { bubble: { text: "25001 → ge-0/0/1.100", tone: "yes", delay: 2600 } };
    }
    if (id === "cw") views.PE1 = { bubble: { text: "labels | control word | frame", tone: "info" } };
    if (id === "transport") {
      views.P1 = { ring: "bad", bubble: { text: "no label from P2", tone: "bad" } };
      views.P2 = { bubble: { text: "XR: dropped", tone: "warn", delay: 400 } };
      views.PE1 = { bubble: { text: "Junos: PW down", tone: "warn", delay: 800 } };
    }
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={52} minH={FIT.minH} showSub2>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "compare":
      return (
        <>
          {head}
          <Compare items={[{ title: "L3VPN", tone: "cyan", body: "routes the customer's IP packets; a VRF per customer" }, { title: "VPWS", tone: "violet", body: "one attachment circuit to one attachment circuit; no lookup at all" }, { title: "VPLS", tone: "amber", body: "an emulated switch between many sites; learns MAC addresses" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How a pseudowire fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Different PW IDs", "session up, no remote label, PW down"], state: "hit" }, { cells: ["Different MTUs", "remote label known, PW down (MTU mismatch)"] }, { cells: ["Cross-connect to the wrong address", "targeted hellos unanswered"] }, { cells: ["AC on the wrong VLAN", "PW up, nothing passes"] }, { cells: ["Transport LSP broken", "XR: PW up, dropped in the core · Junos: PW down"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Cross-connects up?", "show l2vpn xconnect"] }, { cells: ["Labels, MTU, CW?", "show l2vpn xconnect detail"] }, { cells: ["Targeted session?", "show mpls ldp discovery"] }, { cells: ["Labels in use?", "show mpls forwarding"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Circuits up? Labels?", "show l2circuit connections"] }, { cells: ["Targeted session?", "show ldp neighbor"] }, { cells: ["LSP to the far PE?", "show route table inet.3"] }, { cells: ["Labels in use?", "show route table mpls.0"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Fresh ping: where does the frame stop?", tone: "plain" }, { t: "Does each CE's VLAN land in an attachment circuit?", tone: "cyan" }, { t: "Is the targeted LDP session up?", tone: "violet" }, { t: "Does each pseudowire have a remote label — same PW ID, MTU, control word?", tone: "violet" }, { t: "Is the transport LSP to the far PE complete?", tone: "amber" }, { t: "Fix one thing, ping again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "The attachment circuit (port + VLAN) picks the wire; no MAC or IP lookup" }, { t: "Targeted LDP between the PE loopbacks signals each pseudowire", tone: "cyan" }, { t: "Same PW ID, MTU and control word at both ends; each PE picks its receive label", tone: "violet" }, { t: "PW label underneath, transport label on top; the core switches the top label", tone: "amber" }, { t: "A pseudowire that shows up still needs its LSP and the right VLANs", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function VpwsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="MPLS L2VPN (VPWS), from zero"
      kicker="Learn · the L2VPN presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
