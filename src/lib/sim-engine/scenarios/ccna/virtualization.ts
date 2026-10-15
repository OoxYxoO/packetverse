import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Virtualization Fundamentals (CCNA 1.12). Two hypervisor hosts with virtual switches, a top-of-rack switch, a
 * container host, and a router that serves two customers with the same address space using VRFs.
 *
 * Modeled:
 * - Virtual switching: a VM's vNIC sits in a port group; the port group's VLAN decides the 802.1Q tag on the host's
 *   uplink. Two VMs on the same host and port group are switched inside the host — the frame never reaches a cable.
 * - Density: what fits on one 64 GB / 32-core host as VMs (each with its own OS) versus containers (sharing the host
 *   kernel) — computed from per-instance footprints.
 * - Container port publishing: host:8080 → container:80 through the host's NAT table.
 * - VRFs: one routing table per VRF; the ingress interface's VRF decides which table a packet is looked up in, so two
 *   customers can both use 10.0.0.0/24.
 * - Live migration (vMotion): the VM keeps its IP and MAC; the destination host's port group decides its VLAN.
 */

export type HostId = "HOST1" | "HOST2";
export type VmId = "VM-WEB" | "VM-APP" | "VM-DB";
export interface VirtState extends KitBase {
  vmHost: Record<VmId, HostId>;
  vmPg: Record<VmId, string>;
  /** Port group → VLAN on each host's virtual switch. */
  portGroups: Record<HostId, Record<string, number>>;
  /** The gateway's ARP cache (IP → MAC) as seen on its VLAN 10 interface. */
  gwArp: Record<string, string>;
  nat: string[];
  migrated: boolean;
}
export const VM = {
  "VM-WEB": { ip: "10.10.10.21", mac: "00:50:56:9a:10:21", vlan: 10 },
  "VM-APP": { ip: "10.10.10.22", mac: "00:50:56:9a:10:22", vlan: 10 },
  "VM-DB": { ip: "10.20.20.31", mac: "00:50:56:9a:20:31", vlan: 20 },
} as const;
export const GW = { v10: "10.10.10.1", v20: "10.20.20.1", mac10: "00:1e:bd:0a:00:01", mac20: "00:1e:bd:14:00:01" } as const;
export function createVirtState(): VirtState {
  return {
    ...kitBase(),
    vmHost: { "VM-WEB": "HOST1", "VM-APP": "HOST1", "VM-DB": "HOST2" },
    vmPg: { "VM-WEB": "WEB", "VM-APP": "WEB", "VM-DB": "DB" },
    portGroups: { HOST1: { WEB: 10, DB: 20 }, HOST2: { WEB: 10, DB: 20 } },
    gwArp: {},
    nat: [],
    migrated: false,
  };
}
export const vlanOf = (s: VirtState, vm: VmId) => s.portGroups[s.vmHost[vm]][s.vmPg[vm]];
/** Where a frame between two VMs is switched: inside one host's vSwitch, across the ToR, or nowhere (different VLANs need a router). */
export function vmPath(s: VirtState, a: VmId, b: VmId): "inside host" | "via ToR" | "via router" {
  if (vlanOf(s, a) !== vlanOf(s, b)) return "via router";
  return s.vmHost[a] === s.vmHost[b] ? "inside host" : "via ToR";
}

// ---------------------------------------------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------------------------------------------
export const HOST_CAPACITY = { ramGb: 64, cores: 32, reservedGb: 4 };
export const FOOTPRINT = {
  vm: { label: "VM (own guest OS)", ramGb: 2 + 2, bootSeconds: 45, note: "2 GB app + 2 GB guest OS" },
  container: { label: "Container (shares host kernel)", ramGb: 0.25 + 0.05, bootSeconds: 1, note: "250 MB app + 50 MB runtime" },
};
export const fits = (k: keyof typeof FOOTPRINT) => Math.floor((HOST_CAPACITY.ramGb - HOST_CAPACITY.reservedGb) / FOOTPRINT[k].ramGb);

