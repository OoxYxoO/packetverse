import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_VLAN, SWITCH_PORTS, TRUNK_PORT, VLAN_MAC, hostAttach, vlanFdbRows, type VlanDevice, type VlanHost, type VlanState } from "@/lib/sim-engine/scenarios/vlanFundamentals";

type Table = { title: string; rows: { label: string; value: string }[] };

export function vlanTables(device: VlanDevice, s: VlanState): Table[] {
  if (device === "SW1" || device === "SW2") {
    return [
      { title: "Ports", rows: SWITCH_PORTS[device].map((p) => ({ label: p.port, value: p.mode === "access" ? `access VLAN ${p.vlan} → ${p.peer}` : `trunk → ${p.peer} · allowed ${s.allowed[device].join(", ") || "none"}` })) },
      { title: "FDB (per VLAN)", rows: vlanFdbRows(s, device) },
    ];
  }
  const h = device as VlanHost;
  const at = hostAttach(h);
  return [{ title: "Host", rows: [{ label: "MAC", value: VLAN_MAC[h] }, { label: "Connected to", value: `${at.sw} ${at.port}` }, { label: "VLAN (switch-assigned)", value: `${HOST_VLAN[h]}` }, { label: "Frames", value: "untagged" }] }];
}

export function explainVlan(s: VlanState, id: string, stepId: string): NodeExplanation {
  const device = id as VlanDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = vlanTables(device, s);
  if (device === "SW1" || device === "SW2") {
    const missing = [10, 20].filter((v) => !s.allowed[device].includes(v));
    return {
      id,
      name: device,
      deviceType: "802.1Q VLAN-aware switch",
      role: "Bridges frames within each VLAN; tags on the trunk, untagged on access ports",
      currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
      controlPlaneRole: `Knows: access ports ${SWITCH_PORTS[device]
        .filter((p) => p.mode === "access")
        .map((p) => `${p.port}=VLAN ${p.vlan}`)
        .join(", ")}; trunk ${TRUNK_PORT} allows ${s.allowed[device].join(", ") || "none"}. FDB entries are per (VLAN, MAC).`,
      dataPlaneRole: hop ? `Received: ${hop.input}. Lookup: ${hop.lookupKey} → ${hop.lookupResult}. Sent: ${hop.output}.` : "Classifies on ingress, learns and looks up within that VLAN, floods only to that VLAN's ports, and adds or removes the 802.1Q tag per egress port.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: missing.length ? `${TRUNK_PORT} does not carry VLAN ${missing.join(", ")}, although the link is up.` : undefined,
      tables,
    };
  }
  const h = device as VlanHost;
  return {
    id,
    name: h,
    deviceType: "End host",
    role: `In VLAN ${HOST_VLAN[h]} because of its switch port, not its own configuration`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: `Knows only its MAC ${VLAN_MAC[h]}. It never sees or sends an 802.1Q tag.`,
    dataPlaneRole: hop ? `Result: ${hop.output}.` : `Receives only frames flooded or forwarded within VLAN ${HOST_VLAN[h]}.`,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
