import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, runGuideCli, pickLines } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { hex4 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { ALL_ISS, AREA, LINK_METRIC, LSP_LIFETIME, PDU, PREFIX_METRIC, ROUTER, buildLsp, hex8s, lspChecksum, lspLength, netOf, type IsisRouter } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { createIsNet, isApply, type IsR, type IsState, type IsAction } from "@/lib/sim-engine/scenarios/isisNet";
import { isSets, isStaticApi } from "./isis-lab/isCli";
import { IsisChain, Lanes } from "./guideSvg";

export const ISIS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "isl-mission", label: "What this lesson teaches" },
  { id: "isl-network", label: "The network of this lesson" },
  { id: "isl-ideas", label: "Three ideas you need" },
  { id: "isl-watch", label: "What you will watch" },
  { id: "isl-names", label: "Every router has a NET" },
  { id: "isl-wire", label: "Hellos without IP" },
  { id: "isl-handshake", label: "P1 and P2 become neighbors" },
  { id: "isl-lsp", label: "Each router describes itself" },
  { id: "isl-flood", label: "One map on every router" },
  { id: "isl-spf", label: "PE1 computes its path" },
  { id: "isl-fwd", label: "Traffic follows the table" },
  { id: "isl-working", label: "What working looks like" },
  { id: "isl-incident", label: "The incident" },
  { id: "isl-investigate", label: "Walk the chain" },
  { id: "isl-repair", label: "Repair and prove it" },
  { id: "isl-other", label: "Other ways IS-IS breaks" },
  { id: "isl-model", label: "Mental model" },
  { id: "isl-glossary", label: "Glossary" },
  { id: "isl-recap", label: "Recap" },
  { id: "isl-practice", label: "Practice it" },
];

/**
 * The lesson's network from the IS-IS Lab's own model: the lab's second path (P3–P4) is switched off, so the four
 * routers of this lesson are exactly PE1 — P1 — P2 — PE2, powered up from scratch (every LSP at sequence 1, as in the
 * guided lesson). Every CLI sample on this page is the lab's real IOS XR / Junos command set run against it.
 */
const run = (s: IsState, as: IsAction[]) => as.reduce((acc, a) => isApply(acc, a), s);
export const LINE: IsState = run(createIsNet(), [{ type: "link", link: "PE1-P3", up: false }, { type: "link", link: "P3-P4", up: false }, { type: "link", link: "P4-PE2", up: false }, { type: "boot" }]);
const levelFault = (s: IsState) => isApply(s, { type: "set", text: "P2 ge-0/0/0 circuit-type level-1", changes: [{ dev: "P2", f: (r) => void (r.ifs["ge-0/0/0"]!.circuit = "level-1") }] });
export const LINE_BROKEN = levelFault(LINE);
const LINE_FIXED = isApply(LINE_BROKEN, { type: "set", text: "P2 ge-0/0/0 circuit-type back to level-1-2", changes: [{ dev: "P2", f: (r) => void (r.ifs["ge-0/0/0"]!.circuit = "level-1-2") }] });
export function lineCli(s: IsState, r: IsR, vendor: CliVendor, command: string) {
  return runGuideCli(isSets(isStaticApi(s, r), r)[vendor], command);
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the IS-IS Lab" onPractice={openLab}>
      The same four routers plus a second path (P3–P4), your own copy, IOS XR or Junos. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const NB: Record<IsisRouter, IsisRouter[]> = { PE1: ["P1"], P1: ["PE1", "P2"], P2: ["P1", "PE2"], PE2: ["P2"] };
const pe2 = buildLsp("PE2", 1, NB.PE2);
const all1 = (["PE1", "P1", "P2", "PE2"] as IsisRouter[]).map((r) => buildLsp(r, 1, NB[r]));

export function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="PE1, P1, P2 and PE2 in a line; loopbacks 10.0.0.1 to 10.0.0.4; transit /31 links">
      <IsisChain y={84} subs={{ PE1: `${ROUTER.PE1.loopback}/32`, P1: `${ROUTER.P1.loopback}/32`, P2: `${ROUTER.P2.loopback}/32`, PE2: `${ROUTER.PE2.loopback}/32` }} labels={{ a: "192.0.2.0/31", b: "192.0.2.2/31", c: "192.0.2.4/31" }} below={{ a: `metric ${LINK_METRIC}`, b: `metric ${LINK_METRIC}`, c: `metric ${LINK_METRIC}` }} />
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        Three Ethernet links run as IS-IS point-to-point circuits · every router Level-2-only
      </text>
    </DiagramSvg>
  );
}

