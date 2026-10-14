import { CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { LDP_LABEL, LOOP, VPN_LABEL } from "@/lib/sim-engine/scenarios/troubleshootingMpls";

export const MP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "mpd-underlay", label: "IP underlay" },
  { id: "mpd-ldp", label: "LDP transport LSP" },
  { id: "mpd-lib", label: "LIB vs LFIB" },
  { id: "mpd-shim", label: "The label header" },
  { id: "mpd-vrf", label: "VRFs" },
  { id: "mpd-rdrt", label: "RD and RT" },
  { id: "mpd-vpnv4", label: "MP-BGP VPNv4" },
  { id: "mpd-nh", label: "Next-hop resolution" },
  { id: "mpd-php", label: "PHP" },
  { id: "mpd-pe", label: "P vs PE" },
  { id: "mpd-planes", label: "Troubleshooting by plane" },
  { id: "mpd-glossary", label: "Glossary" },
];

function UnderlayDiagram() {
  return (
    <DiagramSvg h={130} label="The IP underlay: an IGP advertises every PE and P loopback so labels can be bound to them">
      {[
        { x: 90, n: "PE1", s: LOOP.PE1 },
        { x: 250, n: "P1", s: LOOP.P1 },
        { x: 410, n: "P2", s: LOOP.P2 },
        { x: 570, n: "PE2", s: LOOP.PE2 },
      ].map((h, i, all) => (
        <g key={h.n}>
          <DNode x={h.x} y={55} label={h.n} sub={`${h.s}/32`} accent={h.n.startsWith("PE") ? D.warning : D.violet} w={110} />
          {i < all.length - 1 && <DLink x1={h.x + 55} y1={55} x2={all[i + 1].x - 55} y2={55} label="IGP" />}
        </g>
      ))}
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        No loopback route → no LDP binding used → no LSP. The underlay is the first plane to check.
      </text>
    </DiagramSvg>
  );
}

function LdpDiagram() {
  return (
    <DiagramSvg h={140} label={`LDP bindings for FEC ${LOOP.PE2}/32: PE2 advertises implicit-null, P2 advertises ${LDP_LABEL.toPE2.P2}, P1 advertises ${LDP_LABEL.toPE2.P1}; labels flow upstream, traffic flows downstream`}>
      {[
        { x: 90, n: "PE1", s: "uses 16004" },
        { x: 250, n: "P1", s: `local ${LDP_LABEL.toPE2.P1}` },
        { x: 410, n: "P2", s: `local ${LDP_LABEL.toPE2.P2}` },
        { x: 570, n: "PE2", s: "implicit-null (3)" },
      ].map((h) => (
        <DNode key={h.n} x={h.x} y={50} label={h.n} sub={h.s} accent={h.n.startsWith("PE") ? D.warning : D.violet} w={120} />
      ))}
      <DArrow x1={510} y1={86} x2={470} y2={86} color={D.mpls} />
      <DArrow x1={350} y1={86} x2={310} y2={86} color={D.mpls} />
      <DArrow x1={190} y1={86} x2={150} y2={86} color={D.mpls} />
      <text x={320} y={106} textAnchor="middle" fill={D.mpls} fontSize={9} fontFamily="monospace">
        ← label mappings advertised upstream (for FEC {LOOP.PE2}/32)
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Traffic toward PE2 flows left to right using these labels.
      </text>
    </DiagramSvg>
  );
}

function LibDiagram() {
  return (
    <DiagramSvg h={150} label="LIB holds every label binding received from every LDP neighbor; the LFIB holds only the bindings from the IGP's next hop, used for forwarding">
      <DTable
        x={40}
        y={8}
        title={`P1 for FEC ${LOOP.PE2}/32`}
        cols={[
          { label: "TABLE", w: 120 },
          { label: "CONTENTS", w: 440 },
        ]}
        rows={[
          ["LIB", `local ${LDP_LABEL.toPE2.P1} · from P2 ${LDP_LABEL.toPE2.P2} · from PE1 (its binding)`],
          ["LFIB", `in ${LDP_LABEL.toPE2.P1} → swap ${LDP_LABEL.toPE2.P2} → P2 (the IGP next hop)`],
        ]}
      />
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        LIB = all bindings learned (liberal retention). LFIB = the ones that match the IGP best path.
      </text>
    </DiagramSvg>
  );
}

function ShimDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={120} label="MPLS label header: 20-bit label, 3-bit traffic class, 1-bit bottom-of-stack flag, 8-bit TTL">
      <DFieldRow x={60} y={14} fields={[f("Label", "20 bits", 260, D.mpls, true), f("TC", "3", 70, D.violet), f("S", "1", 60, D.warning, true), f("TTL", "8 bits", 130, D.ip)]} />
      <text x={320} y={96} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16004 · TC 0 · S 0 · TTL 255 = 0x03E840FF. Labels 0–15 are reserved (3 = implicit-null).
      </text>
    </DiagramSvg>
  );
}

function VrfDiagram() {
  return (
    <DiagramSvg h={150} label="Two customers can use the same prefix 10.50.2.0/24 in different VRFs; RDs keep their VPNv4 routes distinct">
      <DNode x={320} y={40} label="PE" sub="one router, many VRFs" accent={D.warning} w={170} />
      <DPill x={170} y={105} text="VRF CUST-A: 10.50.2.0/24" color={D.success} w={200} />
      <DPill x={470} y={105} text="VRF CUST-B: 10.50.2.0/24" color={D.cyan} w={200} />
      <DArrow x1={290} y1={62} x2={200} y2={92} color={D.muted} width={1.2} />
      <DArrow x1={350} y1={62} x2={440} y2={92} color={D.muted} width={1.2} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Same prefix, separate tables; in BGP they become 65000:2:10.50.2.0/24 and 65000:7:10.50.2.0/24.
      </text>
    </DiagramSvg>
  );
}

function RdRtDiagram() {
  return (
    <DiagramSvg h={150} label="RD versus RT: where each lives and what it controls">
      <DTable
        x={40}
        y={8}
        title="RD vs RT"
        cols={[
          { label: "", w: 140 },
          { label: "ROUTE DISTINGUISHER", w: 210 },
          { label: "ROUTE TARGET", w: 210 },
        ]}
        rows={[
          ["Lives in", "the NLRI (prefix)", "extended communities"],
          ["Controls", "uniqueness only", "import / export"],
          ["Must match remote?", "no (usually differs)", "import must match export"],
          ["Used for forwarding?", "no", "no"],
        ]}
      />
    </DiagramSvg>
  );
}

function Vpnv4Diagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={130} label="A labeled VPNv4 NLRI: length, 3-byte label field, 8-byte RD, then the IPv4 prefix">
      <DFieldRow x={40} y={14} fields={[f("Length", "bits", 80, D.faint), f("Label", `${VPN_LABEL.PE2} (3 B)`, 130, D.violet, true), f("RD", "65000:2 (8 B)", 150, D.warning, true), f("IPv4 prefix", "10.50.2.0/24", 200, D.ip)]} />
      <text x={320} y={96} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        AFI 1 / SAFI 128 in MP_REACH_NLRI; RTs travel separately as extended communities.
      </text>
    </DiagramSvg>
  );
}

function NhDiagram() {
  return (
    <DiagramSvg h={130} label="Next-hop resolution: the VRF route's BGP next hop 10.0.0.4 is resolved through the LDP LSP, which supplies the transport label">
      <DPill x={120} y={40} text="VRF: 10.50.2.0/24 NH 10.0.0.4" color={D.success} w={220} />
      <DArrow x1={232} y1={40} x2={318} y2={40} color={D.muted} />
      <DPill x={440} y={40} text={`LSP to 10.0.0.4: push ${LDP_LABEL.toPE2.P1}`} color={D.mpls} w={230} />
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        No resolvable LSP to the next hop → the VPN route stays inactive even if imported.
      </text>
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        (Juniper-style inet.3 / Cisco-style LFIB lookup of the next hop.)
      </text>
    </DiagramSvg>
  );
}

