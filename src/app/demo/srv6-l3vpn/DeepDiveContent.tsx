import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6L_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-compare", label: "MPLS L3VPN vs SRv6 L3VPN" },
  { id: "vd-bgp", label: "BGP signaling (RFC 9252)" },
  { id: "vd-attr", label: "Inside the Prefix-SID attribute" },
  { id: "vd-transposition", label: "SID transposition" },
  { id: "vd-resolution", label: "Two resolutions per route" },
  { id: "vd-alloc", label: "Service SID allocation" },
  { id: "vd-encap", label: "Encapsulation choices" },
  { id: "vd-evpn", label: "Beyond L3VPN" },
  { id: "vd-design", label: "Design notes" },
  { id: "vd-trouble", label: "Troubleshooting" },
  { id: "vd-verify", label: "Verification" },
  { id: "vd-glossary", label: "Glossary" },
  { id: "vd-mental", label: "Mental model" },
];

function CompareDiagram() {
  return (
    <DiagramSvg h={190} label="MPLS L3VPN: transport label over VPN label over customer IP. SRv6 L3VPN: outer IPv6 whose DA is the Service SID over customer IP">
      <text x={170} y={20} textAnchor="middle" fill={D.mpls} fontSize={11.5} fontWeight={700}>
        MPLS L3VPN
      </text>
      <DStack x={170} y={34} labels={[{ text: "transport label", tag: "LSP" }, { text: "VPN label", color: D.warning, tag: "service" }]} payload="customer IP" w={150} />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={11.5} fontWeight={700}>
        SRv6 L3VPN
      </text>
      <DHeaderColumn
        x={470}
        y={34}
        w={200}
        rows={[
          { text: "outer IPv6 · DA = Service SID", color: D.warning, tag: "service", strong: true },
          { text: "customer IP", color: D.ip },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        VRF, RD, RT and MP-BGP VPN routes stay the same;
      </text>
      <text x={320} y={166} textAnchor="middle" fill={D.muted} fontSize={10}>
        the Service SID is both the transport destination and the egress instruction
      </text>
    </DiagramSvg>
  );
}

function AttrDiagram() {
  const box = (y: number, x: number, w: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={y} width={w} height={38} rx={8} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 12} y={y + 16} fill={c} fontSize={10.5} fontWeight={700}>
        {t}
      </text>
      <text x={x + 12} y={y + 30} fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={210} label="BGP Prefix-SID attribute contains the SRv6 L3 Service TLV type 5, which contains the SRv6 SID Information sub-TLV with the SID and endpoint behavior, which may contain the SID Structure sub-sub-TLV">
      {box(12, 40, 560, "BGP Prefix-SID attribute", "path attribute attached to the VPN route", D.bgp)}
      {box(60, 80, 520, "SRv6 L3 Service TLV (type 5)", "type 6 is the L2 Service TLV, used by EVPN", D.warning)}
      {box(108, 120, 480, "SRv6 SID Information sub-TLV", "the SID value + its endpoint behavior (e.g. End.DT4)", D.violet)}
      {box(156, 160, 440, "SRv6 SID Structure sub-sub-TLV", "block / node / function / argument lengths, transposition", D.cyan)}
    </DiagramSvg>
  );
}

function TranspositionDiagram() {
  return (
    <DiagramSvg h={160} label="With transposition, the function bits of the SID are carried in the MPLS label field of the NLRI and the rest of the SID in the TLV, so routes with different functions can share one attribute">
      <DHeaderColumn x={170} y={30} w={230} rows={[{ text: "locator  |  function  |  0", color: D.warning }]} caption="full SID" />
      <DArrow x1={290} y1={40} x2={334} y2={40} color={D.faint} width={1.4} label="transpose" />
      <DHeaderColumn
        x={490}
        y={30}
        w={230}
        rows={[
          { text: "TLV: locator | 0 | 0", color: D.violet, tag: "attr" },
          { text: "NLRI label field: function", color: D.mpls, tag: "NLRI" },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        saves update space; the receiver reassembles the full SID — this lesson keeps it off
      </text>
    </DiagramSvg>
  );
}

function ResolutionDiagram() {
  return (
    <DiagramSvg h={170} label="A received VPN route needs its BGP next hop resolved through the underlay and its Service SID resolved through the remote locator route; both must succeed">
      <DNode x={320} y={30} label="received VPN route" sub="RT matched" accent={D.bgp} w={200} />
      <DArrow x1={260} y1={52} x2={170} y2={84} color={D.faint} width={1.4} />
      <DArrow x1={380} y1={52} x2={470} y2={84} color={D.faint} width={1.4} />
      <DNode x={160} y={108} label="BGP next hop" sub="→ infra loopback route" accent={D.ospf} w={200} />
      <DNode x={480} y={108} label="Service SID" sub="→ remote locator route" accent={D.warning} w={200} />
      <DPill x={320} y={154} text="both required to install" color={D.success} w={180} />
    </DiagramSvg>
  );
}

function EncapChoicesDiagram() {
  const cols = [
    { x: 110, h: "shortest path", rows: [{ text: "DA = Service SID", color: D.warning, strong: true }, { text: "no SRH", color: D.faint }, { text: "customer packet", color: D.ip }] },
    { x: 320, h: "SR Policy steered", rows: [{ text: "DA = transport SID", color: D.warning, strong: true }, { text: "SRH … [0] Service SID", color: D.violet }, { text: "customer packet", color: D.ip }] },
    { x: 530, h: "reduced (Red)", rows: [{ text: "DA = first SID", color: D.warning, strong: true }, { text: "SRH without first SID", color: D.violet }, { text: "customer packet", color: D.ip }] },
  ];
  return (
    <DiagramSvg h={140} label="Shortest path: DA is the Service SID with no SRH. Policy-steered: DA is a transport SID and the SRH ends with the Service SID. Reduced mode omits the first SID from the SRH">
      {cols.map((c) => (
        <g key={c.h}>
          <text x={c.x} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {c.h}
          </text>
          <DHeaderColumn x={c.x} y={30} w={180} rows={c.rows} />
        </g>
      ))}
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        in every case the Service SID is the final segment
      </text>
    </DiagramSvg>
  );
}

export function Srv6L3vpnDeepDiveContent() {
  return (
    <>
      <GuideSection id="vd-compare" eyebrow="Architecture" title="MPLS L3VPN vs SRv6 L3VPN" tone="ip">
        <DiagramFrame caption="The service model is unchanged; the egress instruction moves into the IPv6 DA.">
          <CompareDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-bgp" eyebrow="Control plane" title="BGP signaling (RFC 9252)" tone="bgp">
        <FieldTable
          title="What an SRv6 VPN route carries"
          accent="bgp"
          columns={["Field", "Purpose"]}
          rows={[
            ["AFI/SAFI", "VPN-IPv4 or VPN-IPv6 (IPv4 VPN routes can use an IPv6 next hop, RFC 8950)"],
            ["NLRI (RD:prefix)", "A globally unique VPN prefix"],
            ["Route Target", "Which VRFs import it"],
            ["NEXT_HOP", "The egress PE's BGP address"],
            ["Prefix-SID attribute", "The Service SID and its behavior"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-attr" eyebrow="Control plane" title="Inside the Prefix-SID attribute" tone="warning">
        <DiagramFrame caption="Nested TLVs; the same attribute family carries L2 services for EVPN.">
          <AttrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-transposition" eyebrow="Control plane" title="SID transposition" tone="mpls">
        <DiagramFrame caption="An optimization, not a return to MPLS labels on the wire.">
          <TranspositionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-resolution" eyebrow="Control plane" title="Two resolutions per route" tone="ospf">
        <DiagramFrame caption="Route received ≠ route usable.">
          <ResolutionDiagram />
        </DiagramFrame>
        <p>
          The next hop and the Service SID usually sit in different prefixes: a loopback and a locator. Each can fail independently, and each must be checked on its own.
        </p>
      </GuideSection>

      <GuideSection id="vd-alloc" eyebrow="Design" title="Service SID allocation" tone="violet">
        <FieldTable
          title="Common allocation modes"
          accent="violet"
          columns={["Mode", "Behavior", "Trade-off"]}
          rows={[
            ["Per-VRF, per family", <Mono key="1">End.DT4 / End.DT6</Mono>, "Few SIDs; egress lookup needed"],
            ["Per-VRF, dual stack", <Mono key="2">End.DT46</Mono>, "One SID for both families"],
            ["Per-CE", <Mono key="3">End.DX4 / End.DX6</Mono>, "No egress lookup; one SID per CE"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-encap" eyebrow="Data plane" title="Encapsulation choices" tone="ip">
        <DiagramFrame caption="The ingress PE picks the transport; the Service SID stays last.">
          <EncapChoicesDiagram />
        </DiagramFrame>
        <p>
          With colored VPN routes, the ingress PE can steer a route into an SRv6 Policy ⟨PE, color, egress PE⟩ and append the Service SID after the policy&apos;s transport segments.
        </p>
      </GuideSection>

      <GuideSection id="vd-evpn" eyebrow="Beyond" title="Beyond L3VPN" tone="cyan">
        <CompareCards
          items={[
            { title: "L3 services", tone: "ip", tag: "L3 Service TLV", points: ["IPv4 / IPv6 VPN", "Global IPv4 / IPv6 over SRv6"] },
            { title: "L2 services", tone: "ethernet", tag: "L2 Service TLV", points: ["EVPN over SRv6", "End.DX2 / End.DT2U / End.DT2M"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-design" eyebrow="Design" title="Design notes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Things to plan for"
          mark="!"
          items={[
            "Locators must be reachable from every ingress PE; summarizing them across areas saves FIB space but can hide the loss of one PE's locator.",
            "Keep the SID block filtered at the SR domain edge.",
            "Choose per-VRF or per-CE allocation deliberately — it changes egress behavior.",
            "Keep the BGP next hop and the locator in the same failure domain you expect to track.",
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Layer by layer"
          mark="→"
          items={[
            "MP-BGP session established and the route received?",
            "RT import into the right VRF?",
            "BGP next hop resolvable?",
            "Service SID resolvable through a locator route?",
            "Egress PE has the SID in its Local SID Table with the right behavior and table?",
            "Egress VRF holds the customer route?",
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="What to check (vendor-neutral)" mark="✓" items={["VPN route detail: RD, RT, next hop, Service SID and behavior.", "Ingress VRF FIB entry pointing at the Service SID.", "Remote locator present in the global IPv6 FIB.", "A real customer packet delivered end to end."]} />
      </GuideSection>

      <GuideSection id="vd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RFC 9252", def: "BGP overlay services over SRv6 (L3VPN, EVPN)." },
            { term: "L3 Service TLV", def: "Type 5 TLV of the Prefix-SID attribute for L3 services." },
            { term: "L2 Service TLV", def: "Type 6 TLV for L2 services such as EVPN." },
            { term: "Transposition", def: "Carrying part of the SID in the NLRI label field." },
            { term: "End.DT46", def: "Per-VRF dual-stack decapsulation and lookup." },
            { term: "RFC 8950", def: "Advertising IPv4 NLRI with an IPv6 next hop." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          BGP still says which prefixes a VRF can reach; the Service SID says what the egress PE must do — and a route is usable only when both its next hop and its Service SID resolve.
        </Callout>
      </GuideSection>
    </>
  );
}
