import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, SRV6_HEX_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { DOC, createEbNet, ebApply, ebTicket, ebTicketState, type EbAction, type EbR, type EbRtr, type EbState } from "@/lib/sim-engine/scenarios/ebNet";
import { ebSets, ebStaticApi } from "./eb-lab/ebCli";

export const SRV6E_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bl-mission", label: "What this lesson teaches" },
  { id: "bl-network", label: "The network of this lesson" },
  { id: "bl-ideas", label: "Three ideas you need" },
  { id: "bl-table", label: "One table, many behaviors" },
  { id: "bl-endx", label: "End vs End.X" },
  { id: "bl-endt", label: "End.T, briefly" },
  { id: "bl-decap", label: "Outer and inner packet" },
  { id: "bl-dt", label: "End.DT4 and End.DT6" },
  { id: "bl-rules", label: "The rules of the last segment" },
  { id: "bl-dx", label: "End.DX4: cross-connect" },
  { id: "bl-dx2", label: "End.DX2, briefly" },
  { id: "bl-incident", label: "The wrong-customer incident" },
  { id: "bl-working", label: "What working looks like" },
  { id: "bl-other", label: "Other ways it fails" },
  { id: "bl-model", label: "Mental model" },
  { id: "bl-glossary", label: "Glossary" },
  { id: "bl-recap", label: "Recap" },
  { id: "bl-practice", label: "Practice it" },
];

