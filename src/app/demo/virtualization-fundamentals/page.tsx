"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { GW, ST, VIRT_REPAIR_CORRECT, VIRT_REPAIR_OPTIONS, VM, VRF_TABLES, createVirtState, virtSteps, vlanOf, type HostId, type VirtState, type VmId } from "@/lib/sim-engine/scenarios/ccna/virtualization";
import { VIRT_BRIEFING_NOTES, VIRT_BRIEFING_PHASES } from "./briefing";
import { VirtPanel } from "./VirtPanel";
import { VIRT_LESSON_SECTIONS, VirtLessonGuideContent } from "./LessonGuideContent";
import { VIRT_DEEP_DIVE_SECTIONS, VirtDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Hypervisors and VMs · virtual switches and port groups · containers · VRFs · a migration that broke a website", sections: VIRT_LESSON_SECTIONS, content: <VirtLessonGuideContent /> },
  { id: "deep", label: "Virtualization Deep Dive", hint: "Distributed switches · uplink teaming · container networking · NFV · failure signatures", sections: VIRT_DEEP_DIVE_SECTIONS, content: <VirtDeepDiveContent /> },
];

const vmDevice = (id: VmId): KitDevice<VirtState> => ({
  id,
  deviceType: "Virtual machine",
  role: "A complete server — OS, IP stack, NIC driver — on virtual hardware.",
  stages: ST.vm,
  ports: (s) => [{ id: "eth0", neighbor: s.vmHost[id], neighborLabel: `${s.vmHost[id]} vSwitch · port group ${s.vmPg[id]}`, linkType: "vNIC", ip: `${VM[id].ip}/24`, extra: [["MAC", VM[id].mac]] }],
  knows: (s) => `On ${s.vmHost[id]} · port group ${s.vmPg[id]} · gateway ${VM[id].vlan === 10 ? GW.v10 : GW.v20}`,
});
const hostDevice = (id: HostId): KitDevice<VirtState> => ({
  id,
  deviceType: "Hypervisor host",
  role: "Runs VMs; its virtual switch connects their vNICs to port groups and tags them onto the physical uplink.",
  stages: ST.vswitch,
  ports: (s) => [
    ...(Object.keys(s.vmHost) as VmId[]).filter((v) => s.vmHost[v] === id).map((v) => ({ id: `${v} vNIC`, neighbor: v, linkType: `port group ${s.vmPg[v]} · VLAN ${vlanOf(s, v)}` })),
    { id: "vmnic0", neighbor: "TOR", linkType: "802.1Q trunk" },
  ],
  knows: (s) => Object.entries(s.portGroups[id]).map(([pg, v]) => `${pg}=VLAN ${v}`).join(" · "),
  tables: (s) => [{ title: `${id} port groups`, rows: Object.entries(s.portGroups[id]).map(([pg, v]) => ({ label: pg, value: `VLAN ${v}` })) }],
});

