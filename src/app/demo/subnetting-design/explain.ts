import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_SEG, R1_IFACE, SD_ADDR, describe, maskOf, sdAllocationRows, type SdDevice, type SdState, type SegId } from "@/lib/sim-engine/scenarios/subnettingDesign";

type Table = { title: string; rows: { label: string; value: string }[] };

export function sdTables(device: SdDevice, s: SdState): Table[] {
  const plan: Table = { title: "Address plan", rows: sdAllocationRows(s.plan).map((r) => ({ label: `${r.id} (${r.hosts} hosts)`, value: r.text })) };
  if (device === "R1") {
    return [
      { title: "Connected prefixes", rows: (Object.keys(R1_IFACE) as SegId[]).map((seg) => ({ label: R1_IFACE[seg], value: s.deployed[seg] ? `${s.deployed[seg]!.network}/${s.deployed[seg]!.prefix} (${seg})` : "not configured" })) },
      plan,
    ];
  }
  if (device === "R2") return [{ title: "Interfaces", rows: [{ label: "ge-0/0/0", value: s.deployed.TRANSIT ? `${SD_ADDR["R2:TRANSIT"]}/${s.deployed.TRANSIT.prefix}` : "not configured" }] }];
  const seg = HOST_SEG[device];
  const d = s.deployed[seg];
  if (!d) return [{ title: "Addressing", rows: [{ label: "State", value: "awaiting the address plan" }] }];
  const x = describe(d.network, d.prefix);
  return [
    {
      title: "Addressing",
      rows: [
        { label: "IPv4", value: `${SD_ADDR[device]}/${d.prefix}` },
        { label: "Mask", value: maskOf(d.prefix) },
        { label: "Network", value: `${x.network}/${x.prefix}` },
        { label: "Host range", value: `${x.firstHost} – ${x.lastHost}` },
        { label: "Broadcast", value: x.broadcast },
        { label: "Gateway", value: SD_ADDR[`R1:${seg}` as keyof typeof SD_ADDR] },
      ],
    },
  ];
}

export function explainSd(s: SdState, id: string, stepId: string): NodeExplanation {
  const device = id as SdDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = sdTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "R1") {
    const n = Object.keys(s.deployed).length;
    return {
      id,
      name: "R1",
      deviceType: "IPv4 router (owns the designed prefixes)",
      role: "Gateway for LAN-A, LAN-B and LAN-C; one end of the transit /30",
      currentAction: act,
      controlPlaneRole: n ? `Knows ${n} connected prefixes from the address plan. No routing protocol.` : "Not configured yet — the address plan is still being designed.",
      dataPlaneRole: hop ? `Lookup: ${hop.lookupKey} → ${hop.lookupResult}. Result: ${hop.output}.` : "Forwards between its connected prefixes, decrementing TTL and building a new frame per hop.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: s.faultActive ? "The revised plan's LAN-C overlaps an existing connected prefix." : undefined,
      tables,
    };
  }
  if (device === "R2") {
    return { id, name: "R2", deviceType: "IPv4 router", role: "Far end of the R1 ↔ R2 transit /30", currentAction: act, controlPlaneRole: "Owns the second usable address of the transit /30.", dataPlaneRole: hop ? `Result: ${hop.output}.` : "Answers Echo Requests addressed to itself.", packetBefore: hop?.input, packetAfter: hop?.output, tables };
  }
  const seg = HOST_SEG[device];
  return {
    id,
    name: device,
    deviceType: "IPv4 host",
    role: `${seg} member — needs an address from ${seg}'s prefix`,
    currentAction: act,
    controlPlaneRole: s.deployed[seg] ? `Knows its address, prefix and gateway from the ${seg} allocation.` : "Waiting for the plan to allocate its segment.",
    dataPlaneRole: hop ? `Lookup: ${hop.lookupType} → ${hop.lookupResult}. Result: ${hop.output}.` : "Sends off-link traffic to R1's address on its own segment.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
