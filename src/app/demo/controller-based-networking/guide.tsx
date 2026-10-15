import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FLEET, manualMinutes, pAnyMistake } from "@/lib/sim-engine/scenarios/ccna/controllerNetworking";

export const CTRL_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Why automate", tone: "cyan" }, objective: "One change, 48 switches — computed.", steps: ["predict-manual", "manual"] },
  { phase: { label: "Planes & APIs", tone: "violet" }, objective: "Management, control, data; northbound and southbound.", steps: ["planes", "intent", "predict-sb", "provision"] },
  { phase: { label: "Fabric & cloud", tone: "ip" }, objective: "Underlay, overlay — and a dashboard in the cloud.", steps: ["fabric", "cloud"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new floor's cameras stay dark.", steps: ["fault-injected", "inc-provision"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove all 48 switches carry the VLAN.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Controllers, planes, APIs, fabrics, cloud.", steps: ["complete"] },
];
export const CTRL_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  manual: { takeaway: "Small error rates compound across many devices." },
  intent: { takeaway: "Northbound: say what you want, not how." },
  provision: { takeaway: "Southbound: NETCONF/RESTCONF, gRPC, SSH." },
  fabric: { takeaway: "Fabric = underlay + overlay + policy." },
  cloud: { takeaway: "Cloud management moves only the management plane." },
  "fault-injected": { doingNow: "Something new joins the network." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "A controller manages exactly its inventory." },
};

export const CTRL_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ctl-mission", label: "What this lesson teaches" },
  { id: "ctl-why", label: "Why automate" },
  { id: "ctl-compare", label: "Traditional vs controller-based" },
  { id: "ctl-planes", label: "Three planes" },
  { id: "ctl-apis", label: "Northbound and southbound" },
  { id: "ctl-fabric", label: "Underlay, overlay, fabric" },
  { id: "ctl-cloud", label: "Cloud-managed networks" },
  { id: "ctl-incident", label: "The incident and the fix" },
  { id: "ctl-glossary", label: "Glossary" },
];
export const CTRL_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ctd-products", label: "Controllers you'll meet" },
  { id: "ctd-config", label: "Opening the southbound door" },
  { id: "ctd-myths", label: "Misconceptions" },
  { id: "ctd-explain", label: "Explain it" },
  { id: "ctd-quiz", label: "Check yourself" },
];

