import { Callout, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DRegion, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { KnowledgeCheck } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FOOTPRINT, HOST_CAPACITY, VM, VRF_TABLES, createVirtState, fits, vmPath, vrfLookup } from "@/lib/sim-engine/scenarios/ccna/virtualization";

export const VIRT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vtl-mission", label: "What this lesson teaches" },
  { id: "vtl-network", label: "The network of this lesson" },
  { id: "vtl-vm", label: "Virtual machines and hypervisors" },
  { id: "vtl-vswitch", label: "The virtual switch" },
  { id: "vtl-containers", label: "Containers" },
  { id: "vtl-vrf", label: "VRFs" },
  { id: "vtl-cloud", label: "Where you meet virtualization" },
  { id: "vtl-incident", label: "The incident" },
  { id: "vtl-fix", label: "Repair and prove it" },
  { id: "vtl-glossary", label: "Glossary" },
  { id: "vtl-recap", label: "Recap" },
];

function HostDiagram() {
  return (
    <DiagramSvg h={230} label="HOST1 with VM-WEB and VM-APP on a virtual switch, port groups WEB VLAN 10 and DB VLAN 20, uplink trunk to the ToR switch and router R1">
      <DRegion x={20} y={20} w={300} h={190} label="HOST1 (hypervisor)" color={D.violet} />
      <DNode x={90} y={70} label="VM-WEB" sub={VM["VM-WEB"].ip} w={100} accent={D.success} />
      <DNode x={230} y={70} label="VM-APP" sub={VM["VM-APP"].ip} w={100} accent={D.success} />
      <DNode x={160} y={150} label="vSwitch" sub="WEB = VLAN 10 · DB = VLAN 20" w={220} accent={D.violet} />
      <DLink x1={90} y1={92} x2={130} y2={128} label="vNIC" />
      <DLink x1={230} y1={92} x2={190} y2={128} label="vNIC" />
      <DNode x={430} y={150} label="TOR" sub="trunk 10, 20" w={90} accent={D.eth} />
      <DNode x={570} y={150} label="R1" sub="10.10.10.1 · 10.20.20.1" w={110} accent={D.ip} />
      <DLink x1={270} y1={150} x2={385} y2={150} label="vmnic0 · 802.1Q" />
      <DLink x1={475} y1={150} x2={515} y2={150} />
    </DiagramSvg>
  );
}

export function DensityTable() {
  return (
    <FieldTable
      title={`Computed for one ${HOST_CAPACITY.ramGb} GB host (${HOST_CAPACITY.reservedGb} GB kept for the hypervisor/host)`}
      columns={["Instance", "Memory each", "Fits", "Starts in"]}
      rows={(["vm", "container"] as const).map((k) => [FOOTPRINT[k].label, `${FOOTPRINT[k].ramGb} GB (${FOOTPRINT[k].note})`, <Mono key="n">{fits(k)}</Mono>, `~${FOOTPRINT[k].bootSeconds} s`])}
    />
  );
}