export function NetDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={150} label="NET 49.0001.0000.0000.0001.00 split into Area ID 49.0001, System ID 0000.0000.0001 and NSEL 00">
      <text x={320} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontFamily="monospace" fontWeight={700}>
        {netOf("PE1")}
      </text>
      <DFieldRow x={70} y={34} fields={[f("Area ID", AREA, 150, D.violet), f("System ID", ROUTER.PE1.sysId, 250, D.cyan, true), f("NSEL", "00", 100, D.faint)]} />
      <text x={320} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        System ID: unique per router (six bytes) · NSEL 00 = &quot;this is the router itself&quot;
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        The NET names the IS-IS router. It is not an interface address and never an IPv4 next hop.
      </text>
    </DiagramSvg>
  );
}

export function L2Diagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={190} label="IS-IS PDUs are carried in 802.3 with LLC FE FE 03 and the 0x83 header, with no IPv4, UDP or TCP">
      <text x={20} y={22} fill={D.success} fontSize={10.5} fontWeight={700}>
        IS-IS (this lesson)
      </text>
      <DFieldRow x={20} y={30} fields={[f("802.3", `dst ${ALL_ISS}`, 190, D.eth), f("LLC", "FE · FE · 03", 110, D.violet, true), f("IS-IS header", "0x83 · type", 130, D.cyan, true), f("PDU + TLVs", "IIH / LSP / SNP", 170, D.cyan)]} />
      <text x={20} y={112} fill={D.danger} fontSize={10.5} fontWeight={700}>
        Not this
      </text>
      <DFieldRow x={20} y={120} h={36} fields={[f("Ethernet", "", 150, D.faint), f("IPv4", "", 120, D.faint), f("UDP / TCP", "", 120, D.faint), f("IS-IS", "", 210, D.faint)]} />
      <line x1={20} y1={138} x2={620} y2={138} stroke={D.danger} strokeWidth={2} />
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        Routing IP without depending on IP: IS-IS works before any IPv4 route exists.
      </text>
    </DiagramSvg>
  );
}

export function IihDiagram() {
  return (
    <DiagramSvg h={196} label="P2P IIH fields: circuit type, source ID, holding time, PDU length, local circuit ID and TLVs 1, 129, 132 and 240">
      <DTable
        x={60}
        y={8}
        title={`P1's P2P IIH (PDU type ${PDU.P2P_IIH})`}
        cols={[
          { label: "FIELD / TLV", w: 220 },
          { label: "VALUE", w: 300 },
        ]}
        rows={[
          ["Circuit Type", "2 (Level-2 only)"],
          ["Source ID · Holding Time", `${ROUTER.P1.sysId} · 30 s`],
          ["PDU Length · Local Circuit ID", "unpadded length · 2"],
          ["TLV 1 Area · TLV 129 Protocols", `${AREA} · 0xCC (IPv4)`],
          ["TLV 132 IP Interface Address", "192.0.2.2"],
          ["TLV 240 Three-Way Adjacency", "state · ext. circuit ID · neighbor"],
        ]}
      />
    </DiagramSvg>
  );
}

export function ThreeWayDiagram() {
  return (
    <DiagramSvg h={200} label="Three-way handshake: P1 sends Down, P2 moves to Initializing and answers listing P1, P1 goes Up and answers Up, P2 goes Up">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 0, to: 1, label: "IIH · TLV 240 state Down (2)", sub: "P2: Down → Initializing" },
          { from: 1, to: 0, label: "IIH · Initializing (1) · neighbor P1", sub: "P1: Down → Up (its own ID echoed)" },
          { from: 0, to: 1, label: "IIH · Up (0) · neighbor P2", sub: "P2: Initializing → Up" },
        ]}
      />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        Up needs proof of two-way communication: your own System ID in the neighbor&apos;s hello.
      </text>
    </DiagramSvg>
  );
}