function PhpDiagram() {
  return (
    <DiagramSvg h={150} label="Penultimate-hop popping: with implicit-null the second-to-last router pops the transport label so the egress PE does a single lookup">
      <DTable
        x={40}
        y={8}
        title="Arriving at PE2"
        cols={[
          { label: "MODE", w: 200 },
          { label: "STACK AT PE2", w: 200 },
          { label: "PE2 LOOKUPS", w: 160 },
        ]}
        rows={[
          ["PHP (implicit-null, 3)", `${VPN_LABEL.PE2}`, "VPN label only"],
          ["Explicit-null (0)", `0 / ${VPN_LABEL.PE2}`, "pop 0, then VPN"],
          ["No PHP", `transport / ${VPN_LABEL.PE2}`, "transport, then VPN"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
    </DiagramSvg>
  );
}

function PeDiagram() {
  return (
    <DiagramSvg h={140} label="PE service lookup versus P-router label switching">
      <DTable
        x={40}
        y={8}
        title="Who looks at what"
        cols={[
          { label: "ROUTER", w: 120 },
          { label: "LOOKS AT", w: 230 },
          { label: "STATE HELD", w: 210 },
        ]}
        rows={[
          ["PE (ingress)", "customer IP in the VRF", "VRFs, VPNv4, LDP"],
          ["P", "top label only", "IGP + LDP"],
          ["PE (egress)", "VPN label → VRF → IP", "VRFs, VPNv4, LDP"],
        ]}
      />
    </DiagramSvg>
  );
}

export function MpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="mpd-underlay" eyebrow="Plane 1" title="The IP underlay" tone="cyan">
        <DiagramFrame caption="Loopbacks first.">
          <UnderlayDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-ldp" eyebrow="Plane 2" title="The LDP transport LSP" tone="violet">
        <DiagramFrame caption="Bindings go upstream; traffic goes downstream.">
          <LdpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-lib" eyebrow="Plane 2" title="LIB vs LFIB" tone="violet">
        <DiagramFrame caption="What is known vs what is used.">
          <LibDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-shim" eyebrow="Data plane" title="The label header" tone="ip">
        <DiagramFrame caption="Four bytes per label.">
          <ShimDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-vrf" eyebrow="Plane 4" title="VRFs" tone="success">
        <DiagramFrame caption="Separate tables let customers overlap.">
          <VrfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-rdrt" eyebrow="Plane 3" title="Route Distinguisher and Route Target" tone="warning">
        <DiagramFrame caption="Uniqueness vs policy.">
          <RdRtDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-vpnv4" eyebrow="Plane 3" title="MP-BGP VPNv4 routes" tone="warning">
        <DiagramFrame caption="The VPN label is signaled by BGP, not LDP.">
          <Vpnv4Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-nh" eyebrow="Plane 3 → 2" title="Next-hop resolution" tone="violet">
        <DiagramFrame caption="Where the VPN plane meets the transport plane.">
          <NhDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-php" eyebrow="Data plane" title="Penultimate-hop popping" tone="ip">
        <DiagramFrame caption="Implicit-null saves the egress PE a lookup.">
          <PhpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpd-pe" eyebrow="Roles" title="P-router vs PE behavior" tone="cyan">
        <DiagramFrame caption="Customer state lives only at the edge.">
          <PeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Transport problem", tone: "danger", tag: "planes 1–2", points: ["LSP ping fails", "missing LDP binding / IGP route", "affects every VPN on that PE pair"] },
            { title: "VPN problem", tone: "warning", tag: "planes 3–4", points: ["LSP ping works", "route missing / not imported", "often one customer only"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="mpd-planes" eyebrow="Workflow" title="Troubleshooting by plane" tone="cyan">
        <DiagramFrame caption="Find the first plane that fails, and fix only that one.">
          <DiagramSvg h={150} label="Plane-by-plane ladder">
            <LadderDiagram
              rows={[
                { rung: "Underlay", evidence: "loopback routes in the IGP", status: "ok" },
                { rung: "Transport", evidence: "LDP sessions, labels, LSP ping", status: "ok" },
                { rung: "VPN control plane", evidence: "MP-BGP up? route received? RT? label?", status: "suspect" },
                { rung: "VRF", evidence: "imported? next hop resolved?", status: "suspect" },
                { rung: "Data plane", evidence: "label stack on the wire; delivered?", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Transport", body: "Can PE1 label-switch to PE2's loopback?", tone: "cyan" },
            { title: "Signaling", body: "Is the VPN route received — with which RT and label?", tone: "warning" },
            { title: "Import", body: "Is it in the VRF? Does the next hop resolve?", tone: "violet" },
            { title: "Forwarding", body: "Does the right label stack leave the ingress PE?", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="mpd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "FEC", def: "Forwarding Equivalence Class — here, a PE loopback /32." },
            { term: "LIB / LFIB", def: "Label Information Base (all bindings) / Label Forwarding Information Base (used bindings)." },
            { term: "Implicit-null", def: "Label 3, advertised to request penultimate-hop popping." },
            { term: "SAFI 128", def: "BGP subsequent address family for MPLS-labeled VPN routes." },
            { term: "LSP ping", def: "An MPLS echo that tests a specific label-switched path." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
