import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const L3VPN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-arch", label: "The L3VPN architecture" },
  { id: "vd-nlri", label: "VPNv4 NLRI encoding" },
  { id: "vd-rd", label: "RD formats" },
  { id: "vd-rt", label: "RT topologies" },
  { id: "vd-label", label: "VPN label allocation" },
  { id: "vd-nh", label: "Next-hop resolution" },
  { id: "vd-scale", label: "Scaling the control plane" },
  { id: "vd-mtu", label: "MTU and the stack" },
  { id: "vd-trouble", label: "Troubleshooting ladder" },
  { id: "vd-glossary", label: "Glossary" },
  { id: "vd-model", label: "Mental model" },
];

const VPN = D.violet;

function ArchDiagram() {
  return (
    <DiagramSvg h={210} label="CE routers peer with PEs using PE-CE routing; PEs exchange VPNv4 routes over MP-BGP; P routers run only the IGP and LDP">
      <DNode x={60} y={150} label="CE" sub="site 1" accent={D.ip} w={80} />
      <DNode x={200} y={150} label="PE" sub="VRFs" accent={D.mpls} w={80} />
      <DNode x={320} y={150} label="P" sub="IGP + LDP" accent={D.mpls} w={80} />
      <DNode x={440} y={150} label="PE" sub="VRFs" accent={D.mpls} w={80} />
      <DNode x={580} y={150} label="CE" sub="site 2" accent={D.ip} w={80} />
      <DLink x1={100} y1={150} x2={160} y2={150} color={D.ip} label="PE-CE" labelDy={-10} />
      <DLink x1={240} y1={150} x2={280} y2={150} color={D.mpls} />
      <DLink x1={360} y1={150} x2={400} y2={150} color={D.mpls} />
      <DLink x1={480} y1={150} x2={540} y2={150} color={D.ip} label="PE-CE" labelDy={-10} />
      <DArrow x1={200} y1={60} x2={440} y2={60} color={D.bgp} both label="MP-BGP VPNv4 (often via route reflectors)" />
      <line x1={200} y1={66} x2={200} y2={126} stroke={D.bgp} strokeDasharray="3 4" />
      <line x1={440} y1={66} x2={440} y2={126} stroke={D.bgp} strokeDasharray="3 4" />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        customer routes exist only on CEs and in PE VRFs, never on P routers
      </text>
    </DiagramSvg>
  );
}