const DEVICES: KitDevice<VirtState>[] = [
  vmDevice("VM-WEB"),
  vmDevice("VM-APP"),
  vmDevice("VM-DB"),
  hostDevice("HOST1"),
  hostDevice("HOST2"),
  { id: "TOR", deviceType: "Top-of-rack switch", role: "Physical switch: trunks to the hosts, VLANs 10 and 20 up to R1.", stages: ST.tor, ports: () => [{ id: "Eth1/1", neighbor: "HOST1", linkType: "trunk 10,20" }, { id: "Eth1/2", neighbor: "HOST2", linkType: "trunk 10,20" }, { id: "Eth1/10", neighbor: "CTR-HOST", linkType: "access" }, { id: "Eth1/48", neighbor: "R1", linkType: "trunk 10,20" }], knows: () => "Learns VM MACs per VLAN on host trunks" },
  {
    id: "R1",
    deviceType: "Router (with VRFs)",
    role: "Gateway for VLANs 10 and 20 in the global table; separate VRFs for CUST-A and CUST-B.",
    stages: ST.router,
    ports: () => [
      { id: "Gi0/0.10", neighbor: "TOR", linkType: "global · VLAN 10", ip: `${GW.v10}/24` },
      { id: "Gi0/0.20", neighbor: "TOR", linkType: "global · VLAN 20", ip: `${GW.v20}/24` },
      { id: "Gi0/1.100", neighbor: "CUST-A", linkType: "VRF CUST-A", ip: "10.0.0.1/24" },
      { id: "Gi0/2.200", neighbor: "CUST-B", linkType: "VRF CUST-B", ip: "10.0.0.1/24" },
    ],
    knows: (s) => `ARP (VLAN 10): ${Object.keys(s.gwArp).join(", ") || "—"}`,
    tables: (s) => [
      ...(["global", "CUST-A", "CUST-B"] as const).map((v) => ({ title: `R1 routes · ${v}`, rows: VRF_TABLES[v].map((r) => ({ label: r.prefix, value: r.via === "connected" ? r.iface : `via ${r.via}` })) })),
      { title: "R1 ARP (VLAN 10)", rows: Object.entries(s.gwArp).map(([ip, mac]) => ({ label: ip, value: mac })) },
    ],
  },
  { id: "CUST-A", deviceType: "Customer site", role: "Uses 10.0.0.0/24.", stages: ST.vm, ports: () => [{ id: "wan", neighbor: "R1", linkType: "VRF CUST-A" }], knows: () => "10.0.0.0/24" },
  { id: "CUST-B", deviceType: "Customer site", role: "Also uses 10.0.0.0/24.", stages: ST.vm, ports: () => [{ id: "wan", neighbor: "R1", linkType: "VRF CUST-B" }], knows: () => "10.0.0.0/24" },
  { id: "CTR-HOST", deviceType: "Container host", role: "Runs containers on one shared kernel; publishes :8080 → web container :80.", stages: ST.ctr, ports: () => [{ id: "eth0", neighbor: "TOR", linkType: "Ethernet", ip: "10.40.40.5/24" }, { id: "docker0", linkType: "bridge 172.17.0.0/16" }], knows: (s) => (s.nat.length ? s.nat.join(" · ") : "web, api, cache containers"), tables: (s) => [{ title: "CTR-HOST port publishing", rows: s.nat.map((n) => ({ label: "NAT", value: n })) }] },
  { id: "CLIENT", deviceType: "Client", role: "Uses the containerised web app.", stages: ST.vm, ports: () => [{ id: "eth0", neighbor: "TOR", linkType: "Ethernet", ip: "10.30.30.50/24" }], knows: () => "browsing :8080" },
];
const adapters = kitAdapters(DEVICES, "virtual pipeline");