export function UpDiagram() {
  return (
    <DiagramSvg h={150} label="All three adjacencies Level-2 Up while the Ethernet links are simply up">
      <IsisChain y={76} segs={{ a: "both", b: "both", c: "both" }} colors={{ a: D.success, b: D.success, c: D.success }} labels={{ a: "L2 adj UP", b: "L2 adj UP", c: "L2 adj UP" }} below={{ a: "Ethernet up", b: "Ethernet up", c: "Ethernet up" }} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        Two separate facts per link: frames get through (Ethernet) and IS-IS agreed to route over it (adjacency).
      </text>
    </DiagramSvg>
  );
}

export function LspDiagram() {
  return (
    <DiagramSvg h={206} label="PE2's LSP: LSP ID, sequence 1, lifetime 1200, checksum, TLV 22 neighbor P2 metric 10, TLV 135 10.0.0.4/32 metric 10">
      <DTable
        x={30}
        y={8}
        title={`PE2's Level-2 LSP (PDU type ${PDU.L2_LSP}) · ${lspLength(pe2)} bytes`}
        cols={[
          { label: "FIELD / TLV", w: 210 },
          { label: "VALUE", w: 370 },
        ]}
        rows={[
          ["LSP ID", `${pe2.id} (System ID · pseudonode 00 · fragment 00)`],
          ["Sequence · Remaining Lifetime", `${hex8s(pe2.seq)} · ${LSP_LIFETIME} s`],
          ["Checksum (Fletcher)", `${hex4(lspChecksum(pe2))} · LSP ID → end (lifetime excluded)`],
          ["TLV 22 Extended IS Reachability", `${ROUTER.P2.sysId}.00 (P2) · metric ${LINK_METRIC}`],
          ["TLV 135 Extended IP Reachability", `10.0.0.4/32 · metric ${PREFIX_METRIC}`],
          ["Also: TLV 1 · 129 · 132 · 137", `area · IPv4 · 10.0.0.4 · hostname PE2`],
        ]}
        highlight={{ row: 4, color: D.warning }}
      />
    </DiagramSvg>
  );
}

export function FloodDiagram() {
  return (
    <DiagramSvg h={170} label="PE2's LSP floods PE2 to P2 to P1 to PE1; each receiver acknowledges with a PSNP">
      <IsisChain y={84} segs={{ a: "left", b: "left", c: "left" }} colors={{ a: D.warning, b: D.warning, c: D.warning }} labels={{ a: "← LSP · 3", b: "← LSP · 2", c: "← LSP · 1" }} below={{ a: "PSNP ack →", b: "PSNP ack →", c: "PSNP ack →" }} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        Newer sequence → install, acknowledge, flood on every other adjacency — never back out the ingress.
      </text>
    </DiagramSvg>
  );
}