// ---------------------------------------------------------------------------------------------------------------
// VRFs
// ---------------------------------------------------------------------------------------------------------------
export interface VrfRoute {
  prefix: string;
  via: string;
  iface: string;
}
export const VRF_TABLES: Record<string, VrfRoute[]> = {
  "CUST-A": [{ prefix: "10.0.0.0/24", via: "connected", iface: "Gi0/1.100" }, { prefix: "0.0.0.0/0", via: "198.51.100.1", iface: "Gi0/3.100" }],
  "CUST-B": [{ prefix: "10.0.0.0/24", via: "connected", iface: "Gi0/2.200" }, { prefix: "0.0.0.0/0", via: "203.0.113.1", iface: "Gi0/3.200" }],
  global: [{ prefix: "10.10.10.0/24", via: "connected", iface: "Gi0/0.10" }, { prefix: "10.20.20.0/24", via: "connected", iface: "Gi0/0.20" }],
};
export const IFACE_VRF: Record<string, string> = { "Gi0/1.100": "CUST-A", "Gi0/2.200": "CUST-B", "Gi0/0.10": "global", "Gi0/0.20": "global" };
const ipToInt = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export function vrfLookup(ingress: string, dst: string): { vrf: string; route?: VrfRoute } {
  const vrf = IFACE_VRF[ingress];
  const best = VRF_TABLES[vrf]
    .map((r) => {
      const [p, len] = r.prefix.split("/");
      const l = Number(len);
      const mask = l === 0 ? 0 : (0xffffffff << (32 - l)) >>> 0;
      return { r, l, hit: ((ipToInt(dst) & mask) >>> 0) === ((ipToInt(p) & mask) >>> 0) };
    })
    .filter((x) => x.hit)
    .sort((a, b) => b.l - a.l)[0];
  return { vrf, route: best?.r };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
const C = { eth: "#94a3b8", tag: "#f472b6", ip: "#60a5fa", arp: "#f59e0b", tcp: "#34d399" };
const frame = (id: string, from: string, to: string, src: string, dst: string, srcIp: string, dstIp: string, vlan?: number): PacketVisual =>
  packet(id, "ETHERNET", from, to, vlan ? `802.1Q ${vlan}` : "FRAME", `Ethernet${vlan ? ` · VLAN ${vlan}` : ""} · ${srcIp} → ${dstIp}`, [
    layer("Ethernet II Header", C.eth, [["Destination MAC", dst], ["Source MAC", src]]),
    ...(vlan ? [layer("802.1Q Tag", C.tag, [["VLAN ID", String(vlan)], ["Priority", "0"]])] : []),
    layer("IPv4 Header", C.ip, [["Source IP", srcIp], ["Destination IP", dstIp], ["TTL", "64"]]),
  ]);
const arpReq = (id: string, from: string, to: string, vlan: number): PacketVisual =>
  packet(id, "ARP", from, to, `ARP · VLAN ${vlan}`, `ARP who-has ${GW.v10}? tell ${VM["VM-WEB"].ip} · VLAN ${vlan}`, [
    layer("Ethernet II Header", C.eth, [["Destination MAC", "ff:ff:ff:ff:ff:ff"], ["Source MAC", VM["VM-WEB"].mac]]),
    layer("802.1Q Tag", C.tag, [["VLAN ID", String(vlan)]]),
    layer("ARP", C.arp, [["Operation", "1 (request)"], ["Sender IP", VM["VM-WEB"].ip], ["Target IP", GW.v10]]),
  ], true);

export const ST = {
  vm: [{ id: "app", label: "Guest OS builds the packet" }, { id: "vnic", label: "vNIC hands the frame to the vSwitch" }],
  vswitch: [{ id: "rx", label: "Receive from vNIC (port group)" }, { id: "local", label: "Destination VM on this host?" }, { id: "tag", label: "Tag with the port group's VLAN" }, { id: "uplink", label: "Send on the physical uplink (trunk)" }],
  tor: [{ id: "rx", label: "Receive on trunk" }, { id: "vlan", label: "VLAN from the 802.1Q tag" }, { id: "fwd", label: "Forward within that VLAN" }],
  router: [{ id: "rx", label: "Receive on sub-interface" }, { id: "vrf", label: "Which VRF is this interface in?" }, { id: "lookup", label: "Look up in that VRF's table" }, { id: "tx", label: "Forward" }],
  ctr: [{ id: "rx", label: "Receive on host :8080" }, { id: "nat", label: "Port publish: :8080 → container :80" }, { id: "deliver", label: "Deliver to the container (shared kernel)" }],
} satisfies Record<string, ProcessingStage[]>;

export const VIRT_REPAIR_OPTIONS = [
  { id: "pg-vlan", label: "Set HOST2's WEB port group to VLAN 10, matching HOST1" },
  { id: "readdress", label: "Re-address VM-WEB into 10.20.20.0/24" },
  { id: "reboot", label: "Reboot VM-WEB" },
  { id: "gw-route", label: "Add a static route for 10.10.10.21 on the gateway" },
];
export const VIRT_REPAIR_CORRECT = "pg-vlan";

type Step = ScenarioStep<VirtState>;

function webToGateway(id: string): (s: VirtState) => VirtState {
  return (s) => {
    const host = s.vmHost["VM-WEB"];
    const vlan = vlanOf(s, "VM-WEB");
    const p = arpReq(`${id}-arp`, host, "TOR", vlan);
    const ok = vlan === VM["VM-WEB"].vlan;
    const n = acted(s, hop({ stepId: id, device: host, stages: withDetail(ST.vswitch, { rx: `VM-WEB · port group ${s.vmPg["VM-WEB"]}`, tag: `port group ${s.vmPg["VM-WEB"]} = VLAN ${vlan}`, uplink: "vmnic0 → TOR (trunk)" }), activeStageId: "tag", ingressInterfaceId: "VM-WEB vNIC", egressInterfaceId: "vmnic0", lookupType: "Port group", lookupKey: s.vmPg["VM-WEB"], lookupResult: `VLAN ${vlan}`, action: `TAG VLAN ${vlan}`, reason: "The VM knows nothing about VLANs. The port group its vNIC is attached to decides the tag on the host's uplink.", input: `ARP from VM-WEB for ${GW.v10}`, output: p.summary, nextHopId: "TOR", before: stackOf(p) }), p, `${host}: tagged VLAN ${vlan}`);
    return ok ? { ...n, gwArp: { ...n.gwArp, [VM["VM-WEB"].ip]: VM["VM-WEB"].mac } } : n;
  };
}

export const virtSteps: Step[] = [
  say("intro", "Many computers in one", "One physical server now runs dozens of servers. Each virtual machine thinks it has its own NIC and its own cable — but those are software, and so is the first switch its traffic meets. Then containers squeeze even more onto a host, and VRFs do the same trick for routers."),
  say("hypervisor", "The hypervisor", "A hypervisor shares one server's CPUs, memory, disks and NICs between virtual machines. Each VM gets virtual hardware — vCPUs, vRAM, a virtual disk, vNICs — and runs its own complete operating system.", {
    question: q("A data-center host runs ESXi directly on the hardware, with no operating system underneath. What kind of hypervisor is that?", [["t1", "Type 1 (bare-metal)"], ["t2", "Type 2 (hosted)"], ["container", "A container runtime"]], "t1", "Type 1 hypervisors (ESXi, Hyper-V, KVM) run on the hardware itself — the norm for servers. Type 2 hypervisors (VirtualBox, Workstation) run as an application on a desktop OS — fine for labs."),
  }),
  act("vm-sends", "VM-WEB talks to its gateway", `VM-WEB (${VM["VM-WEB"].ip}) needs its gateway ${GW.v10}. It ARPs, exactly as a physical server would. The frame leaves its vNIC into HOST1's virtual switch.`, (s) => {
    const p = packet("vm-arp", "ARP", "VM-WEB", "HOST1", "ARP", `ARP who-has ${GW.v10}? tell ${VM["VM-WEB"].ip}`, [layer("Ethernet II Header", C.eth, [["Destination MAC", "ff:ff:ff:ff:ff:ff"], ["Source MAC", VM["VM-WEB"].mac]]), layer("ARP", C.arp, [["Operation", "1 (request)"], ["Sender IP", VM["VM-WEB"].ip], ["Target IP", GW.v10]])], true);
    return acted(s, hop({ stepId: "vm-sends", device: "VM-WEB", stages: withDetail(ST.vm, { vnic: "vNIC → vSwitch port group WEB" }), activeStageId: "vnic", egressInterfaceId: "eth0", lookupType: "ARP cache", lookupKey: GW.v10, lookupResult: "miss → ARP request", action: "ARP", reason: "Inside the VM, networking is ordinary: an OS, an IP stack, a NIC driver. The NIC just happens to be virtual.", input: `ping ${GW.v10}`, output: p.summary, nextHopId: "HOST1", before: stackOf(p) }), p, "untagged from the VM");
  }),
  act("vswitch-tags", "The virtual switch tags it", "HOST1's vSwitch receives the frame on port group WEB, which is VLAN 10. It's a broadcast, so it goes to the other WEB members on this host and out the physical uplink to the top-of-rack switch — tagged VLAN 10.", webToGateway("vswitch-tags"), "PACKET_SENT"),
  act("tor-forwards", "The ToR switch forwards in VLAN 10", "The top-of-rack switch reads the tag, floods the ARP in VLAN 10, and the gateway R1 answers. To the physical network, VM-WEB is just another MAC address on a trunk port.", (s) => {
    const p = frame("gw-reply", "R1", "TOR", GW.mac10, VM["VM-WEB"].mac, GW.v10, VM["VM-WEB"].ip, 10);
    return acted(s, hop({ stepId: "tor-forwards", device: "TOR", stages: withDetail(ST.tor, { vlan: "VLAN 10", fwd: "flood in VLAN 10 → R1 answers" }), activeStageId: "fwd", ingressInterfaceId: "Eth1/1", egressInterfaceId: "Eth1/48", lookupType: "MAC table (VLAN 10)", lookupKey: VM["VM-WEB"].mac, lookupResult: "learned on Eth1/1 (HOST1)", action: "FORWARD", reason: "Physical switches learn VM MACs on the host-facing trunk, per VLAN, like any other MAC.", input: "ARP request VLAN 10", output: "ARP reply from R1", nextHopId: "R1", before: stackOf(p) }), p, "R1 answers in VLAN 10");
  }),
  say("east-west", "Two VMs, one host", "VM-WEB now talks to VM-APP, its neighbour on the same host and port group.", {
    question: q("Does the frame between VM-WEB and VM-APP cross the physical cable to the ToR switch?", [["no", "No — the vSwitch delivers it inside HOST1"], ["yes", "Yes — every frame goes out to the physical switch"], ["router", "It goes to the router first"]], "no", `Same host, same port group, same VLAN: the model says "${vmPath(createVirtState(), "VM-WEB", "VM-APP")}". Traffic between them never appears on a physical port — which matters for monitoring and for security policy, which must be applied in the virtual layer.`),
  }),
  act("containers", "Containers: share the kernel", `A container host runs applications in containers. Each container has its own filesystem, processes and network namespace, but they all share the host's kernel — no guest OS each. On a 64 GB host that means about ${fits("vm")} VMs or ${fits("container")} containers of the same app.`, (s) => {
    const p = packet("ctr-req", "TCP", "CLIENT", "CTR-HOST", "TCP SYN", "TCP · 10.30.30.50:51200 → 10.40.40.5:8080", [layer("IPv4 Header", C.ip, [["Source IP", "10.30.30.50"], ["Destination IP", "10.40.40.5"]]), layer("TCP Header", C.tcp, [["Source Port", "51200"], ["Destination Port", "8080"], ["Flags", "SYN"]])]);
    const n = acted(s, hop({ stepId: "containers", device: "CTR-HOST", stages: withDetail(ST.ctr, { nat: "10.40.40.5:8080 → 172.17.0.2:80 (web container)", deliver: "web container · shared kernel" }), activeStageId: "nat", ingressInterfaceId: "eth0", lookupType: "Port publishing (NAT)", lookupKey: "tcp/8080", lookupResult: "172.17.0.2:80", action: "DNAT → container", reason: "Containers sit on a private bridge network inside the host; publishing a port maps a host port to a container port with NAT.", input: p.summary, output: "→ 172.17.0.2:80", before: stackOf(p), mutations: [{ type: "DA_CHANGE", detail: "10.40.40.5:8080 → 172.17.0.2:80" }] }), p, ":8080 → web:80");
    return { ...n, nat: ["tcp 10.40.40.5:8080 → 172.17.0.2:80 (web)"] };
  }, "PACKET_SENT", q("What do containers on one host share that VMs on one host do not?", [["kernel", "The operating-system kernel"], ["nic", "A physical NIC"], ["cpu", "The CPU"], ["nothing", "Nothing — they're identical to VMs"]], "kernel", "VMs share the hardware but each runs its own OS. Containers share the host's kernel, so they start in about a second and need a fraction of the memory — but they must all run on that kernel's OS type.")),
  act("vrf", "VRFs: virtual routers", "R1 also serves two customers, and both use 10.0.0.0/24. A VRF (virtual routing and forwarding instance) gives each its own routing table. A packet from CUST-A for 10.0.0.10 is looked up only in VRF CUST-A.", (s) => {
    const r = vrfLookup("Gi0/1.100", "10.0.0.10");
    const p = packet("vrf-a", "IP", "CUST-A", "R1", "IPv4", "IPv4 · 10.0.0.5 → 10.0.0.10 · from CUST-A", [layer("IPv4 Header", C.ip, [["Source IP", "10.0.0.5"], ["Destination IP", "10.0.0.10"], ["TTL", "64"]])]);
    return acted(s, hop({ stepId: "vrf", device: "R1", stages: withDetail(ST.router, { vrf: `Gi0/1.100 → VRF ${r.vrf}`, lookup: `${r.route?.prefix} ${r.route?.via} ${r.route?.iface}` }), activeStageId: "lookup", ingressInterfaceId: "Gi0/1.100", egressInterfaceId: r.route?.iface, lookupType: `VRF ${r.vrf} routing table`, lookupKey: "10.0.0.10", lookupResult: `${r.route?.prefix} · ${r.route?.iface}`, action: `ROUTE in ${r.vrf}`, reason: "The ingress interface's VRF chooses the table. The same address in another VRF is a different destination.", input: p.summary, output: `→ ${r.route?.iface}`, before: stackOf(p) }), p, `VRF ${r.vrf} → ${r.route?.iface}`);
  }, "PACKET_SENT", q("A packet from CUST-B for the same 10.0.0.10 arrives on Gi0/2.200. Where does R1 send it?", [["b", "Out Gi0/2.200 — VRF CUST-B's own 10.0.0.0/24"], ["a", "To CUST-A's network, the first 10.0.0.0/24 configured"], ["drop", "R1 drops it as a duplicate address"]], "b", `Gi0/2.200 is in VRF CUST-B, so R1 searches only that table: ${(() => { const r = vrfLookup("Gi0/2.200", "10.0.0.10"); return `${r.route?.prefix} → ${r.route?.iface}`; })()}. The two customers never see each other's routes — the basis of MPLS VPNs and multi-tenant data centers.`)),
  // incident
  act("fault-injected", "Maintenance on HOST1", "HOST1 needs a firmware update, so VM-WEB is live-migrated (vMotion) to HOST2. Its memory is copied across while it runs; it keeps its IP and MAC. HOST2's virtual switch was built by hand last year.", (s) => ({ ...s, vmHost: { ...s.vmHost, "VM-WEB": "HOST2" }, portGroups: { ...s.portGroups, HOST2: { WEB: 20, DB: 20 } }, gwArp: {}, migrated: true, faultActive: true, packet: undefined, flood: [], decision: { device: "HOST2", text: "VM-WEB running · vNIC on port group WEB" } }), "STEP_ENTERED"),
  act("inc-arp", "VM-WEB can't reach its gateway", `VM-WEB's ARP cache times out and it ARPs for ${GW.v10} again. HOST2's vSwitch sends the request out its uplink.`, webToGateway("inc-arp"), "PACKET_SENT"),
  act("inc-silence", "No answer", "The ToR switch floods the ARP — in VLAN 20. R1's VLAN 20 interface is 10.20.20.1; nobody in VLAN 20 owns 10.10.10.1, so nobody answers. The website is down.", (s) => {
    const vlan = vlanOf(s, "VM-WEB");
    return acted(s, hop({ stepId: "inc-silence", device: "TOR", stages: withDetail(ST.tor, { vlan: `VLAN ${vlan}`, fwd: `flood in VLAN ${vlan} — no reply` }), activeStageId: "fwd", ingressInterfaceId: "Eth1/2", lookupType: `MAC table (VLAN ${vlan})`, lookupKey: "ff:ff:ff:ff:ff:ff", lookupResult: `flood VLAN ${vlan}`, action: "FLOOD — NO REPLY", reason: "The tag decides the VLAN; the VLAN decides who hears the broadcast.", input: `ARP who-has ${GW.v10} · VLAN ${vlan}`, output: "no ARP reply" }), undefined, `VLAN ${vlan}: nobody owns ${GW.v10}`);
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "VM-WEB is running, its IP settings are unchanged and its vNIC shows connected. It worked minutes ago on HOST1.", {
    question: q("What is the most likely cause?", [["pg", "HOST2's WEB port group puts VM-WEB in a different VLAN than HOST1's did"], ["ip", "vMotion changed VM-WEB's IP address"], ["mac", "VM-WEB's MAC address changed during migration"], ["r1", "R1's VLAN 10 interface went down"]], "pg", "A migrated VM keeps its IP and MAC; what changes is which virtual switch it plugs into. HOST2's port group named WEB is tagged VLAN 20, so VM-WEB's frames land in the DB VLAN. Port groups must match on every host a VM can move to. R1 still answers VM-APP on VLAN 10.", ["What travels with the VM in a live migration?", "What decides the VLAN tag?", "Compare the port group on both hosts."]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up in a virtual network: the VM, its vNIC and port group, the host's port-group VLAN, the uplink trunk, the physical switch's VLAN, then ARP to the gateway."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", VIRT_REPAIR_CORRECT, (s) => ({ ...s, portGroups: { ...s.portGroups, HOST2: { WEB: 10, DB: 20 } }, decision: { device: "HOST2", text: "port group WEB = VLAN 10" } })),
  act("verify", "VM-WEB is back", "VM-WEB's next ARP leaves HOST2 tagged VLAN 10; R1 answers; the website responds. Any VM can now move between HOST1 and HOST2 without changing networks.", webToGateway("verify"), "PACKET_RECEIVED"),
  say("complete", "Virtualization", "Hypervisors share hardware between VMs with their own OS; containers share a kernel for density; virtual switches put VMs into VLANs through port groups; VRFs give one router many independent routing tables. And a migrated VM keeps its addresses but takes the destination host's port group."),
];
