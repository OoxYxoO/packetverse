import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { EVPN_EXPORT_RT, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK, rdFor } from "@/lib/sim-engine/scenarios/evpnVxlan";
import { createEvNet, evApply, evTicket, evTicketState, type EvHost, type EvR, type EvState } from "@/lib/sim-engine/scenarios/evNet";
import { evSets, evStaticApi } from "./ev-lab/evCli";

export const EVPNV_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ev-mission", label: "What this lesson teaches" },
  { id: "ev-network", label: "The network of this lesson" },
  { id: "ev-ideas", label: "Three ideas you need" },
  { id: "ev-watch", label: "What you will watch" },
  { id: "ev-layers", label: "Underlay and overlay" },
  { id: "ev-vlan-vni", label: "VLAN and VNI" },
  { id: "ev-vtep", label: "What a VTEP does" },
  { id: "ev-encap", label: "VXLAN on the wire" },
  { id: "ev-why-evpn", label: "Why a control plane" },
  { id: "ev-type3", label: "Type 3: the flood list" },
  { id: "ev-type2", label: "Type 2: where each MAC lives" },
  { id: "ev-rd-rt", label: "RD and RT" },
  { id: "ev-mac", label: "Local and remote MACs" },
  { id: "ev-first", label: "The first ping, step by step" },
  { id: "ev-working", label: "What working looks like" },
  { id: "ev-incident", label: "The incident" },
  { id: "ev-investigate", label: "Walk the evidence" },
  { id: "ev-fix", label: "Repair and prove it" },
  { id: "ev-other", label: "Other ways it fails" },
  { id: "ev-model", label: "Mental model" },
  { id: "ev-glossary", label: "Glossary" },
  { id: "ev-recap", label: "Recap" },
  { id: "ev-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the EVPN-VXLAN Lab's model and its Junos command set: the
 * healthy fabric (before and after a real ping) and the lab's "rt" ticket — the guided lesson's incident (LEAF1's VNI
 * 10010 route target typed as 65000:99999).
 */
export const EV_FRESH: EvState = createEvNet(0);
const ping = (s: EvState, from: EvHost, dst: string) => evApply(s, { type: "test", from, dst });
export const EV_LEARNED = ping(EV_FRESH, "HOST-A", "10.10.10.22");
const EV_AGAIN = ping(EV_LEARNED, "HOST-A", "10.10.10.22");
const EV_FAULT = evTicket("rt").repro.reduce((acc, a) => evApply(acc, a), evTicketState("rt", 0));
const EV_FIXED = ping(evApply(EV_FAULT, { type: "set", text: "LEAF1: VNI 10010 route target back to 65000:10010", changes: [{ dev: "LEAF1", f: (c) => void (c.evpn!.targets[10010] = "65000:10010") }] }), "HOST-A", "10.10.10.22");
export function evCli(s: EvState, r: EvR, command: string) {
  return runGuideCli(evSets(evStaticApi(s, r), r).juniper, command);
}
export function evOnly(s: EvState, r: EvR, command: string, match: RegExp, keep = 0) {
  const x = evCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One host ping, as the lab reports it. */
export function PingResult({ s, title }: { s: EvState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back — ${t.crossed ? "across the fabric" : "on the leaf"}${t.flooded ? ", part of it flooded" : ", every frame unicast"}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the EVPN-VXLAN Lab" onPractice={openLab}>
      Two leaves and a spine on Junos, real EVPN routes and VXLAN packets, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`Spine-leaf fabric: HOST-A on LEAF1 (VTEP ${VTEP_LOOPBACK.LEAF1}), HOST-B on LEAF2 (VTEP ${VTEP_LOOPBACK.LEAF2}), SPINE1 routes the underlay only`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}`, host: "HOST-B", hostSub: HOST_B_IP },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        both hosts are in VLAN {VLAN} — but the leaf-to-spine links are routed IP links
      </text>
    </DiagramSvg>
  );
}

function LayersDiagram() {
  const band = (y: number, label: string, sub: string, color: string) => (
    <g>
      <rect x={40} y={y} width={560} height={46} rx={10} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.7} />
      <text x={60} y={y + 20} fill={color} fontSize={12} fontWeight={700}>
        {label}
      </text>
      <text x={60} y={y + 36} fill={D.muted} fontSize={10}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={190} label="Three layers: tenant overlay segment, VXLAN tunnel between VTEPs, IP underlay between loopbacks">
      {band(16, `Overlay — VNI ${VNI}`, "one logical Layer-2 segment for the tenant hosts", D.violet)}
      {band(70, "VXLAN tunnel — VTEP to VTEP", `${VTEP_LOOPBACK.LEAF1} ↔ ${VTEP_LOOPBACK.LEAF2}, UDP 4789`, D.ip)}
      {band(124, "Underlay — ordinary IP routing", "SPINE1 only needs to reach the VTEP loopbacks", D.cyan)}
    </DiagramSvg>
  );
}

function VlanVniDiagram() {
  return (
    <DiagramSvg h={170} label={`LEAF1 maps local VLAN ${VLAN} to VNI ${VNI}; LEAF2 maps its own local VLAN ${VLAN} to the same VNI; the VNI unifies them`}>
      <DRouteCard x={30} y={20} w={190} title="LEAF1 (local)" rows={[{ label: "access VLAN", value: String(VLAN) }, { label: "mapped to", value: `VNI ${VNI}`, strong: true }]} color={D.cyan} />
      <DRouteCard x={420} y={20} w={190} title="LEAF2 (local)" rows={[{ label: "access VLAN", value: String(VLAN) }, { label: "mapped to", value: `VNI ${VNI}`, strong: true }]} color={D.cyan} />
      <rect x={250} y={36} width={140} height={44} rx={10} fill={D.violet} fillOpacity={0.14} stroke={D.violet} />
      <text x={320} y={57} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        VNI {VNI}
      </text>
      <text x={320} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
        fabric-wide, 24-bit
      </text>
      <DArrow x1={222} y1={58} x2={248} y2={58} color={D.violet} />
      <DArrow x1={418} y1={58} x2={392} y2={58} color={D.violet} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        VLAN numbers are local to each leaf — the VNI is what joins the two access ports
      </text>
    </DiagramSvg>
  );
}

function EncapDiagram() {
  return (
    <DiagramSvg h={210} label={`VXLAN stack leaving LEAF1: outer Ethernet, outer IP ${VTEP_LOOPBACK.LEAF1} to ${VTEP_LOOPBACK.LEAF2}, UDP 4789, VXLAN VNI ${VNI}, then the original HOST-A to HOST-B frame`}>
      <text x={200} y={18} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving LEAF1
      </text>
      <DHeaderColumn
        x={200}
        y={28}
        w={290}
        rows={[
          { text: "Outer Ethernet (per underlay hop)", color: D.faint, tag: "L2" },
          { text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF2}`, color: D.ip, tag: "VTEPs", strong: true },
          { text: "UDP dst 4789", color: D.ip, tag: "UDP" },
          { text: `VXLAN · VNI ${VNI}`, color: D.violet, tag: "VXLAN", strong: true },
          { text: `Ethernet ${HOST_A_MAC} → ${HOST_B_MAC}`, color: D.eth, tag: "INNER" },
          { text: `IPv4 ${HOST_A_IP} → ${HOST_B_IP}`, color: D.eth },
        ]}
      />
      <text x={500} y={60} textAnchor="middle" fill={D.muted} fontSize={10}>
        SPINE1 reads only
      </text>
      <text x={500} y={74} textAnchor="middle" fill={D.ip} fontSize={10} fontWeight={700}>
        the outer IP
      </text>
      <DArrow x1={440} y1={70} x2={350} y2={70} color={D.faint} width={1.4} />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        the inner frame is carried unchanged — HOST-B receives exactly what HOST-A sent
      </text>
    </DiagramSvg>
  );
}