export function VirtLessonGuideContent() {
  const s = createVirtState();
  const a = vrfLookup("Gi0/1.100", "10.0.0.10");
  const b = vrfLookup("Gi0/2.200", "10.0.0.10");
  return (
    <>
      <GuideSection id="vtl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>
          Most servers you will ever connect are virtual. This lesson follows a VM&apos;s first frame through a virtual switch and a physical one, compares VMs with containers, shows one router serving two customers with the same
          addresses, and fixes a website that went dark the moment its VM moved to another host.
        </p>
        <Callout tone="violet" title="CCNA 1.12">Explain virtualization fundamentals: server virtualization, containers and VRFs.</Callout>
      </GuideSection>

      <GuideSection id="vtl-network" eyebrow="Topology" title="The network of this lesson">
        <DiagramFrame caption="The first switch a VM's frame meets is software inside the host.">
          <HostDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vtl-vm" eyebrow="VMs" title="Virtual machines and hypervisors">
        <CompareCards
          items={[
            { title: "Type 1 (bare-metal)", tone: "violet", tag: "servers", points: ["Runs directly on hardware", "ESXi, Hyper-V, KVM", "The data-center norm"] },
            { title: "Type 2 (hosted)", tone: "cyan", tag: "desktops and labs", points: ["Runs as an app on a desktop OS", "VirtualBox, VMware Workstation", "Convenient, slower"] },
          ]}
        />
        <p>Each VM gets virtual CPUs, memory, disks and NICs and runs its own operating system. The hypervisor can also move a running VM to another host (live migration) — memory copied across while it runs, IP and MAC unchanged.</p>
      </GuideSection>

      <GuideSection id="vtl-vswitch" eyebrow="vSwitch" title="The virtual switch">
        <p>
          A vNIC plugs into a <strong>port group</strong> on the host&apos;s virtual switch. The port group, not the VM, decides the VLAN: frames leave the host&apos;s physical uplink tagged with it. VMs on the same host and port
          group are switched inside the host — the model says VM-WEB ↔ VM-APP is &ldquo;{vmPath(s, "VM-WEB", "VM-APP")}&rdquo;, VM-WEB ↔ VM-DB is &ldquo;{vmPath(s, "VM-WEB", "VM-DB")}&rdquo;.
        </p>
        <KnowledgeCheck
          label="Check"
          question={{
            id: "vtl-k1",
            prompt: "The physical switch port facing a hypervisor host carries VMs in VLANs 10 and 20. How must it be configured?",
            options: [
              { id: "trunk", label: "As an 802.1Q trunk allowing VLANs 10 and 20" },
              { id: "access10", label: "As an access port in VLAN 10" },
              { id: "routed", label: "As a routed port" },
            ],
            correctId: "trunk",
            explanation: "The host's uplink carries frames from many port groups, each tagged with its VLAN — exactly what a trunk is for.",
          }}
        />
      </GuideSection>

      <GuideSection id="vtl-containers" eyebrow="Containers" title="Containers">
        <DensityTable />
        <p>
          A container packages an application with its libraries and runs it as an isolated process on the host&apos;s kernel. Containers sit on a private bridge network inside the host (for example 172.17.0.0/16); publishing a port
          (host :8080 → container :80) is NAT. Orchestrators such as Kubernetes schedule thousands of them across many hosts.
        </p>
      </GuideSection>

      <GuideSection id="vtl-vrf" eyebrow="VRFs" title="VRFs">
        <FieldTable
          title="The same destination, looked up in two VRFs"
          columns={["Arrives on", "VRF", "Route used for 10.0.0.10", "Out"]}
          rows={[
            ["Gi0/1.100", a.vrf, a.route?.prefix ?? "—", a.route?.iface ?? "—"],
            ["Gi0/2.200", b.vrf, b.route?.prefix ?? "—", b.route?.iface ?? "—"],
          ]}
        />
        <p>Each VRF has its own interfaces, routing table and forwarding table. Default routes differ too: CUST-A via {VRF_TABLES["CUST-A"][1].via}, CUST-B via {VRF_TABLES["CUST-B"][1].via}. VRFs are how providers build MPLS VPNs and how data centers separate tenants.</p>
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "vrf definition CUST-A", output: " address-family ipv4\ninterface GigabitEthernet0/1.100\n vrf forwarding CUST-A\n ip address 10.0.0.1 255.255.255.0\n!\nR1# show ip route vrf CUST-A" }}
          junos={{ prompt: "admin@R1# ", command: "set routing-instances CUST-A instance-type virtual-router", output: "set routing-instances CUST-A interface ge-0/0/1.100\nset interfaces ge-0/0/1 unit 100 family inet address 10.0.0.1/24\n\nadmin@R1> show route table CUST-A.inet.0" }}
        />
      </GuideSection>

      <GuideSection id="vtl-cloud" eyebrow="Context" title="Where you meet virtualization">
        <CompareCards
          items={[
            { title: "IaaS", tone: "cyan", tag: "you run the OS", points: ["Cloud VMs, virtual networks", "AWS EC2, Azure VMs"] },
            { title: "PaaS", tone: "violet", tag: "you run the app", points: ["Managed runtimes, databases", "Provider runs the OS"] },
            { title: "SaaS", tone: "success", tag: "you use the app", points: ["Email, CRM, collaboration", "Provider runs everything"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>VM-WEB is live-migrated from HOST1 to HOST2. It keeps its IP and MAC, but HOST2&apos;s port group named WEB was built with VLAN 20. VM-WEB&apos;s ARPs for 10.10.10.1 now flood VLAN 20, where nobody answers.</p>
        <TroubleshootingFlow
          steps={[
            { question: "Is the VM running with the right IP?", look: "The VM console / guest OS." },
            { question: "Which port group and VLAN is its vNIC in, on this host?", look: "The host's virtual switch configuration." },
            { question: "Does the physical trunk carry that VLAN?", look: <><Mono>show interfaces trunk</Mono> on the ToR switch.</> },
            { question: "Does the gateway see the VM's MAC in the right VLAN?", look: <><Mono>show mac address-table address {VM["VM-WEB"].mac}</Mono></> },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtl-fix" eyebrow="Repair" title="Repair and prove it" tone="success">
        <p>Setting HOST2&apos;s WEB port group to VLAN 10 puts VM-WEB back in its subnet: the next ARP is tagged 10, R1 answers. Distributed virtual switches exist to make port groups identical on every host automatically.</p>
      </GuideSection>

      <GuideSection id="vtl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Hypervisor", def: "Software that shares hardware between virtual machines." },
            { term: "vNIC / vSwitch", def: "A VM's virtual network card / the software switch inside the host." },
            { term: "Port group", def: "A set of vSwitch ports with the same settings, including the VLAN." },
            { term: "Container", def: "An isolated application process sharing the host's kernel." },
            { term: "VRF", def: "Virtual routing and forwarding: a separate routing table on the same router." },
            { term: "vMotion / live migration", def: "Moving a running VM between hosts without shutting it down." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vtl-recap" eyebrow="Recap" title="Recap" tone="success">
        <ul className="list-disc space-y-1 pl-5">
          <li>VMs: own OS on shared hardware. Containers: shared kernel, far denser.</li>
          <li>The vSwitch port group decides a VM&apos;s VLAN; host uplinks are trunks.</li>
          <li>VRFs give one router many independent routing tables.</li>
          <li>A migrated VM keeps its addresses but takes the new host&apos;s port group.</li>
        </ul>
      </GuideSection>
    </>
  );
}