export function CtrlLessonGuideContent() {
  return (
    <>
      <GuideSection id="ctl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Why networks are increasingly run through controllers and the cloud, how a controller turns intent into device configuration, and what still happens on the devices themselves.</p>
        <Callout tone="violet" title="CCNA 6.1 · 6.2 · 6.3">How automation impacts network management; traditional versus controller-based networking; software-defined architectures (overlay, underlay, fabric; separation of control and data plane; northbound and southbound APIs).</Callout>
      </GuideSection>
      <GuideSection id="ctl-why" eyebrow="Why" title="Why automate">
        <FieldTable
          title="One VLAN on 48 switches (from the lesson's model)"
          columns={["", "By hand", "Through a controller"]}
          rows={[
            ["Effort", `${FLEET.switches} × ${FLEET.minutesEach} min = ${manualMinutes()} min`, "One request; parallel push"],
            ["Consistency", `P(at least one mistake) = 1 − (1 − ${FLEET.errorRate})^${FLEET.switches} ≈ ${pAnyMistake()}%`, "Same rendered config everywhere, verified"],
            ["Record", "Whatever each engineer remembers", "Task log and intended state"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ctl-compare" eyebrow="Compare" title="Traditional vs controller-based">
        <CompareCards
          items={[
            { title: "Traditional", tone: "warning", tag: "box by box", points: ["Each device configured individually (CLI, SSH)", "Each runs its own control plane", "Policy lives in many configs"] },
            { title: "Controller-based", tone: "cyan", tag: "central", points: ["Intent defined once on the controller", "Controller renders and pushes per-device config", "Devices still forward locally (data plane)"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="ctl-planes" eyebrow="Planes" title="Three planes">
        <FieldTable
          title="What each plane does"
          columns={["Plane", "Job", "Examples"]}
          rows={[
            ["Management", "Configure and monitor the device", "SSH, SNMP, NETCONF, REST, syslog"],
            ["Control", "Decide: build forwarding tables", "OSPF, STP, ARP, MAC learning"],
            ["Data", "Forward user traffic", "Switching frames, routing packets, ACLs in hardware"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ctl-apis" eyebrow="APIs" title="Northbound and southbound">
        <CompareCards
          items={[
            { title: "Northbound", tone: "violet", tag: "apps → controller", points: ["REST over HTTPS, JSON bodies", "Scripts, ITSM, dashboards", "'What' — intent"] },
            { title: "Southbound", tone: "cyan", tag: "controller → devices", points: ["NETCONF / RESTCONF with YANG models", "gRPC, OpenFlow, CLI over SSH", "'How' — per-device config"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="ctl-fabric" eyebrow="Fabric" title="Underlay, overlay, fabric">
        <FieldTable
          title="Software-defined architecture"
          columns={["Part", "What it is", "Example"]}
          rows={[
            ["Underlay", "The physical routed network connecting every node", "Point-to-point links + IS-IS or OSPF"],
            ["Overlay", "Virtual networks tunnelled over the underlay", "VXLAN (data center, SD-Access), LISP control"],
            ["Fabric", "Underlay + overlay + central policy, run as one system", "Cisco SD-Access, data-center EVPN fabrics"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ctl-cloud" eyebrow="Cloud" title="Cloud-managed networks">
        <p>With Meraki, Mist and similar platforms the dashboard (management plane) is a cloud service; devices keep an outbound HTTPS connection to it. When that link fails, configuration changes and statistics wait — switching and routing continue.</p>
      </GuideSection>
      <GuideSection id="ctl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "How many devices did the task touch?", look: "Controller task log: 45 provisioned." },
            { question: "How many should it have?", look: "48 — three new switches on floor 9." },
            { question: "Are they in the inventory?", look: "No: configured from a USB stick, never discovered." },
          ]}
        />
        <p>Fix: discover the switches and assign them to the site, then let the controller provision them — don&apos;t patch them by hand, or the network drifts from what the controller believes.</p>
      </GuideSection>
      <GuideSection id="ctl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Intent", def: "What you want the network to do, stated once to a controller." },
            { term: "Northbound API", def: "The interface applications use to talk to the controller." },
            { term: "Southbound API", def: "The interface the controller uses to talk to devices." },
            { term: "YANG", def: "A data-modeling language describing device configuration and state for NETCONF/RESTCONF." },
            { term: "Underlay / overlay", def: "The physical network / virtual networks tunnelled over it." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "ctd-q1", prompt: "OSPF recalculates routes after a link fails. Which plane?", options: [{ id: "c", label: "Control" }, { id: "d", label: "Data" }, { id: "m", label: "Management" }], correctId: "c", explanation: "Building or rebuilding tables is control-plane work." },
  { id: "ctd-q2", prompt: "Which is a southbound protocol?", options: [{ id: "nc", label: "NETCONF" }, { id: "rest", label: "The controller's REST API used by a Python script" }, { id: "json", label: "JSON" }], correctId: "nc", explanation: "NETCONF runs between controller and device. A script calling the controller uses the northbound API; JSON is a data format." },
  { id: "ctd-q3", prompt: "In a fabric, what does the underlay provide?", options: [{ id: "u", label: "IP reachability between all fabric nodes" }, { id: "v", label: "User VLANs and segments" }, { id: "p", label: "Security policy" }], correctId: "u", explanation: "The underlay just connects the nodes; overlays carry user networks and policy rides on top." },
];

export function CtrlDeepDiveContent() {
  return (
    <>
      <GuideSection id="ctd-products" eyebrow="Products" title="Controllers you'll meet">
        <FieldTable
          title="Same idea, many vendors"
          columns={["Platform", "Domain"]}
          rows={[
            ["Cisco Catalyst Center (formerly DNA Center)", "Campus (SD-Access)"],
            ["Cisco Meraki · Juniper Mist", "Cloud-managed campus, Wi-Fi, branch"],
            ["Juniper Apstra · Arista CloudVision", "Data-center fabrics"],
            ["Cisco Catalyst SD-WAN Manager", "WAN (see SD-WAN Path Selection)"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ctd-config" eyebrow="Configure" title="Opening the southbound door">
        <CliPair
          cisco={{ prompt: "SW-B1(config)#", command: "netconf-yang", output: "SW-B1# show netconf-yang status\nnetconf-yang: enabled\nnetconf-yang ssh port: 830" }}
          junos={{ prompt: "admin@SW-B1# ", command: "set system services netconf ssh", output: "admin@SW-B1> show system connections | match 830\ntcp4  0  0  *.830   *.*   LISTEN" }}
        />
      </GuideSection>
      <GuideSection id="ctd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "With a controller, traffic flows through the controller.", correction: "Devices still forward locally; the controller manages configuration and policy." },
            { myth: "If the cloud dashboard is down, the network is down.", correction: "Only management pauses; the data plane keeps forwarding." },
            { myth: "'Task succeeded' means every device is configured.", correction: "It means every device the controller manages. Check the inventory." },
          ]}
        />
      </GuideSection>
      <GuideSection id="ctd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why is fixing floor 9 by SSH the wrong repair even though it would work?", a: "The controller still wouldn't know the switches exist: future intents would skip them again, and their configuration would drift from the rest." }]} />
      </GuideSection>
      <GuideSection id="ctd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