function NlriDiagram() {
  const cells: [string, number, string][] = [
    ["Length", 50, D.faint],
    ["Label (3 B)", 110, D.mpls],
    ["RD (8 B)", 190, D.bgp],
    ["IPv4 prefix (≤4 B)", 180, D.ip],
  ];
  let x = 50;
  return (
    <DiagramSvg h={110} label="VPNv4 NLRI: length, 3-byte label field, 8-byte route distinguisher, IPv4 prefix">
      {cells.map(([name, w, c]) => {
        const g = (
          <g key={name}>
            <rect x={x} y={30} width={w} height={36} fill={c} fillOpacity={0.15} stroke={c} />
            <text x={x + w / 2} y={53} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
              {name}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={94} textAnchor="middle" fill={D.muted} fontSize={10}>
        AFI 1 / SAFI 128 · RD + prefix form the 12-byte VPN-IPv4 address · RTs ride as extended communities
      </text>
    </DiagramSvg>
  );
}

function HubSpokeDiagram() {
  return (
    <DiagramSvg h={210} label="Hub exports RT hub and imports RT spoke; spokes export RT spoke and import RT hub, so spokes only learn the hub's routes">
      <DNode x={320} y={50} label="Hub PE" sub="exp HUB · imp SPOKE" accent={VPN} w={170} />
      <DNode x={140} y={165} label="Spoke A" sub="exp SPOKE · imp HUB" accent={D.warning} w={170} />
      <DNode x={500} y={165} label="Spoke B" sub="exp SPOKE · imp HUB" accent={D.warning} w={170} />
      <DArrow x1={260} y1={74} x2={170} y2={140} color={VPN} both />
      <DArrow x1={380} y1={74} x2={470} y2={140} color={VPN} both />
      <DLink x1={228} y1={165} x2={412} y2={165} color={D.danger} dashed label="no direct import" labelDy={-8} />
    </DiagramSvg>
  );
}

function AllocationDiagram() {
  return (
    <DiagramSvg h={170} label="Per-prefix gives each route its own label; per-CE one label per attached CE; per-VRF one label for the whole VRF">
      {[
        [110, "per-prefix", ["10.2.2.0/24 → 24002", "10.2.3.0/24 → 24003", "10.2.4.0/24 → 24004"], D.mpls],
        [320, "per-CE", ["CE2 routes → 24002", "CE3 routes → 24010", ""], D.warning],
        [530, "per-VRF", ["all CUST-A → 24002", "(egress IP lookup", " in the VRF)"], VPN],
      ].map(([x, title, rows, c]) => (
        <g key={title as string}>
          <DPill x={x as number} y={24} text={title as string} color={c as string} w={120} />
          <rect x={(x as number) - 95} y={46} width={190} height={84} rx={10} fill={c as string} fillOpacity={0.06} stroke={c as string} strokeOpacity={0.5} />
          {(rows as string[]).map((r, i) => (
            <text key={i} x={(x as number) - 82} y={72 + i * 20} fill={D.text} fontSize={9.5} fontFamily="monospace">
              {r}
            </text>
          ))}
        </g>
      ))}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        hypothetical labels · fewer labels means more work (a lookup) at the egress PE
      </text>
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  return (
    <DiagramSvg h={170} label="The VPN route's next hop 4.4.4.4 must resolve to an LSP; the transport label comes from that LSP">
      <DPill x={150} y={30} text="VRF route 10.2.2.0/24" color={VPN} w={180} />
      <DArrow x1={240} y1={30} x2={330} y2={30} color={D.faint} />
      <DPill x={420} y={30} text="NH 4.4.4.4 · VPN label" color={D.bgp} w={180} />
      <DArrow x1={420} y1={44} x2={420} y2={82} color={D.faint} />
      <DPill x={420} y={96} text="LSP to 4.4.4.4 · transport label" color={D.mpls} w={230} />
      <DStack x={150} y={78} labels={[{ text: "transport S0", tag: "OUTER" }, { text: "VPN S1", tag: "INNER", color: VPN }]} w={100} />
      <text x={320} y={158} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        no labeled path to the next hop ⇒ the VPN route can&apos;t be used (or traffic is blackholed)
      </text>
    </DiagramSvg>
  );
}

export function L3vpnDeepDiveContent() {
  return (
    <>
      <GuideSection id="vd-arch" eyebrow="Background" title="The L3VPN architecture" tone="violet">
        <p>
          BGP/MPLS IP VPNs (RFC 4364) split the problem into three roles: CEs speak plain IP routing to their PE, PEs keep one VRF per customer and exchange VPN routes with MP-BGP, and P routers only switch labels.
        </p>
        <DiagramFrame caption="The PE is where customer state lives; the core stays customer-agnostic.">
          <ArchDiagram />
        </DiagramFrame>
        <p>
          PE-CE routing can be static, eBGP, OSPF, IS-IS or RIP. Whatever it is, the PE redistributes those routes into MP-BGP for the VRF.
        </p>
      </GuideSection>

      <GuideSection id="vd-nlri" eyebrow="Encoding" title="VPNv4 NLRI encoding" tone="bgp">
        <DiagramFrame caption="The VPN label travels inside the NLRI itself; the RT travels beside it as an attribute.">
          <NlriDiagram />
        </DiagramFrame>
        <p>
          Because the RD is part of the address, <Mono>65001:101:10.1.1.0/24</Mono> and <Mono>65001:201:10.1.1.0/24</Mono> are simply different routes to BGP. Best-path selection runs per VPNv4 route.
        </p>
      </GuideSection>

      <GuideSection id="vd-rd" eyebrow="Encoding" title="Route Distinguisher formats" tone="bgp">
        <FieldTable
          title="8-byte RD = 2-byte type + 6-byte value"
          accent="bgp"
          columns={["Type", "Administrator", "Assigned number", "Example"]}
          rows={[
            ["0", "2-byte ASN", "4 bytes", <Mono key="a">65001:101</Mono>],
            ["1", "IPv4 address", "2 bytes", <Mono key="b">1.1.1.1:101</Mono>],
            ["2", "4-byte ASN", "2 bytes", <Mono key="c">4200000001:7</Mono>],
          ]}
        />
        <Callout tone="cyan" title="Unique RD per PE is a common design" icon="i">
          This lesson uses a different RD on PE1 and PE2 for CUST-A. With route reflectors, per-PE RDs let the RR keep both paths of a multihomed site instead of picking just one.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-rt" eyebrow="Policy" title="Route Target topologies" tone="violet">
        <p>
          RTs are just import/export sets, so they can build more than any-to-any meshes. A VRF can import several RTs (extranets, shared services) and export several.
        </p>
        <DiagramFrame caption="Hub-and-spoke: spokes reach each other only through the hub.">
          <HubSpokeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Full mesh", tone: "violet", tag: "any-to-any", points: ["Every site exports and imports the same RT", "The model used in this lesson"] },
            { title: "Extranet / shared services", tone: "warning", tag: "selective", points: ["A VRF also imports a service RT", "Only the chosen prefixes are exported to it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-label" eyebrow="Labels" title="VPN label allocation modes" tone="mpls">
        <DiagramFrame caption="The trade-off is label count vs work at the egress PE.">
          <AllocationDiagram />
        </DiagramFrame>
        <p>
          Whatever the mode, the VPN label is <b className="text-pv-text">locally significant to the egress PE</b>: only PE2 interprets <Mono>24002</Mono>. PE1 copies it into the stack; P routers never read it.
        </p>
      </GuideSection>

      <GuideSection id="vd-nh" eyebrow="Recursion" title="Next-hop resolution" tone="mpls">
        <DiagramFrame caption="Two lookups at the ingress PE produce the two labels.">
          <NextHopDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "VRF lookup", body: "Destination → VPN route → BGP next hop + VPN label.", tone: "violet" },
            { title: "Recursive lookup", body: "BGP next hop → IGP route + LDP (or RSVP-TE / SR) LSP → transport label.", tone: "mpls" },
            { title: "Impose", body: "Push the VPN label first (bottom, S=1), then the transport label on top (S=0).", tone: "success" },
          ]}
        />
        <Callout tone="warning" title="Next-hop-self matters" icon="!">
          The next hop must be the PE&apos;s loopback, the address the LSP is built to. A next hop that resolves over plain IP (no label) breaks VPN forwarding even though BGP looks fine.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-scale" eyebrow="Scale" title="Scaling the control plane" tone="bgp">
        <ChecklistCard
          tone="bgp"
          mark="↗"
          title="How providers keep VPNv4 manageable"
          items={[
            "Route reflectors instead of a PE full mesh (see the RR lesson).",
            "RT filtering: a PE drops VPN routes no local VRF imports.",
            "RT Constraint (RTC) tells the RR which RTs a PE wants, so unwanted routes are never sent.",
            "P routers stay BGP-free and customer-free.",
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mtu" eyebrow="Operations" title="MTU and the label stack" tone="warning">
        <p>
          Each label adds 4 bytes: this lesson&apos;s two-label stack adds 8. Add a third (for example a TE or FRR bypass label) and it&apos;s 12. Core links need an MPLS MTU large enough for the customer&apos;s packet plus the deepest stack, or large packets get dropped or fragmented.
        </p>
      </GuideSection>

      <GuideSection id="vd-trouble" eyebrow="Operations" title="Troubleshooting ladder" tone="danger">
        <FieldTable
          title="Bottom-up: stop at the first failing layer"
          accent="danger"
          columns={["Layer", "Question", "Typical command idea"]}
          rows={[
            ["IGP", "Is the remote PE loopback reachable?", "show ip route 4.4.4.4"],
            ["Transport", "Is there a labeled path to it?", "show mpls forwarding-table"],
            ["MP-BGP", "Is the VPNv4 session Established?", "show bgp vpnv4 unicast summary"],
            ["Received", "Is the VPNv4 route in the BGP table?", "show bgp vpnv4 unicast all"],
            ["Policy", "Does its RT match the VRF import RT?", "show vrf detail"],
            ["VRF", "Is the route installed in the VRF?", "show ip route vrf CUST-A"],
            ["Data plane", "Does the labeled packet reach the right VRF?", "ping vrf / traceroute vrf"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "AFI/SAFI 1/128", def: "The MP-BGP address family for VPNv4 unicast." },
            { term: "Extended community", def: "8-byte BGP attribute; RTs are one kind." },
            { term: "Per-VRF label", def: "One VPN label for the whole VRF; the egress does an IP lookup." },
            { term: "RTC", def: "Route Target Constraint: peers advertise which RTs they want." },
            { term: "Extranet", def: "Selective route sharing between VRFs using extra RTs." },
            { term: "PE-CE protocol", def: "The routing between customer and provider edge (static, eBGP, OSPF…)." },
            { term: "Next-hop-self", def: "The PE sets its own loopback as the VPN route's next hop." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-model" eyebrow="Recap" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-mpls/5 p-5 text-sm leading-relaxed text-pv-text">
          An L3VPN is two cooperating systems. The service layer (VRF, RD, RT, MP-BGP, VPN label) decides which customer and which egress PE. The transport layer (IGP, LDP or TE, transport label) gets the packet to that PE. The label stack is literally those two layers stacked: transport outside, service inside, S=1 only on the service label.
        </div>
      </GuideSection>
    </>
  );
}