/** Real IOS XR output and test results on this page come from the SRv6 Endpoint Behaviors Lab. */
const E0: EbState = createEbNet(0);
const run = (s: EbState, ...a: EbAction[]) => a.reduce((acc, x) => ebApply(acc, x), s);
const set = (text: string, changes: { dev: EbR; f: (c: EbRtr) => void }[]): EbAction => ({ type: "set", text, changes });
const send = (sids: string[], inner: string): EbAction => ({ type: "send", sids, inner });
const VIA_END = run(E0, send([DOC.endR3, DOC.dt4], "10.10.2.8"));
const VIA_X = run(E0, send([DOC.endXR3R4, DOC.dt4], "10.10.2.8"));
const DT4B = run(E0, send([DOC.dt4], "10.10.2.8"));
const DT4A = run(E0, send([DOC.dt4], "10.10.1.8"));
const DT6 = run(E0, send([DOC.dt6], "2001:db8:c6::6"));
const NOTLAST = run(E0, send([DOC.dt4, DOC.endR3], "10.10.2.8"));
const FAMILY = run(E0, send([DOC.dt6], "10.10.2.8"));
const PERCE = run(E0, set("per-ce", [{ dev: "R6", f: (c) => void (c.vrfs.CUST4!.mode = "per-ce") }]));
const DXB = run(PERCE, send(["2001:db8:100:6:43::"], "10.10.2.8"));
const INC = ebTicket("perce").repro.reduce((acc, a) => ebApply(acc, a), ebTicketState("perce", 0));
const INC_FIX = run(INC, set("per-vrf", [{ dev: "R6", f: (c) => void (c.vrfs.CUST4!.mode = "per-vrf") }]), send([DOC.dt4], "10.10.2.8"));
export function ebCli(s: EbState, r: EbR, command: string) {
  return runGuideCli(ebSets(ebStaticApi(s, r), r).cisco, command);
}
export function ebOnly(s: EbState, r: EbR, command: string, match: RegExp, keep = 0) {
  const x = ebCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One test, as the lab reports it. */
export function EbResult({ s, title }: { s: EbState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      H1 → {t.inner} via [{t.sids.join(", ")}]: {t.ok ? `delivered to ${t.deliveredTo} via ${t.path.join(" → ")}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Endpoint Behaviors Lab" onPractice={openLab}>
      The network of this lesson on IOS XR: End, End.X and R6&apos;s service SIDs, test traffic to three customers, VRFs you can change, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const BASE: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R3", label: "10" },
  { a: "R3", b: "R6", label: "10" },
  { a: "R1", b: "R4", label: "5" },
  { a: "R4", b: "R5", label: "5" },
  { a: "R5", b: "R6", label: "5" },
  { a: "R3", b: "R4", label: "20" },
];

function FamiliesDiagram() {
  return (
    <DiagramSvg h={170} label="Topological behaviors End, End.X and End.T keep forwarding the SRv6 packet itself; service behaviors End.DX6, DX4, DT6, DT4 and DX2 remove the outer IPv6 header and deliver the inner payload">
      <DNode x={320} y={30} label="DA matches a local SID" sub="Local SID Table → bound behavior" accent={D.cyan} w={250} />
      <DArrow x1={260} y1={53} x2={170} y2={85} color={D.faint} width={1.4} />
      <DArrow x1={380} y1={53} x2={470} y2={85} color={D.faint} width={1.4} />
      <DNode x={170} y={110} label="End · End.X · End.T" sub="forward the SRv6 packet itself" accent={D.warning} w={230} />
      <DNode x={470} y={110} label="DX6 · DX4 · DT6 · DT4 · DX2" sub="decap, deliver the inner payload" accent={D.violet} w={250} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        D = decapsulation · X = cross-connect · T = table lookup · 6 / 4 / 2 = payload family (teaching aid)
      </text>
    </DiagramSvg>
  );
}

function ThreeBehaviorsDiagram() {
  const r3r6 = new Set(["R3-R6"]);
  const viaR4 = new Set(["R3-R4", "R4-R5", "R5-R6"]);
  return (
    <DiagramSvg h={250} label="Same next segment R6: End at R3 forwards R3 to R6 directly; End.X forces the R3 to R4 adjacency, then R4 R5 R6; End.T looks up table CORE-B, which has no R3-R6 link, and also leaves via R4">
      <Srv6Topology
        pos={SRV6_HEX_POS}
        links={BASE.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (r3r6.has(id)) return { ...l, color: D.success, bold: true };
          if (viaR4.has(id)) return { ...l, color: D.warning, bold: true };
          if (id === "R1-R2" || id === "R2-R3") return { ...l, color: D.ip, bold: true };
          return { ...l, dashed: true };
        })}
        sub={{ R1: "headend", R3: "End / X / T", R6: "next segment" }}
        accent={{ R1: D.ip, R3: D.warning, R6: D.success }}
        boxW={82}
      />
      <text x={20} y={228} fill={D.success} fontSize={10.5} fontWeight={700}>
        End: FIB lookup in MAIN → R3 → R6
      </text>
      <text x={620} y={228} textAnchor="end" fill={D.warning} fontSize={10.5} fontWeight={700}>
        End.X (adjacency R4) · End.T (table CORE-B) → via R4
      </text>
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        all three: SL 1 → 0 and DA ← R6 End SID — only the forwarding treatment differs
      </text>
    </DiagramSvg>
  );
}

function OuterInnerDiagram() {
  return (
    <DiagramSvg h={190} label="Outer IPv6 header with DA equal to R6's service SID, no SRH for a single segment, carrying an inner IPv4 packet to 10.10.2.8; transit routers only read the outer header">
      <DHeaderColumn
        x={200}
        y={24}
        w={230}
        rows={[
          { text: "outer IPv6 · DA = 2001:db8:100:6:13::", color: D.warning, tag: "OUTER", strong: true },
          { text: "no SRH (single segment)", color: D.faint, tag: "SRH" },
          { text: "IPv4 · dst 10.10.2.8", color: D.ip, tag: "INNER" },
        ]}
      />
      <text x={345} y={40} fill={D.text} fontSize={11} fontWeight={700}>
        transport namespace
      </text>
      <text x={345} y={56} fill={D.muted} fontSize={10}>
        the DA is an SRv6 SID; R1–R5 read only this
      </text>
      <text x={345} y={100} fill={D.text} fontSize={11} fontWeight={700}>
        customer namespace
      </text>
      <text x={345} y={116} fill={D.muted} fontSize={10}>
        IPv6, IPv4 or an Ethernet frame,
      </text>
      <text x={345} y={130} fill={D.muted} fontSize={10}>
        exposed only by a service behavior
      </text>
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        R1 performs a simplified headend encapsulation here — the full H.Encaps lesson is SRv6 Policy
      </text>
    </DiagramSvg>
  );
}

function DxDtDiagram() {
  return (
    <DiagramSvg h={200} label="DX: decapsulate then send to a fixed adjacency, no lookup. DT: decapsulate, select a table, look up the inner destination, and the result picks the CE">
      <text x={160} y={22} textAnchor="middle" fill={D.warning} fontSize={12} fontWeight={700}>
        DX — cross-connect
      </text>
      <DNode x={160} y={60} label="decapsulate" accent={D.warning} w={150} h={34} />
      <DArrow x1={160} y1={78} x2={160} y2={106} color={D.faint} width={1.4} />
      <DNode x={160} y={126} label="fixed adjacency" sub="bound in the SID entry" accent={D.warning} w={170} />
      <text x={160} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        the SID itself chose the neighbor
      </text>
      <text x={480} y={22} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        DT — table lookup
      </text>
      <DNode x={480} y={60} label="decapsulate" accent={D.violet} w={150} h={34} />
      <DArrow x1={480} y1={78} x2={480} y2={106} color={D.faint} width={1.4} />
      <DNode x={480} y={126} label="lookup in bound table" sub="inner destination decides" accent={D.violet} w={200} />
      <text x={480} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        one SID can reach several CEs
      </text>
    </DiagramSvg>
  );
}

function StageDiagram() {
  return (
    <DiagramSvg h={150} label="The R6 to R6 packet shown at a service step is the input before decapsulation: outer IPv6 with the service SID plus the inner payload. The delivery to the CE is recorded in the journey, not drawn as a separate packet">
      <DHeaderColumn
        x={170}
        y={34}
        w={210}
        rows={[
          { text: "outer IPv6 · DA = service SID", color: D.warning, strong: true },
          { text: "inner payload", color: D.ip },
        ]}
        caption="R6 → R6 · badge END.DT4 (etc.)"
      />
      <text x={170} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        what the Inspector shows
      </text>
      <DArrow x1={290} y1={58} x2={370} y2={58} color={D.faint} width={1.4} label="behavior runs" />
      <DNode x={500} y={58} label="journey records" sub="delivered to CE…" accent={D.success} w={170} />
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        the label says &quot;Stage shown: at R6 before … decap&quot; — it never pretends the header is already gone
      </text>
    </DiagramSvg>
  );
}


export function Srv6EndpointLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="bl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          In SRv6 Foundations every SID meant the same thing: End — “move on to the next segment”. But a SID is an instruction, and the instruction is whatever the owning node bound to it. This lesson opens R6&apos;s local SID table and finds SIDs that steer through a chosen link, SIDs that hand a packet to a VRF, and SIDs that hand it straight to one customer.
        </p>
        <p>You will compare End with End.X on the same path, watch R6 decapsulate and look packets up in two VRFs, break the rules that make decapsulation safe — and end with the guided lesson&apos;s incident, where a packet for one customer is delivered, flawlessly, to another.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["read a local SID table and say what each behavior does", "tell End from End.X and use End.X to steer", "explain End.DT4/DT6: decapsulate and look up", "explain End.DX4: decapsulate and cross-connect", "apply the last-segment and family rules", "find a service-SID fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="bl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The hexagon, the R3–R4 cross-link, and R6's customers.">
          <StageDiagram />
        </DiagramFrame>
        <p>The SRv6 Foundations hexagon plus a cross-link R3–R4 (metric 20 — no shortest path uses it). R6 is the service node: <b className="text-pv-text">VRF CUST4</b> with CE4-A (10.10.1.8) and CE4-B (10.10.2.8), and <b className="text-pv-text">VRF CUST6</b> with CE6 (2001:db8:c6::6). R1 encapsulates H1&apos;s test packets with any segment list.</p>
        <Callout tone="cyan" title="IOS XR in the lab" icon="i">
          The lab runs IOS XR on every router: IS-IS allocates End and End.X; on R6, BGP allocates the VRF service SIDs (<Mono>segment-routing srv6 locator MAIN alloc mode per-vrf | per-ce</Mono> under each VRF address family).
        </Callout>
      </GuideSection>

      <GuideSection id="bl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Transit behaviors", tone: "mpls", tag: "End, End.X", points: ["move to the next segment", "route, or use a chosen link"] },
            { title: "Decapsulation", tone: "violet", tag: "DT, DX", points: ["end the SRv6 journey", "hand the inner packet on"] },
            { title: "The rules", tone: "warning", tag: "safety", points: ["last segment only", "the right inner family"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-table" eyebrow="The table" title="One table, many behaviors" tone="mpls">
        <DiagramFrame caption="Transit family on R3, service family on R6.">
          <FamiliesDiagram />
        </DiagramFrame>
        <p>R6&apos;s local SID table holds five SIDs under one locator. IS-IS allocated End and the two End.X (one per adjacency); BGP allocated End.DT4 for CUST4 and End.DT6 for CUST6. The function bits are just numbers — the table is what gives them meaning.</p>
        <CliPanel run={ebCli(E0, "R6", "show segment-routing srv6 sid")} caption="IOS XR · R6 — End, End.X, End.DT4 ('CUST4'), End.DT6 ('CUST6')" />
      </GuideSection>

      <GuideSection id="bl-endx" eyebrow="Moving on" title="End vs End.X" tone="success">
        <DiagramFrame caption="Same rewrite, different exit.">
          <ThreeBehaviorsDiagram />
        </DiagramFrame>
        <p>With <Mono>[R3 End, CUST4 SID]</Mono> R3 moves to the next segment and routes toward R6&apos;s locator — the direct link. With <Mono>[R3 End.X → R4, CUST4 SID]</Mono> the rewrite is identical, but R3 sends the packet out of its link to R4. End.X is SRv6&apos;s Adjacency SID: steering by a link rather than by routing.</p>
        <EbResult s={VIA_END} title="The lab: via R3's End" />
        <EbResult s={VIA_X} title="The lab: via R3's End.X toward R4" />
      </GuideSection>

      <GuideSection id="bl-endt" eyebrow="Moving on" title="End.T, briefly" tone="cyan">
        <p>RFC 8986 also defines <b className="text-pv-text">End.T</b>: move to the next segment, but look the new destination up in a specific IPv6 table instead of the main one. The guided lesson uses it to route around the R3–R6 link. It is rarely deployed and IOS XR does not allocate it, so the lab sticks to End and End.X.</p>
      </GuideSection>

      <GuideSection id="bl-decap" eyebrow="Leaving SRv6" title="Outer and inner packet" tone="violet">
        <DiagramFrame caption="The outer header carries the program; the inner packet is the customer's.">
          <OuterInnerDiagram />
        </DiagramFrame>
        <p>Every packet R1 sends is a customer packet inside an outer IPv6 header. Transit behaviors work on the outer header only. Service behaviors <b className="text-pv-text">decapsulate</b> — remove the outer header (and any SRH) — and then decide what to do with the customer&apos;s packet.</p>
      </GuideSection>

      <GuideSection id="bl-dt" eyebrow="Leaving SRv6" title="End.DT4 and End.DT6" tone="success">
        <p><b className="text-pv-text">End.DT4</b>: decapsulate, look the inner IPv4 packet up in the VRF the SID belongs to. The same CUST4 SID reaches CE4-B for 10.10.2.8 and CE4-A for 10.10.1.8 — the lookup chose the customer. <b className="text-pv-text">End.DT6</b> does the same for IPv6.</p>
        <EbResult s={DT4B} title="The lab: CUST4 SID, inner 10.10.2.8" />
        <EbResult s={DT4A} title="The lab: CUST4 SID, inner 10.10.1.8" />
        <EbResult s={DT6} title="The lab: CUST6 SID, inner 2001:db8:c6::6" />
        <CliPanel run={ebCli(E0, "R6", "show segment-routing srv6 sid 2001:db8:100:6:42:: detail")} caption="IOS XR · R6 — End.DT4 bound to VRF CUST4's IPv4 table" />
      </GuideSection>

      <GuideSection id="bl-rules" eyebrow="The rules" title="The rules of the last segment" tone="danger">
        <p>Decapsulation ends the SRv6 journey, so a DT or DX SID is only valid as the <b className="text-pv-text">last segment</b> — Segments Left 0. And the behavior defines the lookup, so the inner packet must be the right <b className="text-pv-text">family</b>: IPv4 for DT4/DX4, IPv6 for DT6/DX6 (End.DT46 accepts both).</p>
        <EbResult s={NOTLAST} title="The lab: [CUST4 SID, R3 End]" />
        <EbResult s={FAMILY} title="The lab: CUST6 SID with an IPv4 packet inside" />
      </GuideSection>

      <GuideSection id="bl-dx" eyebrow="Cross-connect" title="End.DX4: cross-connect" tone="warning">
        <DiagramFrame caption="DT looks up; DX sends.">
          <DxDtDiagram />
        </DiagramFrame>
        <p>With <Mono>alloc mode per-ce</Mono> BGP allocates one <b className="text-pv-text">End.DX4</b> per CE instead of one End.DT4 per VRF: decapsulate and send to that CE, without any lookup. The headend picks the customer by picking the SID. Because these SIDs are dynamic, switching modes renumbered R6&apos;s table.</p>
        <CliPanel run={ebCli(PERCE, "R6", "show segment-routing srv6 sid")} caption="IOS XR · R6 with CUST4 per-ce — End.DX4 toward each CE, End.DT6 moved to …:44::" />
        <EbResult s={DXB} title="The lab: CE4-B's DX SID, inner 10.10.2.8" />
      </GuideSection>

      <GuideSection id="bl-dx2" eyebrow="Cross-connect" title="End.DX2, briefly" tone="cyan">
        <p><b className="text-pv-text">End.DX2</b> is the Layer-2 cross-connect: decapsulate and send the inner Ethernet frame out of an attachment circuit — the data plane of SRv6 EVPN VPWS. The guided lesson shows it; configuring it needs EVPN, which a later lesson covers.</p>
      </GuideSection>

      <GuideSection id="bl-incident" eyebrow="Incident" title="The wrong-customer incident" tone="danger">
        <p>In the guided lesson, R6&apos;s service SID was bound to End.DX4 toward CE4-A where End.DT4 for CUST4 was intended: a packet for 10.10.2.8 was decapsulated and handed to CE4-A. In the lab the same thing happens for a realistic reason: a BGP template switched VRF CUST4 to per-CE allocation, the dynamic SIDs were renumbered, and the documented CUST4 SID became CE4-A&apos;s End.DX4.</p>
        <EbResult s={INC} title="The lab: the documented CUST4 SID, inner 10.10.2.8 (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Did the packet reach R6?", look: "Yes — transit was healthy." },
            { question: "What is …:6:42:: now?", look: "End.DX4 toward CE4-A — no longer End.DT4." },
            { question: "Was the final-segment check fine?", look: "Yes: it was the only segment. The behavior itself is the problem." },
            { question: "Why did it change?", look: "VRF CUST4: alloc mode per-ce." },
          ]}
        />
        <CliPanel run={ebOnly(INC, "R6", "show running-config router bgp", /^router bgp|vrf CUST4|address-family ipv4|alloc mode per-ce/)} caption="IOS XR · R6 — VRF CUST4 allocates per CE" />
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R6(config)#", command: "router bgp 65000 vrf CUST4 address-family ipv4 unicast segment-routing srv6", output: "RP/0/RP0/CPU0:R6(config-bgp-vrf-af-srv6)#alloc mode per-vrf\nRP/0/RP0/CPU0:R6(config-bgp-vrf-af-srv6)#commit" }} caption="IOS XR · R6 — the repair" />
        <EbResult s={INC_FIX} title="The lab: a fresh test after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["…:6:42:: is End.DT4 for CUST4 again", "the same packet for 10.10.2.8 reaches CE4-B", "the lesson: read the live SID table — dynamic SIDs move"]} />
      </GuideSection>

      <GuideSection id="bl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Which SIDs, which behaviors?", <Mono key="1">show segment-routing srv6 sid</Mono>, "End, End.X, End.DT4 'CUST4', End.DT6 'CUST6'"],
            ["What is behind a service SID?", <Mono key="2">show segment-routing srv6 sid &lt;sid&gt; detail</Mono>, "the VRF table (DT) or the CE (DX)"],
            ["What does the VRF allocate?", <Mono key="3">show bgp vrf CUST4 ipv4 unicast</Mono>, "locator MAIN, per-vrf"],
            ["What is in the VRF?", <Mono key="4">show route vrf CUST4</Mono>, "10.10.1.0/24 and 10.10.2.0/24"],
            ["Does it work?", "a test from R1", "delivered to the right CE"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "AF", title: "VRF without SRv6", tone: "danger", points: ["no service SID", "dropped at R6"] },
            { tag: "VRF", title: "CE out of its VRF", tone: "warning", points: ["DT runs", "no route in the VRF"] },
            { tag: "X", title: "End.X adjacency down", tone: "violet", points: ["End.X SID withdrawn", "dropped at R3"] },
            { tag: "LOC", title: "Missing locator name", tone: "danger", points: ["no SID for that VRF", "the others shift"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 Endpoint Behaviors Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="bl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of R6 as a building with a reception desk and a list of extension numbers (the local SID table). Some extensions just forward the caller to the next number on their list (End), some forward through one particular corridor (End.X). Others end the call at the building: one extension connects you to the switchboard of a company that looks up the right desk for you (End.DT), another rings one desk directly, whoever you asked for (End.DX). If somebody quietly renumbers the extensions, callers using last year&apos;s directory still get through — to the wrong desk.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Where did the packet die, or who got it? Does every SID exist, and which behavior is it? Is the service SID last? Does the family match? What does the VRF allocate, and what is in it? Are the End.X adjacencies up?
        </Callout>
      </GuideSection>

      <GuideSection id="bl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "End", def: "Move to the next segment and route on it." },
            { term: "End.X", def: "Move to the next segment and send out a given adjacency." },
            { term: "End.T", def: "Move to the next segment and look it up in a given table." },
            { term: "End.DT4 / DT6 / DT46", def: "Decapsulate and look the inner packet up in a VRF." },
            { term: "End.DX4 / DX6", def: "Decapsulate and send the inner packet to one CE." },
            { term: "End.DX2", def: "Decapsulate and send the inner frame out an L2 attachment circuit." },
            { term: "alloc mode per-vrf / per-ce", def: "IOS XR: one DT SID per VRF, or one DX SID per CE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["read a local SID table", "steer with End.X", "explain DT and DX", "apply the last-segment and family rules", "explain why dynamic SIDs move", "find, fix and prove a service-SID fault"]} />
      </GuideSection>

      <GuideSection id="bl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers the endpoint behaviors of RFC 8986 in full: the processing pipeline, the next-hop treatment of End, End.X and End.T, the decapsulation family, flavors, how IOS XR allocates each behavior, configuration and verification, and every failure signature with real evidence. The lab lets you send the packets.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 Endpoint Behaviors presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
