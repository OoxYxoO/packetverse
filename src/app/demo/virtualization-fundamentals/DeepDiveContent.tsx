import { CompareCards, FailureSignatures, FieldTable, GuideSection, Misconceptions } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { DensityTable } from "./LessonGuideContent";

export const VIRT_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vtd-switches", label: "Standard vs distributed switches" },
  { id: "vtd-nics", label: "Teaming the uplinks" },
  { id: "vtd-density", label: "Density, again" },
  { id: "vtd-container-net", label: "Container networking modes" },
  { id: "vtd-nfv", label: "Network functions as VMs" },
  { id: "vtd-signatures", label: "How virtual-network problems look" },
  { id: "vtd-myths", label: "Misconceptions" },
  { id: "vtd-explain", label: "Explain it" },
  { id: "vtd-quiz", label: "Check yourself" },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "vtd-q1",
    prompt: "A firewall policy on the physical network should block VM-WEB from talking to VM-APP. Both are on the same host and port group. Will it work?",
    options: [
      { id: "no", label: "No — their traffic never leaves the host" },
      { id: "yes", label: "Yes — every frame passes the physical firewall" },
      { id: "sometimes", label: "Only for broadcast frames" },
    ],
    correctId: "no",
    explanation: "The vSwitch delivers it internally. Policy between such VMs must be applied in the virtual layer (micro-segmentation, distributed firewall).",
  },
  {
    id: "vtd-q2",
    prompt: "Which is a reason to choose a VM over a container?",
    options: [
      { id: "os", label: "The workload needs a different operating system from the host" },
      { id: "fast", label: "Faster start-up" },
      { id: "small", label: "Smaller memory footprint" },
    ],
    correctId: "os",
    explanation: "Containers share the host kernel, so a Windows workload can't run in a container on a Linux host. VMs bring their own OS.",
  },
];

export function VirtDeepDiveContent() {
  return (
    <>
      <GuideSection id="vtd-switches" eyebrow="vSwitch" title="Standard vs distributed switches">
        <CompareCards
          items={[
            { title: "Standard vSwitch", tone: "warning", tag: "per host", points: ["Configured on each host separately", "Port groups can drift apart (the incident)", "Fine for a few hosts"] },
            { title: "Distributed vSwitch", tone: "success", tag: "one config, many hosts", points: ["Defined once in the management plane", "Identical port groups everywhere", "Migration-safe by design"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtd-nics" eyebrow="Uplinks" title="Teaming the uplinks">
        <p>Hosts use two or more physical NICs to separate switches for redundancy. Teaming can be active/standby, load-balanced by VM port (no switch config needed), or a LACP port channel to a switch pair (see the LACP lesson).</p>
      </GuideSection>

      <GuideSection id="vtd-density" eyebrow="Density" title="Density, again">
        <DensityTable />
      </GuideSection>

      <GuideSection id="vtd-container-net" eyebrow="Containers" title="Container networking modes">
        <FieldTable
          title="Common modes"
          columns={["Mode", "How", "Typical use"]}
          rows={[
            ["Bridge (default)", "Private subnet inside the host; NAT to publish ports", "Single host"],
            ["Host", "Shares the host's network stack", "Performance, network tools"],
            ["Overlay", "VXLAN tunnels between hosts", "Clusters (Kubernetes, Swarm)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vtd-nfv" eyebrow="NFV" title="Network functions as VMs">
        <p>Routers, firewalls and load balancers also run as VMs or containers (NFV): Cisco Catalyst 8000V, Juniper vSRX and vMX, cloud-native firewalls. Same protocols and CLIs; a hypervisor instead of dedicated hardware.</p>
      </GuideSection>

      <GuideSection id="vtd-signatures" eyebrow="Troubleshooting" title="How virtual-network problems look">
        <FailureSignatures
          items={[
            { tag: "Port group", title: "Wrong VLAN after migration", tone: "danger", points: ["Works on one host, not another", "IP and MAC unchanged", "ARP unanswered"] },
            { tag: "Trunk", title: "VLAN not allowed on the uplink", tone: "warning", points: ["All VMs in that VLAN on that host fail", "Other hosts fine"] },
            { tag: "Teaming", title: "Teaming vs switch mismatch", tone: "violet", points: ["MAC flapping on the physical switch", "Intermittent loss"] },
            { tag: "VRF", title: "Interface in the wrong VRF", tone: "cyan", points: ["Interface up, routes 'missing'", "They exist — in another table"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "VMs are configured with VLAN tags.", correction: "Usually not — the port group tags for them. The guest OS sees an ordinary, untagged NIC." },
            { myth: "Containers are lightweight VMs.", correction: "They're isolated processes on a shared kernel; there's no virtual hardware at all." },
            { myth: "VRFs need separate hardware.", correction: "They are separate tables on the same router, selected by the ingress interface." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why did VM-WEB stop working on HOST2 although nothing in the VM changed?", a: "The VLAN is decided by the host's port group. HOST2's WEB port group carried VLAN 20, so VM-WEB's frames entered the wrong VLAN." },
            { q: "Why can two customers both use 10.0.0.0/24 on R1?", a: "Each customer's interfaces belong to a different VRF; lookups never cross tables." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
