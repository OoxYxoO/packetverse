import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const VIRT_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Virtual machines", tone: "cyan" }, objective: "See what a hypervisor gives each VM.", steps: ["intro", "hypervisor"] },
  { phase: { label: "Virtual switching", tone: "violet" }, objective: "Follow a VM's frame through the virtual and physical switch.", steps: ["vm-sends", "vswitch-tags", "tor-forwards", "east-west"] },
  { phase: { label: "Containers", tone: "tcp" }, objective: "Compare a container with a VM.", steps: ["containers"] },
  { phase: { label: "VRFs", tone: "ip" }, objective: "One router, two customers, the same addresses.", steps: ["vrf"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "VM-WEB moves to another host during maintenance.", steps: ["fault-injected", "inc-arp", "inc-silence"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove VM-WEB reaches its gateway from HOST2.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "VMs, containers, virtual switches and VRFs.", steps: ["complete"] },
];

export const VIRT_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "vm-sends": { takeaway: "Inside a VM, networking is ordinary." },
  "vswitch-tags": { takeaway: "The port group decides the VLAN, not the VM." },
  "tor-forwards": { takeaway: "To the physical switch, a VM is just a MAC on a trunk." },
  "fault-injected": { doingNow: "A live migration: same IP, same MAC, new host." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Port groups must match on every host a VM can move to." },
};
