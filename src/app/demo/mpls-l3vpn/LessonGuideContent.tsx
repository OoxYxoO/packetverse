import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createL3Net, l3Apply, l3Ticket, l3TicketState, type L3Ce, type L3Os, type L3R, type L3State } from "@/lib/sim-engine/scenarios/l3Net";
import { l3Sets, l3StaticApi } from "./l3-lab/l3Cli";

export const L3VPN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lv-mission", label: "What this lesson teaches" },
  { id: "lv-network", label: "The network of this lesson" },
  { id: "lv-ideas", label: "Three ideas you need" },
  { id: "lv-watch", label: "What you will watch" },
  { id: "lv-vrf", label: "A table per customer" },
  { id: "lv-rdrt", label: "RD and RT" },
  { id: "lv-route", label: "Anatomy of a VPNv4 route" },
  { id: "lv-control", label: "The route, step by step" },
  { id: "lv-stack", label: "The two-label stack" },
  { id: "lv-roles", label: "Who reads which label" },
  { id: "lv-planes", label: "Control plane, data plane" },
  { id: "lv-working", label: "What working looks like" },
  { id: "lv-incident", label: "The incident" },
  { id: "lv-investigate", label: "Walk the evidence" },
  { id: "lv-fix", label: "Repair and prove it" },
  { id: "lv-other", label: "Other ways an L3VPN fails" },
  { id: "lv-model", label: "Mental model" },
  { id: "lv-glossary", label: "Glossary" },
  { id: "lv-recap", label: "Recap" },
  { id: "lv-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the L3VPN Lab's model and its IOS XR / Junos command sets:
 * the healthy network and the lab's "rt" ticket — the guided lesson's incident (PE1's CUST-A imports 65001:999).
 */
export const L3_HEALTHY: L3State = createL3Net(0);
export const L3_HEALTHY_JN: L3State = createL3Net(0, "junos");
const ping = (s: L3State, from: L3Ce, dst: string) => l3Apply(s, { type: "test", from, dst });
const fault = (os: L3Os) => l3Ticket("rt").repro.reduce((acc, a) => l3Apply(acc, a), l3TicketState("rt", 0, os));
const L3_FAULT = fault("xr");
const L3_FAULT_JN = fault("junos");
const L3_FIXED = ping(l3Apply(L3_FAULT, { type: "set", text: "PE1: VRF CUST-A import route-target 65001:100", changes: [{ dev: "PE1", f: (c) => void (c.vrfs["CUST-A"].imp = ["65001:100"]) }] }), "CE1A", "10.2.2.20");
const OK_A = ping(L3_HEALTHY, "CE1A", "10.2.2.20");
const OK_B = ping(L3_HEALTHY, "CE1B", "10.2.2.20");
export function l3Cli(s: L3State, r: L3R, vendor: CliVendor, command: string) {
  return runGuideCli(l3Sets(l3StaticApi(s, r), r)[vendor], command);
}
export function l3Only(s: L3State, r: L3R, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = l3Cli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One customer ping, as the lab reports it. */
export function PingResult({ s, title }: { s: L3State; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L3VPN Lab" onPractice={openLab}>
      Two customers with the same addresses on the same four routers, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const VPN = D.violet;

function TopologyDiagram() {
  const n: [string, number, string, string][] = [
    ["CE1", 50, "10.1.1.0/24", D.ip],
    ["PE1", 160, "1.1.1.1", D.mpls],
    ["P1", 268, "2.2.2.2", D.mpls],
    ["P2", 376, "3.3.3.3", D.mpls],
    ["PE2", 484, "4.4.4.4", D.mpls],
    ["CE2", 592, "10.2.2.0/24", D.ip],
  ];
  return (
    <DiagramSvg h={170} label="CE1 behind PE1 and CE2 behind PE2 in VRF CUST-A; P1 and P2 in the core hold no customer routes">
      <DRegion x={108} y={12} w={430} h={98} label="provider core · IS-IS + LDP · no customer routes on P1/P2" color={D.mpls} />
      {n.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 44} y1={66} x2={n[i + 1][1] - 44} y2={66} color={i === 0 || i === 4 ? D.line : D.mpls} />
      ))}
      {n.map(([id, x, sub, c]) => (
        <DNode key={id} x={x} y={66} label={id} sub={sub} accent={c} w={88} />
      ))}
      <DPill x={160} y={130} text="VRF CUST-A" color={VPN} />
      <DPill x={484} y={130} text="VRF CUST-A" color={VPN} />
      <DArrow x1={206} y1={154} x2={438} y2={154} color={D.bgp} both label="MP-BGP VPNv4 session (PE ↔ PE)" labelDy={-6} />
    </DiagramSvg>
  );
}

function VrfDiagram() {
  const table = (x: number, title: string, c: string, rows: string[]) => (
    <g>
      <rect x={x} y={34} width={180} height={112} rx={10} fill={c} fillOpacity={0.07} stroke={c} strokeOpacity={0.6} />
      <text x={x + 90} y={54} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
        {title}
      </text>
      {rows.map((r, i) => (
        <text key={r} x={x + 14} y={78 + i * 18} fill={D.text} fontSize={10} fontFamily="monospace">
          {r}
        </text>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={160} label="PE1 holds three separate tables: global, VRF CUST-A and VRF CUST-B; both VRFs contain 10.1.1.0/24">
      <text x={320} y={20} textAnchor="middle" fill={D.muted} fontSize={10.5} fontWeight={700}>
        inside PE1
      </text>
      {table(20, "Global table", D.ospf, ["1.1.1.1/32", "2.2.2.2/32", "3.3.3.3/32", "4.4.4.4/32"])}
      {table(230, "VRF CUST-A", VPN, ["10.1.1.0/24 (CE1)", "+ remote routes", "  once imported"])}
      {table(440, "VRF CUST-B", D.warning, ["10.1.1.0/24", "(same prefix,", " no conflict)"])}
    </DiagramSvg>
  );
}

function RouteAnatomyDiagram() {
  const cells: [string, string, number, string][] = [
    ["RD", "makes it unique", 110, D.bgp],
    ["IPv4 prefix", "the customer route", 110, D.ip],
    ["Route Target", "import/export policy", 120, VPN],
    ["Next hop", "the originating PE", 110, D.ospf],
    ["VPN label", "chosen by the originating PE", 130, D.mpls],
  ];
  let x = 20;
  return (
    <DiagramSvg h={120} label="A VPNv4 route carries RD, prefix, route target, next hop and VPN label">
      {cells.map(([name, note, w, c]) => {
        const g = (
          <g key={name}>
            <rect x={x} y={24} width={w - 6} height={40} rx={8} fill={c} fillOpacity={0.14} stroke={c} />
            <text x={x + (w - 6) / 2} y={49} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
              {name}
            </text>
            <text x={x + (w - 6) / 2} y={84} textAnchor="middle" fill={D.muted} fontSize={9}>
              {note}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        one MP-BGP VPNv4 UPDATE carries all five
      </text>
    </DiagramSvg>
  );
}

function StackEvolutionDiagram() {
  const t = (s: string, tag: string, c: string = D.mpls) => ({ text: s, tag, color: c });
  const cols: [number, string, { text: string; tag: string; color: string }[]][] = [
    [80, "PE1: PUSH VPN", [t("24002 S1", "VPN", VPN)]],
    [215, "PE1: PUSH transport", [t("102 S0", "OUTER"), t("24002 S1", "INNER", VPN)]],
    [350, "P1: SWAP outer", [t("203 S0", "OUTER"), t("24002 S1", "INNER", VPN)]],
    [485, "P2: PHP (outer only)", [t("24002 S1", "VPN", VPN)]],
    [600, "PE2 → CE2", []],
  ];
  return (
    <DiagramSvg h={170} label="VPN only 24002 S1; then 102 S0 over 24002 S1; then 203 S0 over 24002 S1; then 24002 S1; then plain IP">
      {cols.map(([x, title, labels]) => (
        <g key={title}>
          <text x={x} y={20} textAnchor="middle" fill={D.warning} fontSize={9.5} fontWeight={700}>
            {title}
          </text>
          <DStack x={x} y={34} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        OUTER = transport (swapped hop by hop) · INNER = VPN (untouched until PE2) · S=1 only at the bottom
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={190} label="MP-BGP carries the VPN route between PEs on top; the labeled packet crosses P1 and P2 below">
      <DNode x={100} y={40} label="PE1" sub="imports" accent={D.mpls} />
      <DNode x={540} y={40} label="PE2" sub="originates" accent={D.mpls} />
      <DArrow x1={488} y1={40} x2={152} y2={40} color={D.bgp} label="VPNv4 route + VPN label (control plane)" />
      <DNode x={100} y={140} label="PE1" accent={D.mpls} />
      <DNode x={250} y={140} label="P1" accent={D.mpls} w={80} />
      <DNode x={390} y={140} label="P2" accent={D.mpls} w={80} />
      <DNode x={540} y={140} label="PE2" accent={D.mpls} />
      <DArrow x1={152} y1={140} x2={208} y2={140} color={D.success} />
      <DArrow x1={292} y1={140} x2={348} y2={140} color={D.success} />
      <DArrow x1={432} y1={140} x2={488} y2={140} color={D.success} />
      <text x={320} y={182} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        customer packet with the two-label stack (data plane): P1/P2 never see the VPN route
      </text>
    </DiagramSvg>
  );
}

export function L3vpnLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="lv-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          A provider carries many customers over one core. Customer A has two sites — <Mono>10.1.1.0/24</Mono> behind CE1 and <Mono>10.2.2.0/24</Mono> behind CE2 — and other customers use exactly the same private addresses. The core routers can&apos;t hold every customer&apos;s routes, and the routes must never mix. This lesson builds an <b className="text-pv-text">MPLS Layer 3 VPN</b> for Customer A and shows how the provider keeps it private.
        </p>
        <p>You will watch PE2 turn a customer route into a VPNv4 route, send it to PE1 over MP-BGP, and PE1 import it into the right VRF. Then a packet crosses the core with two labels. Finally someone changes one route target on PE1, Customer A&apos;s sites lose each other while every protocol looks healthy — and you find it, fix it and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why a provider needs a routing table per customer", "tell the route distinguisher's job from the route target's", "read a VPNv4 route field by field", "follow the two-label stack across the core", "explain why the core runs no BGP — and still matters", "find a VPN fault from evidence, fix it and prove it"]}
        />
      </GuideSection>

      <GuideSection id="lv-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="VRFs live only on the PEs. P1 and P2 are the same label switches as in the MPLS lesson.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Router", "Loopback", "Role"]}
          rows={[
            ["PE1", <Mono key="1">1.1.1.1</Mono>, "provider edge for site 1 of each customer; VRFs CUST-A and CUST-B"],
            ["P1, P2", <Mono key="2">2.2.2.2, 3.3.3.3</Mono>, "core: IS-IS and LDP only — no BGP, no VRFs"],
            ["PE2", <Mono key="3">4.4.4.4</Mono>, "provider edge for site 2; VRFs CUST-A, CUST-B (and SHARED in the lab)"],
            ["CE1, CE2", <Mono key="4">10.1.1.0/24, 10.2.2.0/24</Mono>, "Customer A's routers"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same network, with both customers" icon="i">
          The guided lesson follows Customer A (CE1, CE2). In the L3VPN Lab the same routers carry CUST-A (CE1A, CE2A) and CUST-B (CE1B, CE2B) with identical addresses, plus a shared service (CE2S). PE-CE routing is static there; every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Separate tables", tone: "violet", tag: "VRF", points: ["one routing table per customer on each PE", "the interface decides which table"] },
            { title: "One BGP session", tone: "bgp", tag: "MP-BGP", points: ["VPNv4 between the PE loopbacks", "RD keeps routes unique, RT decides import"] },
            { title: "Two labels", tone: "mpls", tag: "data plane", points: ["transport label: get to the PE", "VPN label: which customer there"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "VRFs", body: "Why one table can't hold every customer.", tone: "violet" },
            { title: "RD and RT", body: "Unique routes, chosen imports.", tone: "bgp" },
            { title: "MP-BGP", body: "PE2's route travels to PE1.", tone: "bgp" },
            { title: "Two labels", body: "A packet crosses the core.", tone: "mpls" },
            { title: "The incident", body: "One import RT changes.", tone: "danger" },
            { title: "Repair", body: "Fix it, prove it with a fresh packet.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-vrf" eyebrow="Separation" title="A table per customer" tone="violet">
        <p>
          A <b className="text-pv-text">VRF</b> (VPN routing and forwarding instance) is a separate routing table on the PE. Each customer-facing interface belongs to exactly one VRF, so a packet&apos;s VRF is decided by the port it arrives on. Customer B uses the same <Mono>10.1.1.0/24</Mono> in its own VRF on PE1 — legal, because the two routes live in different tables. The global table, which the core uses, never sees either.
        </p>
        <DiagramFrame caption="Identical prefixes in different VRFs don't conflict, because they live in different tables.">
          <VrfDiagram />
        </DiagramFrame>
        <CliPair cisco={l3Only(L3_HEALTHY, "PE1", "cisco", "show route vrf CUST-A", /^[SBCL] /)} junos={l3Cli(L3_HEALTHY_JN, "PE1", "juniper", "show route table CUST-A.inet.0")} ciscoCaption="IOS XR · PE1 — VRF CUST-A: the local site (static), the remote site (BGP, via 4.4.4.4)" junosCaption="Junos · PE1 — the same VRF table, CUST-A.inet.0" />
      </GuideSection>

      <GuideSection id="lv-rdrt" eyebrow="Two attributes" title="RD and RT: different jobs" tone="bgp">
        <CompareCards
          items={[
            { title: "Route distinguisher (RD)", tone: "bgp", tag: "uniqueness", points: ["put in front of the prefix to form a VPNv4 route", "keeps identical customer prefixes apart in BGP", "says nothing about who imports the route"] },
            { title: "Route target (RT)", tone: "violet", tag: "policy", points: ["extended community attached on export", "compared with each VRF's import list on receive", "a match is what installs the route in a VRF"] },
          ]}
        />
        <FieldTable
          title="VRF configuration in this lesson (and the lab)"
          accent="bgp"
          columns={["VRF", "PE", "RD", "Import / export RT"]}
          rows={[
            ["CUST-A", "PE1", <Mono key="1">65001:101</Mono>, <Mono key="2">65001:100</Mono>],
            ["CUST-A", "PE2", <Mono key="3">65001:102</Mono>, <Mono key="4">65001:100</Mono>],
            ["CUST-B", "PE1", <Mono key="5">65001:201</Mono>, <Mono key="6">65001:200</Mono>],
            ["CUST-B", "PE2", <Mono key="7">65001:202</Mono>, <Mono key="8">65001:200</Mono>],
          ]}
        />
        <CliPanel run={l3Cli(L3_HEALTHY, "PE1", "cisco", "show vrf all")} caption="IOS XR · PE1 — each VRF with its RD and route targets" />
        <Callout tone="warning" title="The classic confusion" icon="!">
          Two PEs can use <i>different</i> RDs for the same customer and still exchange routes, because import is decided by the RT, not the RD. And a route with the right RD but the wrong RT is never installed.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-route" eyebrow="Control plane" title="Anatomy of a VPNv4 route" tone="bgp">
        <DiagramFrame caption="Five fields, three different jobs: uniqueness, policy, forwarding.">
          <RouteAnatomyDiagram />
        </DiagramFrame>
        <CliPair cisco={l3Only(L3_HEALTHY, "PE1", "cisco", "show bgp vpnv4 unicast rd 65001:102 10.2.2.0/24", /entry|4\.4\.4\.4 \(|Received Label|imported|Extended/)} junos={l3Only(L3_HEALTHY_JN, "PE1", "juniper", "show route table bgp.l3vpn.0 detail", /^65001:102|Route Distinguisher: 65001:102|Communities: target:65001:100|VPN Label: 299778|Secondary Tables: CUST-A/)} ciscoCaption="IOS XR · PE1 — RD 65001:102, next hop 4.4.4.4, label 24002, RT 65001:100, imported" junosCaption="Junos · PE1 — the same route; Junos numbers its labels from 299776" />
      </GuideSection>

      <GuideSection id="lv-control" eyebrow="Control plane" title="PE2's route, step by step" tone="bgp">
        <FlowSteps
          steps={[
            { title: "Learn", body: "PE2 has 10.2.2.0/24 in VRF CUST-A, toward CE2.", tone: "cyan" },
            { title: "Add the RD", body: "65001:102:10.2.2.0/24 — now a VPNv4 route.", tone: "bgp" },
            { title: "Attach the RT", body: "Export RT 65001:100 as an extended community.", tone: "violet" },
            { title: "Allocate the VPN label", body: "24002: 'VRF CUST-A' to PE2 itself. Not a transport label.", tone: "mpls" },
            { title: "Advertise", body: "One VPNv4 update to PE1; next hop = PE2's loopback 4.4.4.4.", tone: "bgp" },
            { title: "Import", body: "PE1 compares the RT with each VRF's import list and installs it in CUST-A.", tone: "success" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">PE1 keeps only routes that some local VRF imports. A route whose RT no VRF wants is discarded on arrival (route-target filtering) — remember that for the incident.</p>
      </GuideSection>

      <GuideSection id="lv-stack" eyebrow="Data plane" title="The two-label stack" tone="mpls">
        <p>
          CE1 sends to <Mono>10.2.2.20</Mono>. The packet arrives in VRF CUST-A on PE1, which finds next hop <Mono>4.4.4.4</Mono> and VPN label 24002. Reaching 4.4.4.4 is the LDP transport LSP&apos;s job. So the packet carries two labels for two jobs.
        </p>
        <DiagramFrame caption="The VPN label is pushed first, so it is the bottom (S=1). The transport label goes on top with S=0.">
          <StackEvolutionDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The guided lesson uses short transport labels, as in the MPLS lesson: P1 = <b>102</b>, P2 = <b>203</b>. The lab allocates like a real IOS XR router: P1 = 24102, P2 = 24203 (Junos: 299878, 299979). The VPN label is 24002 in both. Whoever receives a label chose it.
        </Callout>
        <CliPair cisco={l3Only(L3_HEALTHY, "PE1", "cisco", "show cef vrf CUST-A 10.2.2.20", /^10\.2\.2|via 4\.4\.4\.4|labels imposed/)} junos={l3Only(L3_HEALTHY_JN, "PE1", "juniper", "show route table CUST-A.inet.0", /^10\.2\.2|Push/)} ciscoCaption="IOS XR · PE1 — labels imposed {24102 24002}: transport first, VPN underneath" junosCaption="Junos · PE1 — Push 299778 (VPN), Push 299878 (top)" />
      </GuideSection>

      <GuideSection id="lv-roles" eyebrow="Data plane" title="Who reads which label" tone="mpls">
        <FieldTable
          title="Each router acts only on what it needs"
          accent="mpls"
          columns={["Router", "Reads", "Does"]}
          rows={[
            ["PE1", "the customer's IP (in VRF CUST-A)", "pushes 24002, then 24102"],
            ["P1", "the top label only", "swaps 24102 → 24203"],
            ["P2", "the top label only", "pops it (PHP) — 24002 stays"],
            ["PE2", "the VPN label 24002", "picks VRF CUST-A, forwards to CE2"],
          ]}
        />
        <CliPanel run={l3Cli(L3_HEALTHY, "P1", "cisco", "show mpls forwarding")} caption="IOS XR · P1 — only loopbacks: 24102 → 24203 toward 4.4.4.4" />
        <CliPanel run={l3Only(L3_HEALTHY, "PE2", "cisco", "show mpls forwarding", /Local|Label|---|\[V\]/)} caption="IOS XR · PE2 — its VPN labels, one per VRF route ([V]): 24002 is CUST-A's 10.2.2.0/24" />
        <Callout tone="success" title="Why the core scales" icon="✓">
          P1 and P2 hold no customer routes at all — <Mono>show bgp vpnv4 unicast</Mono> on P1 answers that BGP isn&apos;t even running. The VPN label is in the packet as it crosses them, but they never look at it.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-planes" eyebrow="Big picture" title="Control plane, data plane" tone="violet">
        <DiagramFrame caption="Routes travel PE to PE over MP-BGP; packets travel hop by hop on labels.">
          <PlanesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds state", points: ["IS-IS: reach the remote PE's loopback", "LDP: a transport label to it", "MP-BGP: VPN route, RD, RT, next hop, VPN label", "VRF: keeps it per customer"] },
            { title: "Data plane", tone: "success", tag: "uses state", points: ["VRF lookup at PE1", "push VPN label, push transport label", "swap, then PHP, in the core", "VPN label lookup at PE2"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Both must be complete. Routes in every VRF don&apos;t help if the transport LSP to 4.4.4.4 is broken; a perfect LSP doesn&apos;t help if PE1 never imported the route.</p>
      </GuideSection>

      <GuideSection id="lv-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Is the CE port in its VRF?", <Mono key="1">show route vrf CUST-A</Mono>, "the connected 172.16.1.0/29 is in CUST-A"],
            ["Is VPNv4 up?", <Mono key="2">show bgp vpnv4 unicast summary</Mono>, "4.4.4.4 Established, prefixes received"],
            ["Did the route arrive and import?", <Mono key="3">show bgp vpnv4 unicast rd 65001:102 10.2.2.0/24</Mono>, "RT 65001:100, label 24002, imported"],
            ["Is it in the VRF?", <Mono key="4">show route vrf CUST-A</Mono>, "B 10.2.2.0/24 via 4.4.4.4"],
            ["Does it work?", "a fresh ping from the CE", "delivered, reply back"],
          ]}
        />
        <PingResult s={OK_A} title="The lab: CE1A pings 10.2.2.20" />
        <PingResult s={OK_B} title="The lab: CE1B pings the same address — and reaches its own customer" />
      </GuideSection>

      <GuideSection id="lv-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>Since this morning Customer A&apos;s site 1 can&apos;t reach 10.2.2.0/24. CUST-B, with the very same addresses, works fine. MP-BGP is Established, PE2&apos;s loopback answers, the LSP works. An engineer touched PE1&apos;s VRF configuration overnight.</p>
        <PingResult s={L3_FAULT} title="The lab: CE1A pings 10.2.2.20 (the ticket)" />
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["PE1's CUST-A imports 65001:999", "PE2 exports CUST-A with 65001:100", "no match: PE1 drops the route"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["the BGP session: Established", "the transport LSP: CUST-B uses it fine", "the RD: it never decides import"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where does the ping die?", look: "At PE1: no route to 10.2.2.20 in VRF CUST-A." },
            { question: "Is VPNv4 up, and is anything received?", look: "Established — but PfxRcd dropped from 2 to 1." },
            { question: "Does PE2 advertise CUST-A's route?", look: "Yes: RD 65001:102, RT 65001:100, advertised to 1.1.1.1." },
            { question: "What does PE1's CUST-A import?", look: "65001:999 — nothing carries it." },
          ]}
        />
        <CliPanel run={l3Only(L3_FAULT, "PE1", "cisco", "show route vrf CUST-A", /^[SBCL] /)} caption="IOS XR · PE1 — VRF CUST-A has only its local site" />
        <CliPanel run={l3Only(L3_FAULT, "PE1", "cisco", "show bgp vpnv4 unicast summary", /Neighbor|4\.4\.4\.4/)} caption="IOS XR · PE1 — the session is up; one prefix accepted instead of two" />
        <CliPanel run={l3Only(L3_FAULT, "PE2", "cisco", "show bgp vpnv4 unicast rd 65001:102 10.2.2.0/24", /entry|Advertised|1\.1\.1\.1|Extended|Local label/)} caption="IOS XR · PE2 — the route is advertised to PE1 with RT 65001:100" />
        <CliPair cisco={l3Cli(L3_FAULT, "PE1", "cisco", "show vrf all")} junos={l3Cli(L3_FAULT_JN, "PE1", "juniper", "show configuration routing-instances CUST-A")} ciscoCaption="IOS XR · PE1 — CUST-A imports 65001:999" junosCaption="Junos · PE1 — the same mistake: import target:65001:999" />
      </GuideSection>

      <GuideSection id="lv-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE1(config)#", command: "vrf CUST-A", output: "RP/0/RP0/CPU0:PE1(config-vrf)#address-family ipv4 unicast\nRP/0/RP0/CPU0:PE1(config-vrf-af)#import route-target\nRP/0/RP0/CPU0:PE1(config-vrf-import-rt)#no 65001:999\nRP/0/RP0/CPU0:PE1(config-vrf-import-rt)#65001:100\nRP/0/RP0/CPU0:PE1(config-vrf-import-rt)#commit" }} junos={{ prompt: "admin@PE1# ", command: "set routing-instances CUST-A vrf-target import target:65001:100", output: "\n[edit]\nadmin@PE1# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1 — set replaces the single import target" />
        <PingResult s={L3_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE1's CUST-A imports 65001:100 again", "10.2.2.0/24 is back in VRF CUST-A, via 4.4.4.4, label 24002", "a fresh ping from CE1A reaches CE2A and the reply comes back"]} />
      </GuideSection>

      <GuideSection id="lv-other" eyebrow="Beyond this incident" title="Other ways an L3VPN fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "AF", title: "No VPNv4 on one side", tone: "danger", points: ["BGP Established", "no VPN routes cross — every customer"] },
            { tag: "STA", title: "Static to the wrong CE address", tone: "warning", points: ["route advertised, remote PE has it", "ARP fails at the egress PE"] },
            { tag: "LSP", title: "Transport LSP broken", tone: "violet", points: ["routes everywhere", "packets dropped in the core (or hidden on Junos)"] },
            { tag: "IF", title: "Port left out of its VRF", tone: "warning", points: ["the customer's packets reach the global table", "and its routes vanish from the VPN"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the L3VPN Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="lv-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a courier company serving many firms in one city. Each depot keeps a separate address book per client firm (VRFs) — two firms can both have a &quot;Room 10&quot; without confusion, because the book is chosen by which client handed the parcel in (the interface). Depots tell each other about new rooms with a note: &quot;Client file 102, Room 10, deliver to depot 4, for clients tagged A&quot; — the file number keeps notes apart (RD), the tag decides which address books copy it (RT). The parcel then gets two stickers: an inner one for depot 4 (&quot;client A&quot;, the VPN label) and an outer one for the trucks (&quot;to depot 4&quot;, the transport label). The trucks read only the outer sticker; depot 4 reads the inner one. Copy a note into the wrong address book, or tear off the truck sticker, and the parcel goes nowhere — even though all the depots are open.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Where does a fresh ping die? Is the CE port in its VRF? Is VPNv4 up on both sides, and are prefixes received? Does the remote PE advertise the route, and with which RT? Does the local VRF import that RT? Is the transport LSP to the remote PE complete?
        </Callout>
      </GuideSection>

      <GuideSection id="lv-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VRF", def: "VPN routing and forwarding instance: a per-customer routing table on a PE." },
            { term: "PE / P / CE", def: "Provider edge (runs VRFs and MP-BGP), provider core router (labels only), customer edge." },
            { term: "RD", def: "Route distinguisher: 8 bytes put in front of the prefix to make a VPNv4 route unique." },
            { term: "RT", def: "Route target: an extended community that drives VRF import and export." },
            { term: "VPNv4", def: "The MP-BGP address family carrying RD + IPv4 prefix + VPN label (Junos: inet-vpn, table bgp.l3vpn.0)." },
            { term: "VPN label", def: "The inner (bottom) label, chosen by the egress PE to identify the VRF." },
            { term: "Transport label", def: "The outer label (LDP here) that gets the packet to the egress PE." },
            { term: "PHP", def: "Penultimate hop popping: the last P router removes the transport label only." },
            { term: "RT filtering", def: "A PE discards VPNv4 routes that no local VRF imports." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why a provider needs a table per customer", "tell the RD's job from the RT's", "read a VPNv4 route", "follow the two-label stack", "explain the BGP-free core and why its LSP still matters", "find, fix and prove a route-target fault"]} />
      </GuideSection>

      <GuideSection id="lv-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers L3VPN in full: VRF design, RD and RT formats and plans, MP-BGP VPNv4 and its labels, label allocation modes, RT filtering and route reflectors, PE-CE routing, extranets and hub-and-spoke, Inter-AS options, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the L3VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