export function SyncDiagram() {
  return (
    <DiagramSvg h={196} label="CSNP summarizes LSP headers; PSNP acknowledges or requests specific LSPs">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 1, to: 0, label: `CSNP (${PDU.L2_CSNP}) · 4 LSP entries`, sub: "ID · seq · lifetime · checksum — not routes", color: D.violet },
          { from: 0, to: 1, label: `PSNP (${PDU.L2_PSNP}) · request 0000.0000.0003.00-00`, sub: "entry = P1's older copy (seq 1) → P2 sees it is older", color: D.success },
          { from: 1, to: 0, label: `LSP (${PDU.L2_LSP}) · the requested LSP`, color: D.warning },
          { from: 0, to: 1, label: `PSNP (${PDU.L2_PSNP}) · ack`, color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

export function LsdbDiagram() {
  return (
    <DiagramSvg h={170} label="The converged Level-2 LSDB: four LSPs at sequence 1 on every router">
      <DTable
        x={20}
        y={8}
        title="Level-2 LSDB — identical on PE1, P1, P2 and PE2"
        cols={[
          { label: "LSP ID", w: 180 },
          { label: "SEQ", w: 100 },
          { label: "CHECKSUM", w: 90 },
          { label: "IS NEIGHBORS", w: 110 },
          { label: "IPv4", w: 120 },
        ]}
        rows={all1.map((l) => [l.id, hex8s(l.seq), hex4(lspChecksum(l)), l.isReach.map((n) => n.neighbor).join(", "), `${l.ipReach[0].prefix}/32`])}
      />
    </DiagramSvg>
  );
}

export function SpfDiagram() {
  return (
    <DiagramSvg h={180} label="SPF from PE1: P1 at 10, P2 at 20, PE2 at 30, and 10.0.0.4/32 at 40 via P1">
      <IsisChain y={80} segs={{ a: "right", b: "right", c: "right" }} colors={{ a: D.success, b: D.success, c: D.success }} labels={{ a: "+10", b: "+10", c: "+10" }} subs={{ PE1: "root · 0", P1: "dist 10", P2: "dist 20", PE2: "dist 30" }} />
      <DPill x={564} y={140} text="+ prefix 10 → 40" color={D.warning} w={150} />
      <text x={250} y={146} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        PE1: 10.0.0.4/32 metric 40 via P1 (192.0.2.1)
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Links used only if both ends report them (two-way check). P1 sees 30, P2 sees 20, PE2 advertises 10.
      </text>
    </DiagramSvg>
  );
}

export function FwdDiagram() {
  return (
    <DiagramSvg h={170} label="An ordinary ICMP packet from 10.0.0.1 to 10.0.0.4 is forwarded hop by hop using the IS-IS routes">
      <IsisChain y={80} segs={{ a: "right", b: "right", c: "right" }} colors={{ a: D.ip, b: D.ip, c: D.ip }} labels={{ a: "TTL 64", b: "TTL 63", c: "TTL 62" }} />
      <text x={320} y={140} textAnchor="middle" fill={D.ip} fontSize={10.5} fontWeight={700}>
        Ethernet + IPv4 10.0.0.1 → 10.0.0.4 + ICMP — no IIH, LSP, SNP or TLV
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        IS-IS built the routes (control plane); IPv4 forwarding moves the packet (data plane).
      </text>
    </DiagramSvg>
  );
}

export function IncidentDiagram() {
  return (
    <DiagramSvg h={190} label="Level mismatch: P1 circuit Level-2-only, P2 circuit Level-1-only, Ethernet up, adjacency down, PE1 loses 10.0.0.4">
      <IsisChain y={80} segs={{ a: "both", b: "down", c: "both" }} colors={{ a: D.success, c: D.success }} labels={{ a: "L2 UP", b: "IS-IS adj DOWN", c: "L2 UP" }} below={{ a: "Ethernet up", b: "Ethernet UP", c: "Ethernet up" }} subs={{ P1: "circuit L2 (type 2)", P2: "circuit L1 (type 1)" }} accents={{ P2: D.danger }} />
      <text x={320} y={148} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        No common level on P1–P2 → no adjacency → partition → PE1 has no route to 10.0.0.4
      </text>
      <text x={320} y={168} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        P1 re-originates its LSP (seq 1 → 2) without P2. Stale LSPs may linger, but SPF can&apos;t use a one-way link.
      </text>
    </DiagramSvg>
  );
}

export function RepairDiagram() {
  return (
    <DiagramSvg h={252} label="Repair: P2 back to Level 2, three-way handshake, P1 LSP sequence 3, CSNP, PSNP request, P2 LSP, SPF route restored">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 1, to: 0, label: "IIH · circuit type 2 · Down", sub: "P1: Down → Initializing" },
          { from: 0, to: 1, label: "IIH · Initializing · neighbor P2", sub: "P2: Down → Up" },
          { from: 1, to: 0, label: "IIH · Up · neighbor P1", sub: "P1: Initializing → Up" },
          { from: 0, to: 1, label: "LSP P1 seq 0x00000003", color: D.warning },
          { from: 1, to: 0, label: "CSNP → PSNP request → LSP P2 seq 3", color: D.violet },
        ]}
      />
      <DPill x={320} y={232} text="PE1 SPF: 10.0.0.4/32 metric 40 via P1 — ping delivered" color={D.success} w={380} />
    </DiagramSvg>
  );
}