const config: FundamentalsLessonConfig<VirtState> = {
  lessonId: "virtualization-fundamentals",
  xp: 150,
  steps: virtSteps,
  createState: createVirtState,
  badge: "CCNA · Network Fundamentals",
  title: "Virtualization Fundamentals",
  intro: "Follow a virtual machine's first frame through its host's virtual switch and onto a physical trunk. Compare VMs with containers, watch one router serve two customers with the same addresses using VRFs — then fix a website that went dark the moment its VM moved hosts.",
  facts: [
    { q: "VM or container?", a: "A VM brings its own OS; a container shares the host kernel." },
    { q: "Who decides a VM's VLAN?", a: "The port group its vNIC is attached to." },
    { q: "Why containers?", a: "Many more instances per host, each starting in about a second." },
    { q: "How can two customers share 10.0.0.0/24?", a: "VRFs: one routing table each, chosen by the ingress interface." },
  ],
  terms: [
    { term: "Hypervisor", expansion: "Virtual machine monitor", meaning: "Shares hardware" },
    { term: "vSwitch", expansion: "Virtual switch", meaning: "Inside the host" },
    { term: "Port group", expansion: "vSwitch port profile", meaning: "Sets the VLAN" },
    { term: "Container", expansion: "Isolated process", meaning: "Shared kernel" },
    { term: "VRF", expansion: "Virtual routing and forwarding", meaning: "Separate route table" },
  ],
  guide: { title: "Virtualization Fundamentals", subtitle: "HOST1 · HOST2 · TOR · R1 (VRFs) · CTR-HOST", tabs: GUIDE_TABS },
  briefing: { phases: VIRT_BRIEFING_PHASES, notes: VIRT_BRIEFING_NOTES },
  nodes: (s) => {
    const web: [number, number] = s.vmHost["VM-WEB"] === "HOST1" ? [8, 52] : [28, 92];
    return [
      { id: "VM-WEB", label: "VM-WEB", subLabel: VM["VM-WEB"].ip, x: web[0], y: web[1], kind: "server" },
      { id: "VM-APP", label: "VM-APP", subLabel: VM["VM-APP"].ip, x: 8, y: 80, kind: "server" },
      { id: "VM-DB", label: "VM-DB", subLabel: VM["VM-DB"].ip, x: 52, y: 92, kind: "server" },
      { id: "HOST1", label: "HOST1", subLabel: "hypervisor", x: 22, y: 64, kind: "server" },
      { id: "HOST2", label: "HOST2", subLabel: "hypervisor", x: 40, y: 72, kind: "server" },
      { id: "TOR", label: "TOR", subLabel: "trunks", x: 52, y: 50, kind: "switch" },
      { id: "R1", label: "R1", subLabel: "gateway · VRFs", x: 72, y: 30, kind: "router" },
      { id: "CUST-A", label: "CUST-A", subLabel: "10.0.0.0/24", x: 92, y: 12, kind: "cloud" },
      { id: "CUST-B", label: "CUST-B", subLabel: "10.0.0.0/24", x: 92, y: 46, kind: "cloud" },
      { id: "CTR-HOST", label: "CTR-HOST", subLabel: "containers", x: 70, y: 76, kind: "server" },
      { id: "CLIENT", label: "CLIENT", x: 90, y: 88, kind: "laptop" },
    ];
  },
  edges: (s) => [
    { id: "web", a: "VM-WEB", b: s.vmHost["VM-WEB"], label: `vNIC · ${s.vmPg["VM-WEB"]}` },
    { id: "app", a: "VM-APP", b: "HOST1", label: "vNIC" },
    { id: "db", a: "VM-DB", b: "HOST2", label: "vNIC" },
    { id: "h1", a: "HOST1", b: "TOR", label: "trunk" },
    { id: "h2", a: "HOST2", b: "TOR", label: "trunk" },
    { id: "r1", a: "TOR", b: "R1", label: "VLAN 10, 20" },
    { id: "ca", a: "R1", b: "CUST-A", label: "VRF A" },
    { id: "cb", a: "R1", b: "CUST-B", label: "VRF B" },
    { id: "ctr", a: "TOR", b: "CTR-HOST" },
    { id: "cl", a: "CLIENT", b: "CTR-HOST" },
  ],
  enterable: ["HOST1", "HOST2", "TOR", "R1", "CTR-HOST"],
  primaryDevice: { "vm-sends": "VM-WEB", "vswitch-tags": "HOST1", "tor-forwards": "TOR", containers: "CTR-HOST", vrf: "R1", "fault-injected": "HOST2", "inc-arp": "HOST2", "inc-silence": "TOR", "diagnostic-layers": "HOST2", "repair-challenge": "HOST2", verify: "HOST2" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <VirtPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "VM-WEB moved to HOST2 and can't reach its gateway. Which change fixes the cause?",
    options: VIRT_REPAIR_OPTIONS,
    correctId: VIRT_REPAIR_CORRECT,
    success: "HOST2's WEB port group is VLAN 10 again — the same as HOST1's. VM-WEB's frames land in its own subnet and R1 answers.",
    wrongFeedback: {
      readdress: "That moves the website into the database subnet to match a configuration mistake — and it would break again when it migrates back.",
      reboot: "The VM was never the problem; it rejoins the same wrong port group after a reboot.",
      "gw-route": "R1 never even sees VM-WEB's frames: they are in VLAN 20, where R1 is 10.20.20.1.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const h = s.vmHost["VM-WEB"];
      const v = vlanOf(s, "VM-WEB");
      return [
        { label: `VM — VM-WEB running on ${h}, ${VM["VM-WEB"].ip}/24`, status: "healthy" },
        { label: "vNIC — connected to port group WEB", status: "healthy" },
        { label: `Port group — ${h} WEB = VLAN ${v} (HOST1 WEB = VLAN ${s.portGroups.HOST1.WEB})`, status: v === VM["VM-WEB"].vlan ? "healthy" : "failing" },
        { label: "Uplink trunk — VLANs 10, 20 allowed", status: "healthy" },
        { label: `ARP to ${GW.v10} — ${s.gwArp[VM["VM-WEB"].ip] ? "answered" : "no reply"}`, status: s.gwArp[VM["VM-WEB"].ip] ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can see the virtual network", message: "VMs and hypervisors, containers on a shared kernel, port groups that put VMs into VLANs, VRFs that give one router many tables — and the rule that every host a VM can move to needs the same port groups." },
};

export default function VirtualizationDemo() {
  return <FundamentalsLessonShell config={config} />;
}