function Type2Diagram() {
  return (
    <DiagramSvg h={250} label={`LEAF2 advertises a Type 2 route for HOST-B to LEAF1: MAC ${HOST_B_MAC}, IP ${HOST_B_IP}, VNI ${VNI}, RD ${rdFor("LEAF2")}, RT ${EVPN_EXPORT_RT}, next hop ${VTEP_LOOPBACK.LEAF2}`}>
      <DRouteCard
        x={180}
        y={16}
        w={280}
        title="EVPN Type 2 — MAC/IP Advertisement"
        rows={[
          { label: "MAC", value: HOST_B_MAC },
          { label: "IP", value: HOST_B_IP },
          { label: "VNI", value: String(VNI) },
          { label: "RD (uniqueness)", value: rdFor("LEAF2") },
          { label: "RT (import policy)", value: EVPN_EXPORT_RT },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF2} (LEAF2 VTEP)`, strong: true },
        ]}
      />
      <text x={80} y={186} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        LEAF1
      </text>
      <text x={560} y={186} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        LEAF2
      </text>
      <DArrow x1={525} y1={182} x2={115} y2={182} color={D.bgp} dashed label="" />
      <text x={320} y={216} textAnchor="middle" fill={D.bgp} fontSize={10} fontWeight={700}>
        BGP UPDATE (L2VPN EVPN) — control plane, never a tenant packet
      </text>
      <text x={320} y={234} textAnchor="middle" fill={D.muted} fontSize={10}>
        the next hop names the VTEP that owns the endpoint — never the host itself
      </text>
    </DiagramSvg>
  );
}

function MacTableDiagram() {
  return (
    <DiagramSvg h={160} label={`LEAF1 MAC table: ${HOST_A_MAC} local on the access port; ${HOST_B_MAC} remote via VTEP ${VTEP_LOOPBACK.LEAF2}, learned from EVPN`}>
      <DRouteCard
        x={120}
        y={16}
        w={400}
        title="LEAF1 — VNI MAC table"
        color={D.cyan}
        rows={[
          { label: `${HOST_A_MAC} (${HOST_A_IP})`, value: "LOCAL · access port" },
          { label: `${HOST_B_MAC} (${HOST_B_IP})`, value: `REMOTE · via ${VTEP_LOOPBACK.LEAF2} (EVPN)`, strong: true },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the forwarding entry is installed FROM the Type 2 route — related to it, not the same object
      </text>
    </DiagramSvg>
  );
}

export function EvpnVxlanLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ev-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          HOST-A and HOST-B sit in two racks, behind two different leaf switches, and the application wants them in one subnet, <Mono>10.10.10.0/24</Mono>. But a modern data-center fabric is routed between leaf and spine: no VLAN crosses the spine. This lesson shows how the leaves still give the hosts one Ethernet segment — <b className="text-pv-text">VXLAN</b> carries the frames inside IP packets — and how they know where every host lives — <b className="text-pv-text">BGP EVPN</b> tells them.
        </p>
        <p>You will watch a frame being wrapped, routed and unwrapped, watch the leaves announce themselves and their hosts in BGP, and finally meet an incident where the underlay is fine, the BGP session is Established — and HOST-A still can&apos;t reach HOST-B.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain underlay and overlay, and what the spine knows", "map a VLAN to a VNI and say why the VLAN number stays local", "read a VXLAN packet's headers", "explain what Type 3 and Type 2 routes do", "tell local from remote MACs, and where each comes from", "find a route-target fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="ev-network" eyebrow="This lesson" title="The network of this lesson" tone="ospf">
        <DiagramFrame caption="A spine-leaf fabric: the leaf–spine links are routed IP links.">
          <FabricDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="cyan"
          columns={["Device", "Address", "Role"]}
          rows={[
            ["LEAF1", <Mono key="1">10.255.0.1</Mono>, "VTEP · HOST-A (and HOST-C, HOST-E) behind it"],
            ["LEAF2", <Mono key="2">10.255.0.2</Mono>, "VTEP · HOST-B (and HOST-F) behind it"],
            ["SPINE1", <Mono key="3">10.255.0.254</Mono>, "IP underlay only (OSPF)"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same network — on Junos" icon="i">
          VLAN {VLAN} maps to VNI {VNI} on both leaves, route target {EVPN_EXPORT_RT}, and LEAF1 and LEAF2 run their iBGP EVPN session directly between loopbacks (AS 65000), as in the guided lesson. The lab adds HOST-C on LEAF1 and a second VLAN (V20, HOST-E and HOST-F) to stretch yourself. EVPN-VXLAN data-center leaves are configured here in Junos (QFX style); Junos prints MAC addresses in lower case. Every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="ev-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Underlay", tone: "cyan", tag: "routed IP", points: ["OSPF between leaves and spine", "only needs to reach the VTEP loopbacks"] },
            { title: "VXLAN", tone: "violet", tag: "data plane", points: ["Ethernet frame inside UDP/IP", "the VNI names the segment"] },
            { title: "EVPN", tone: "warning", tag: "control plane", points: ["BGP tells who has which VNI (Type 3)", "and where each MAC lives (Type 2)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ev-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The pieces", body: "VTEPs, VLAN → VNI.", tone: "violet" },
            { title: "Wrap and route", body: "VXLAN across the spine.", tone: "cyan" },
            { title: "The question", body: "How did LEAF1 know?", tone: "warning" },
            { title: "EVPN", body: "Type 3, then Type 2.", tone: "success" },
            { title: "The incident", body: "Established, yet broken.", tone: "danger" },
            { title: "Repair", body: "One route target, a fresh ping.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ev-layers" eyebrow="Model" title="Underlay and overlay" tone="ip">
        <DiagramFrame caption="The overlay rides on a tunnel, which rides on the underlay.">
          <LayersDiagram />
        </DiagramFrame>
        <p>The underlay is plain routing: OSPF makes each leaf&apos;s loopback reachable. Everything else — the tunnel and the tenant segment — rests on that.</p>
        <CliPanel run={evCli(EV_FRESH, "SPINE1", "show route table inet.0")} caption="Junos · SPINE1 — loopbacks and links; no tenant address, no MAC" />
      </GuideSection>

      <GuideSection id="ev-vlan-vni" eyebrow="Identifiers" title="VLAN and VNI" tone="violet">
        <DiagramFrame caption="Local VLANs, one fabric-wide VNI.">
          <VlanVniDiagram />
        </DiagramFrame>
        <p>On each leaf the access ports belong to a VLAN, and the VLAN maps to a VNI. The VLAN ID never leaves the leaf; the VNI travels in every VXLAN packet. LEAF2 could call its VLAN 110 and nothing would change.</p>
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show configuration vlans")} caption="Junos · LEAF1 — V10 maps to VNI 10010; V20 isn't stretched yet" />
      </GuideSection>

      <GuideSection id="ev-vtep" eyebrow="Roles" title="What a VTEP does" tone="violet">
        <FieldTable
          title="A VTEP's two directions"
          accent="violet"
          columns={["Direction", "What happens"]}
          rows={[
            ["Ingress (from a host)", "learn the source MAC, look up the destination, map VLAN → VNI, wrap in VXLAN to the remote VTEP — or replicate to every remote VTEP for a broadcast"],
            ["Egress (from the fabric)", "unwrap, map VNI → local VLAN, look up the destination MAC, deliver — never send it back into the fabric"],
          ]}
        />
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show configuration switch-options")} caption="Junos · LEAF1 — the VTEP address is lo0.0" />
      </GuideSection>

      <GuideSection id="ev-encap" eyebrow="Data plane" title="VXLAN on the wire" tone="ip">
        <DiagramFrame caption="Fifty bytes of envelope around an unchanged frame.">
          <EncapDiagram />
        </DiagramFrame>
        <p>The spine routes on the outer IP header only. LEAF2 strips the envelope, reads VNI 10010 and delivers the original frame to HOST-B.</p>
      </GuideSection>

      <GuideSection id="ev-why-evpn" eyebrow="Motivation" title="Why a control plane" tone="warning">
        <p>VXLAN only moves frames. To send HOST-A&apos;s frame to 10.255.0.2, LEAF1 must already know that HOST-B lives there; to send a broadcast, it must know every VTEP that has VNI 10010. Plain VXLAN can flood and learn from returning traffic. EVPN replaces that guesswork with BGP: one session between the leaves&apos; loopbacks, address family EVPN.</p>
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show bgp summary")} caption="Junos · LEAF1 — the EVPN session, before any host has spoken" />
      </GuideSection>

      <GuideSection id="ev-type3" eyebrow="Control plane" title="Type 3: the flood list" tone="bgp">
        <p>Before any host speaks, each leaf advertises a <b className="text-pv-text">Type 3</b> (inclusive multicast Ethernet tag) route for every VNI it has. When LEAF1 imports LEAF2&apos;s, LEAF2 goes on LEAF1&apos;s flood list for VNI 10010: every broadcast gets one copy to 10.255.0.2 (ingress replication).</p>
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show route table bgp.evpn.0")} caption="Junos · LEAF1 — two Type 3 routes (IM), no MAC yet" />
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show ethernet-switching vxlan-tunnel-end-point remote")} caption="Junos · LEAF1 — LEAF2 is a remote VTEP for VNI 10010" />
        <Callout tone="cyan" title="Beyond the guided lesson" icon="i">
          The guided lesson keeps to Type 2. A real fabric needs Type 3 too — without it a leaf has nowhere to send the very first ARP broadcast — so the lab models it. The EVPN BUM lesson goes deeper.
        </Callout>
      </GuideSection>

      <GuideSection id="ev-type2" eyebrow="Control plane" title="Type 2: where each MAC lives" tone="bgp">
        <DiagramFrame caption="LEAF2's route for HOST-B.">
          <Type2Diagram />
        </DiagramFrame>
        <p>As soon as a leaf learns a MAC on a local port, it advertises a <b className="text-pv-text">Type 2</b> route: the MAC alone, and the MAC with the host&apos;s IP once it has seen an ARP. The next hop is the leaf&apos;s own VTEP — never the host.</p>
        <CliPanel run={evOnly(EV_LEARNED, "LEAF1", "show route table bgp.evpn.0", /^(bgp|2:|3:)|from 10\.255/)} caption="Junos · LEAF1 after one ping — its own Type 2 routes, LEAF2's for HOST-B, both Type 3" />
      </GuideSection>

      <GuideSection id="ev-rd-rt" eyebrow="Control plane" title="RD and RT" tone="bgp">
        <FieldTable
          title="Two different jobs"
          accent="violet"
          columns={["Field", "In this lab", "Job"]}
          rows={[
            ["RD", <Mono key="1">{rdFor("LEAF2")}</Mono>, "keeps LEAF2's routes distinct from anyone else's in BGP"],
            ["RT", <Mono key="2">{EVPN_EXPORT_RT}</Mono>, "the import test: a leaf keeps a route only if it carries a route target it imports"],
          ]}
        />
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show configuration protocols evpn")} caption="Junos · LEAF1 — VNI 10010 with route target 65000:10010" />
      </GuideSection>

      <GuideSection id="ev-mac" eyebrow="Tables" title="Local and remote MACs" tone="cyan">
        <DiagramFrame caption="The forwarding entry is installed from the route.">
          <MacTableDiagram />
        </DiagramFrame>
        <p>HOST-A is local to LEAF1 — learned from its frames on xe-0/0/1. HOST-B is remote — learned from LEAF2&apos;s Type 2 route, never from the tunnel; the switching table lists it behind the VTEP interface.</p>
        <CliPanel run={evCli(EV_LEARNED, "LEAF1", "show evpn database")} caption="Junos · LEAF1 — HOST-A on xe-0/0/1.0, HOST-B behind 10.255.0.2, both with their IPs" />
        <CliPanel run={evOnly(EV_LEARNED, "LEAF1", "show ethernet-switching table", /Vlan|name|V10|entries/)} caption="Junos · LEAF1 — D (local) and DR (remote, behind vtep.32769)" />
      </GuideSection>

      <GuideSection id="ev-first" eyebrow="Data plane" title="The first ping, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "ARP request", body: "A broadcast. LEAF1 learns HOST-A, advertises it (Type 2), and replicates the broadcast to 10.255.0.2.", tone: "warning" },
            { title: "At LEAF2", body: "Unwrapped, flooded to its local VLAN 10 ports only.", tone: "cyan" },
            { title: "ARP reply", body: "LEAF2 learns HOST-B, advertises it, and already knows HOST-A from BGP: one unicast VXLAN packet.", tone: "success" },
            { title: "Echo", body: "Both MACs known everywhere: unicast both ways.", tone: "success" },
          ]}
        />
        <PingResult s={EV_LEARNED} title="The lab: the first ping HOST-A → HOST-B" />
        <PingResult s={EV_AGAIN} title="The lab: the same ping again" />
      </GuideSection>

      <GuideSection id="ev-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "Junos", "Healthy answer"]}
          rows={[
            ["Can LEAF1 reach LEAF2's VTEP?", <Mono key="1">show route 10.255.0.2</Mono>, "an OSPF route"],
            ["Is the session up with EVPN?", <Mono key="2">show bgp summary</Mono>, "Establ, bgp.evpn.0 routes accepted"],
            ["Is LEAF2 a remote VTEP for VNI 10010?", <Mono key="3">show ethernet-switching vxlan-tunnel-end-point remote</Mono>, "10.255.0.2, VNID 10010"],
            ["Where is HOST-B?", <Mono key="4">show evpn database</Mono>, "behind 10.255.0.2"],
            ["Does traffic flow?", "fresh pings", "HOST-A ↔ HOST-B"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ev-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>HOST-A can&apos;t reach HOST-B. LEAF1&apos;s access port is up, the underlay is converged, LEAF1 pings LEAF2&apos;s VTEP loopback, and the BGP EVPN session shows Established.</p>
        <PingResult s={EV_FAULT} title="The lab: HOST-A pings 10.10.10.22 (the ticket)" />
      </GuideSection>

      <GuideSection id="ev-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is the underlay fine?", look: "Yes — LEAF1 has an OSPF route to 10.255.0.2." },
            { question: "Is the session up with EVPN?", look: "Established, family evpn — but 1 route received, 0 accepted." },
            { question: "Why was it not accepted?", look: "LEAF2's Type 3 route carries 65000:10010; LEAF1's VNI 10010 imports 65000:99999." },
            { question: "What does that cost?", look: "No remote VTEP for VNI 10010: the ARP broadcast never leaves LEAF1." },
          ]}
        />
        <CliPanel run={evOnly(EV_FAULT, "LEAF1", "show bgp summary", /Peer|^10\.255|bgp\.evpn|default-switch/)} caption="Junos · LEAF1 — Received 1, Accepted 0" />
        <CliPanel run={evCli(EV_FAULT, "LEAF1", "show configuration protocols evpn")} caption="Junos · LEAF1 — vrf-target target:65000:99999" />
        <CliPanel run={evCli(EV_FAULT, "LEAF1", "show ethernet-switching vxlan-tunnel-end-point remote")} caption="Junos · LEAF1 — no remote VTEP" />
        <Callout tone="cyan" title="The guided lesson and the lab" icon="i">
          The guided lesson changes only LEAF1&apos;s import target. On Junos, <Mono>vni-options vni 10010 vrf-target</Mono> sets import and export together, so in the lab LEAF2 also drops LEAF1&apos;s routes. Same root cause, same fix.
        </Callout>
      </GuideSection>

      <GuideSection id="ev-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPanel run={{ prompt: "admin@LEAF1# ", command: "set protocols evpn vni-options vni 10010 vrf-target target:65000:10010", output: "\n[edit]\nadmin@LEAF1# commit and-quit\ncommit complete\nExiting configuration mode" }} caption="Junos · LEAF1" />
        <PingResult s={EV_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["each leaf accepts the other's Type 3 route again: LEAF2 is back on LEAF1's flood list", "the Type 2 routes follow as the hosts talk", "a fresh ping from HOST-A reaches HOST-B"]} />
      </GuideSection>

      <GuideSection id="ev-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "VNI", title: "VLAN mapped to a different VNI", tone: "danger", points: ["routes accepted, VNI unknown", "packets dropped at the far leaf"] },
            { tag: "AF", title: "No family evpn", tone: "danger", points: ["session Established", "zero EVPN routes"] },
            { tag: "IGP", title: "VTEP loopback missing from OSPF", tone: "warning", points: ["session down", "nothing crosses"] },
            { tag: "PORT", title: "Host port in the wrong VLAN", tone: "violet", points: ["that host silent", "its Type 2 route gone"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the EVPN-VXLAN Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="ev-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture two office buildings joined by the city&apos;s ordinary postal system (the underlay). Each building has a mailroom (the VTEP) that puts internal envelopes into a city envelope addressed to the other mailroom, with a department code on it (the VNI) — the city post office (the spine) only reads the street address. The two mailrooms also keep each other informed by phone (BGP EVPN): &quot;I handle department 10010&quot; (Type 3) and &quot;Bob from department 10010 sits here&quot; (Type 2). Each mailroom only writes down calls for departments it serves (the route target). The incident is a mailroom that changed the department code on its phone list: the calls still come in, and it ignores every one of them.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Is the host&apos;s port in the right VLAN? Can each VTEP reach the other&apos;s loopback? Is the session up with family evpn? Does the VLAN map to the same VNI on both leaves? Are the routes accepted — do the route targets match?
        </Callout>
      </GuideSection>

      <GuideSection id="ev-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VTEP", def: "VXLAN tunnel endpoint: wraps and unwraps VXLAN; addressed by its loopback." },
            { term: "VNI", def: "VXLAN network identifier: the 24-bit, fabric-wide segment ID in every VXLAN header." },
            { term: "Underlay / overlay", def: "The routed fabric that reaches the loopbacks / the tenant segments carried across it." },
            { term: "EVPN", def: "Ethernet VPN: a BGP address family that carries VTEP membership and MAC/IP reachability." },
            { term: "Type 2", def: "MAC/IP advertisement route: this MAC (and IP) lives behind this VTEP." },
            { term: "Type 3", def: "Inclusive multicast Ethernet tag route: this VTEP has this VNI — the flood list." },
            { term: "Ingress replication", def: "The ingress leaf sends one copy of a broadcast to every remote VTEP of the VNI." },
            { term: "RD / RT", def: "Keeps a route unique / decides whether a leaf imports it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ev-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["separate underlay, tunnel and overlay", "map VLANs to VNIs and keep VLAN numbers local", "read a VXLAN packet", "explain Type 3 and Type 2 routes", "tell local from remote MACs", "find, fix and prove a route-target fault"]} />
      </GuideSection>

      <GuideSection id="ev-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers EVPN-VXLAN in full: the two planes, the VXLAN header, EVPN&apos;s routes and instance model, MAC-only versus MAC+IP, the VTEP as next hop, Junos configuration and verification, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the EVPN-VXLAN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