export function IsisLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="isl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          A provider core starts as four routers cabled in a line — <b className="text-pv-text">PE1, P1, P2, PE2</b> — with no routes at all. PE1 must reach PE2&apos;s loopback, 10.0.0.4, because every later service (BGP sessions, MPLS labels, VPNs) is built between loopbacks. You won&apos;t type a single static route: <b className="text-pv-text">IS-IS</b> will discover the core and build every route itself.
        </p>
        <p>You will watch the four routers become neighbors, describe themselves, share one map and compute their paths. Then one interface setting changes on P2, the core splits in two while every cable stays up, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["read a NET and say which router it names", "explain why IS-IS hellos need no IP", "follow two routers from Down to Up through the three-way handshake", "explain how every router ends up with the same LSDB", "compute PE1's path and metric to PE2 from the LSPs", "find why an adjacency is gone while the link is up, fix it and prove it"]}
        />
      </GuideSection>

      <GuideSection id="isl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Four routers, three point-to-point Ethernet links, one Level-2 domain in area 49.0001. Every link has metric 10.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="The four routers"
          accent="cyan"
          columns={["Router", "Role", "NET", "Loopback"]}
          rows={(["PE1", "P1", "P2", "PE2"] as IsisRouter[]).map((r) => [<b key="r" className="text-pv-text">{r}</b>, r.startsWith("PE") ? "provider edge" : "core", <Mono key="n">{netOf(r)}</Mono>, <Mono key="l">{ROUTER[r].loopback}/32</Mono>])}
        />
        <p className="text-sm text-pv-text-muted">The links are numbered 192.0.2.0/31, .2/31 and .4/31. The IS-IS Lab uses these same four routers and adds P3 and P4 as a second path across; the command outputs on this page come from the lab&apos;s model with that second path switched off, so they show exactly this line.</p>
      </GuideSection>

      <GuideSection id="isl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Hellos on the wire", tone: "cyan", tag: "neighbors", points: ["IS-IS talks directly in Ethernet frames — no IP header", "two routers are neighbors only when each hears itself in the other's hello"] },
            { title: "One map", tone: "violet", tag: "LSPs", points: ["each router describes itself in one LSP", "flooding puts every LSP on every router — the same database everywhere"] },
            { title: "Everyone's own SPF", tone: "success", tag: "routes", points: ["each router runs SPF on its copy of the map", "the result is ordinary IPv4 routes; traffic just follows them"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">You met the link-state idea with OSPF in the Enterprise path. IS-IS is the same idea built differently, and that difference is why providers like it: it doesn&apos;t depend on the IP routing it is building.</p>
      </GuideSection>

      <GuideSection id="isl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Names", body: "Each router's NET: area, System ID, 00.", tone: "violet" },
            { title: "Neighbors", body: "Hellos over each link; Down → Initializing → Up.", tone: "success" },
            { title: "One map", body: "LSPs flood; CSNP and PSNP keep the databases in step.", tone: "warning" },
            { title: "Paths", body: "PE1's SPF: 10.0.0.4 at metric 40 via P1.", tone: "ip" },
            { title: "The incident", body: "P2's interface changes level; the core splits.", tone: "danger" },
            { title: "Repair", body: "Restore the level, re-converge, prove it.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="isl-names" eyebrow="Identity" title="Every router has a NET" tone="violet">
        <DiagramFrame caption="Read the NET right to left: 00 means the router itself, the six bytes before it are the System ID, the rest is the area.">
          <NetDiagram />
        </DiagramFrame>
        <p>
          IS-IS comes from the OSI world, so a router is named by a <b className="text-pv-text">Network Entity Title</b>, not an IP address. The System ID must be unique in the domain; the area matters only at Level 1. In this lesson every router is <b className="text-pv-text">Level-2-only</b>: one flat backbone where areas are never compared.
        </p>
        <p className="text-sm text-pv-text-muted">IPv4 addresses don&apos;t name anything in IS-IS. They are prefixes the routers advertise, just like any other reachability information.</p>
      </GuideSection>

      <GuideSection id="isl-wire" eyebrow="Neighbors" title="Hellos without IP" tone="ethernet">
        <DiagramFrame caption="An IS-IS hello is an 802.3 frame with an LLC header and the IS-IS PDU right after it.">
          <L2Diagram />
        </DiagramFrame>
        <p>
          Each link is a point-to-point circuit, so hellos are <b className="text-pv-text">P2P IIHs</b> (PDU type 17) sent to <Mono>{ALL_ISS}</Mono>. They carry the circuit&apos;s level, the sender&apos;s System ID and, in TLV 240, which neighbor the sender hears. Nothing in them needs an IP address, ARP or a route — so IS-IS can come up before any IP routing exists.
        </p>
        <DiagramFrame caption="P1's hello toward P2. The three-way TLV is what turns two hellos into an adjacency.">
          <IihDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-handshake" eyebrow="Neighbors" title="P1 and P2 become neighbors" tone="success">
        <DiagramFrame caption="Up is earned: a router goes Up only when it hears its own System ID in the neighbor's hello.">
          <ThreeWayDiagram />
        </DiagramFrame>
        <p>
          P1&apos;s first hello lists nobody (state Down). P2 hears it and moves to <b className="text-pv-text">Initializing</b>, answering with a hello that lists P1. P1 now sees its own System ID — proof that P2 hears it — and goes <b className="text-pv-text">Up</b>; its next hello lists P2 and P2 goes Up too. A link that works in only one direction can never get past Initializing.
        </p>
        <DiagramFrame caption="Two facts per link: frames get through (Ethernet up) and IS-IS agreed to route over it (adjacency Up).">
          <UpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-lsp" eyebrow="One map" title="Each router describes itself" tone="warning">
        <DiagramFrame caption="PE2's Level-2 LSP: one neighbor, one loopback.">
          <LspDiagram />
        </DiagramFrame>
        <p>
          Once its adjacencies are Up, each router builds a <b className="text-pv-text">Link State PDU</b>: its neighbors with its own outgoing metric to each (TLV 22), and the prefixes it owns (TLV 135). A router only ever describes itself. The LSP has a <b className="text-pv-text">sequence number</b> that grows with every new version, and a lifetime that counts down from {LSP_LIFETIME} seconds.
        </p>
        <CliPanel run={lineCli(LINE, "P1", "cisco", "show isis database detail P1")} caption="IOS XR · P1's own LSP, as P1 holds it" />
      </GuideSection>

      <GuideSection id="isl-flood" eyebrow="One map" title="One map on every router" tone="warning">
        <DiagramFrame caption="PE2's LSP travels hop by hop; each receiver acknowledges it with a PSNP and passes it on.">
          <FloodDiagram />
        </DiagramFrame>
        <p>A router that receives a newer LSP installs it, acknowledges it and floods it on every other adjacency — never back out of the interface it came from. When an adjacency first comes up, both sides exchange a <b className="text-pv-text">CSNP</b> (a list of every LSP they hold) and send each other only what is missing or older.</p>
        <DiagramFrame caption="Summaries and requests: CSNPs list LSP headers, PSNPs acknowledge or ask for one LSP.">
          <SyncDiagram />
        </DiagramFrame>
        <DiagramFrame caption="After flooding, the four LSPs are identical on PE1, P1, P2 and PE2.">
          <LsdbDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-spf" eyebrow="Paths" title="PE1 computes its path" tone="ip">
        <DiagramFrame caption="PE1 is the root of its own tree; distances add up link by link, then the prefix metric is added.">
          <SpfDiagram />
        </DiagramFrame>
        <p>
          PE1 runs <b className="text-pv-text">SPF</b> on its own LSDB. It uses a link only if <b className="text-pv-text">both</b> ends list it — the two-way check, which keeps a half-broken link out of every path. P1 is 10 away, P2 20, PE2 30. PE2&apos;s loopback adds its prefix metric of {PREFIX_METRIC}: <b className="text-pv-text">10.0.0.4/32, metric 40, via P1</b>.
        </p>
        <p className="text-sm text-pv-text-muted">Every router does the same from its own position. P2 sees PE2 at 10 and PE1 at 20; nobody tells anybody else which path to use, yet the answers agree because the map is the same.</p>
      </GuideSection>

      <GuideSection id="isl-fwd" eyebrow="Paths" title="Traffic follows the table" tone="ip">
        <DiagramFrame caption="A ping from PE1's loopback to PE2's: ordinary IPv4, forwarded hop by hop.">
          <FwdDiagram />
        </DiagramFrame>
        <p>IS-IS never carries user traffic. It fills each router&apos;s routing table; the data plane then does a longest-prefix match at every hop. If the route is missing, the packet is dropped — no matter how healthy every cable is.</p>
      </GuideSection>

      <GuideSection id="isl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in four questions"
          accent="success"
          columns={["Question", "Evidence on PE1", "Healthy answer"]}
          rows={[
            ["Is my neighbor Up?", <Mono key="1">show isis neighbors</Mono>, "P1 Up, L2"],
            ["Do I hold every LSP?", <Mono key="2">show isis database</Mono>, "4 LSPs, the same sequence numbers everywhere"],
            ["What did SPF install?", <Mono key="3">show route 10.0.0.4</Mono>, "isis, metric 40, via 192.0.2.1"],
            ["Does traffic follow?", <Mono key="4">ping 10.0.0.4 source Loopback0</Mono>, "!!!!!"],
          ]}
        />
        <CliPanel run={lineCli(LINE, "PE1", "cisco", "show isis neighbors")} caption="IOS XR · PE1" />
        <CliPanel run={lineCli(LINE, "PE1", "cisco", "show isis database")} caption="IOS XR · PE1 — the asterisk marks PE1's own LSP" />
        <CliPair cisco={lineCli(LINE, "PE1", "cisco", "show route 10.0.0.4")} junos={lineCli(LINE, "PE1", "juniper", "show route 10.0.0.4")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1 (IS-IS Level 2 = preference 18)" />
      </GuideSection>

      <GuideSection id="isl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>
          During a change window someone set <Mono>circuit-type level-1</Mono> on P2&apos;s P1-facing interface. Thirty seconds later PE1 can no longer reach 10.0.0.4. Every Ethernet link is still up, every IP address unchanged.
        </p>
        <DiagramFrame caption="Every cable up; the routing domain split in two.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["P2 is a Level-2-only router; level-1 on that interface leaves it running no level at all", "no common level → no adjacency P1–P2", "P1 and P2 drop each other from their LSPs; SPF loses the only path"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["a cable or port: Ethernet is up/up", "addressing or ARP: hellos don't use IP", "the area: Level 2 never compares areas"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="isl-investigate" eyebrow="Incident" title="Walk the chain" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What exactly fails?", look: "PE1 has no route to 10.0.0.4 at all — not a wrong path, no path." },
            { question: "Where does the map stop?", look: "PE1 still holds P2's and PE2's LSPs, but P1's newest LSP (sequence 2) no longer lists P2." },
            { question: "Which adjacency is gone?", look: "P1 lists only PE1: the P1–P2 adjacency is missing while the link is up." },
            { question: "Why won't it form?", look: "Compare both ends: P1 runs Level 2 on Gi0/0/0/1; P2's Gi0/0/0/0 runs no level (circuit type level-1 on a Level-2-only router)." },
          ]}
        />
        <CliPanel run={lineCli(LINE_BROKEN, "PE1", "cisco", "show route 10.0.0.4")} caption="IOS XR · PE1 — the symptom" />
        <CliPanel run={lineCli(LINE_BROKEN, "PE1", "cisco", "show isis database")} caption="IOS XR · PE1 — P1's LSP moved to sequence 2; PE2's is still there" />
        <CliPanel run={lineCli(LINE_BROKEN, "P1", "cisco", "show isis neighbors")} caption="IOS XR · P1 — P2 is missing" />
        <CliPanel run={{ ...lineCli(LINE_BROKEN, "P2", "cisco", "show isis interface GigabitEthernet0/0/0/0"), output: pickLines(lineCli(LINE_BROKEN, "P2", "cisco", "show isis interface GigabitEthernet0/0/0/0").output, /Enabled|Adjacency Formation|Circuit Type|Media Type/, 0) }} caption="IOS XR · P2 (lines that matter) — the interface runs no level" />
        <Callout tone="warning" title="Why PE1 still holds PE2's LSP" icon="!">
          A router that can no longer be reached doesn&apos;t delete its LSP from everybody else&apos;s database: the copy stays until it ages out. SPF ignores it anyway, because P2 no longer lists P1 and P1 no longer lists P2 — the two-way check fails.
        </Callout>
      </GuideSection>

      <GuideSection id="isl-repair" eyebrow="Incident" title="Repair and prove it" tone="success">
        <p>Fix the one thing that is wrong: P2&apos;s interface back to the default circuit type (or level-2-only). On IOS XR the change is a candidate until you commit it:</p>
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:P2(config-isis-if)#", command: "no circuit-type", output: "RP/0/RP0/CPU0:P2(config-isis-if)#commit\nRP/0/RP0/CPU0:P2(config-isis-if)#end" }} caption="IOS XR · P2, inside router isis CORE → interface GigabitEthernet0/0/0/0" />
        <DiagramFrame caption="The handshake runs again, both routers re-originate their LSPs, the databases resynchronize and SPF finds the path.">
          <RepairDiagram />
        </DiagramFrame>
        <CliPanel run={lineCli(LINE_FIXED, "PE1", "cisco", "show route 10.0.0.4")} caption="IOS XR · PE1 — the route is back" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["P1–P2 adjacency Up on both routers", "P1 and P2 re-originated their LSPs; every database holds the same sequence numbers", "PE1: 10.0.0.4/32 metric 40 via P1", "a fresh ping from PE1's loopback to 10.0.0.4 succeeds"]} />
        <p className="text-sm text-pv-text-muted">The repair raises P1&apos;s sequence number again (to 3 here): sequence numbers only move forward, so every router knows the newest copy wins.</p>
      </GuideSection>

      <GuideSection id="isl-other" eyebrow="Beyond this incident" title="Other ways IS-IS breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "MTU", title: "Different MTUs on one link", tone: "warning", points: ["hellos are padded to the MTU; the smaller side drops the bigger side's hellos", "one side Initializing, the other nothing", "giants on the smaller side's interface"] },
            { tag: "AUTH", title: "Hello keys don't match", tone: "warning", points: ["the side with a key drops hellos it can't verify", "authentication drops in the log", "one-way or no adjacency"] },
            { tag: "LO", title: "Loopback not in IS-IS", tone: "danger", points: ["every adjacency Up, every LSDB in sync", "the router's LSP has no /32 for its loopback", "everything built between loopbacks fails"] },
            { tag: "OL", title: "Overload bit left set", tone: "violet", points: ["the router stays reachable", "nobody routes through it", "OL = 1 in its LSP"] },
            { tag: "MET", title: "A metric changed on one side", tone: "cyan", points: ["traffic moves in one direction only", "the two ends of a link show different metrics"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each of these is a ticket in the IS-IS Lab, where the second path (P3–P4) makes some of them subtler: traffic keeps flowing, just not where you expect.</p>
      </GuideSection>

      <GuideSection id="isl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture every router holding <b className="text-pv-text">the same map, drawn by everyone</b>: each router draws only its own corner (its neighbors and its prefixes) and posts a copy to everyone else. Hellos decide who is allowed to draw a line between two routers — both must agree, or the line isn&apos;t drawn. Every router then finds its own shortest paths on the shared map.
        </p>
        <Callout tone="cyan" title="When something breaks, ask in this order" icon="→">
          Is the line drawn (adjacency, both ends)? Does everyone have the newest drawing (LSDB, sequence numbers)? What does each corner say (TLVs: neighbors, prefixes, overload)? What did SPF make of it (routes)?
        </Callout>
      </GuideSection>

      <GuideSection id="isl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "NET", def: "Network Entity Title: area + System ID + NSEL 00. Names the router." },
            { term: "IIH", def: "IS-IS Hello; type 17 on point-to-point circuits." },
            { term: "Three-way handshake", def: "TLV 240: Up only when you see your own System ID in the neighbor's hello." },
            { term: "LSP", def: "Link State PDU: one router's description of itself; type 20 at Level 2." },
            { term: "Sequence number", def: "Grows with every new version of an LSP; the higher one wins." },
            { term: "CSNP / PSNP", def: "Complete / Partial Sequence Number PDUs: database summary / acknowledge or request." },
            { term: "LSDB", def: "Link-state database: every LSP a router holds, identical across the level." },
            { term: "Two-way check", def: "SPF uses a link only when both ends list each other." },
            { term: "Circuit type", def: "Which levels an interface may run; combined with the router's is-type." },
          ]}
        />
      </GuideSection>

      <GuideSection id="isl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard
          tone="success"
          title="You can now"
          mark="✓"
          items={["name a router from its NET (area · System ID · 00)", "explain why IS-IS hellos run with no IP", "follow Down → Initializing → Up", "explain sequence numbers, flooding and CSNP/PSNP", "compute an SPF path and its metric", "tell an adjacency failure from a link failure, and prove a repair with fresh evidence"]}
        />
      </GuideSection>

      <GuideSection id="isl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab teaches IS-IS in full — levels and areas, broadcast circuits, LSP lifecycle, TLVs, metrics, overload, authentication, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the IS-IS presentation: the same core, step by step.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
