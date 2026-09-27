import type { NodeExplanation } from "@/components/network3d/types";
import { ETH_MAC, FDB_AGING_SEC, ethFdbRows, lookup, macName, sw1PortNeighbor, SW1_PORTS, type EthDevice, type EthHost, type EthState } from "@/lib/sim-engine/scenarios/ethernetSwitching";

export function ethTables(device: EthDevice, s: EthState): { title: string; rows: { label: string; value: string }[] }[] {
  if (device === "SW1") {
    return [
      { title: "FDB", rows: ethFdbRows(s, "SW1") },
      { title: "Ports", rows: SW1_PORTS.map((p) => ({ label: p, value: sw1PortNeighbor(s, p) ? `UP → ${sw1PortNeighbor(s, p)}` : "DOWN" })) },
    ];
  }
  if (device === "DESK-SW") {
    return [
      { title: "FDB", rows: ethFdbRows(s, "DESK-SW") },
      { title: "Ports", rows: [{ label: "port 1", value: "UP → SW1 ge-0/0/4" }, { label: "port 2", value: s.hostB === "DESK-SW port 2" ? "UP → HOST-B" : "DOWN (free desk)" }] },
    ];
  }
  const host = device as EthHost;
  return [{ title: "NIC", rows: [{ label: "MAC", value: ETH_MAC[host] }, { label: "Connected to", value: host === "HOST-B" ? s.hostB : host === "HOST-A" ? "SW1 ge-0/0/1" : "SW1 ge-0/0/3" }, { label: "Accepts", value: `${ETH_MAC[host]} and FF:FF:FF:FF:FF:FF` }] }];
}

/** Per-device explanation from the state at the current step: what it knows, what it received, its lookup, and what it sent. */
export function explainEth(s: EthState, id: string, stepId: string): NodeExplanation {
  const device = id as EthDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = ethTables(device, s);
  if (device === "SW1" || device === "DESK-SW") {
    const fdb = s.fdb[device];
    const knows = fdb.length ? fdb.map((e) => `${macName(e.mac)} → ${e.port}`).join(", ") : "no MACs yet";
    const staleB = device === "SW1" && s.faultActive ? lookup(fdb, ETH_MAC["HOST-B"]) : undefined;
    return {
      id,
      name: device,
      deviceType: device === "SW1" ? "Managed Ethernet switch (learning bridge)" : "Unmanaged desk switch (learning bridge)",
      role: "Forwards frames between its ports inside one broadcast domain, using an FDB it builds itself",
      currentAction: hop ? `${hop.action}: ${hop.reason}` : `Idle this step. It knows: ${knows}.`,
      controlPlaneRole: `Knows: ${knows}. Dynamic entries come ONLY from source MACs on ingress and age out after ${FDB_AGING_SEC} s without a refresh.`,
      dataPlaneRole: hop ? `Received: ${hop.input}. Lookup: ${hop.lookupKey} → ${hop.lookupResult}. Sent: ${hop.output}.` : "Looks up each destination MAC: known unicast → one port; unknown unicast or broadcast → every other port. The frame is never modified.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: staleB ? `The entry for HOST-B says ${staleB.port}, but HOST-B is physically on ge-0/0/2 and hasn't sent a frame from there yet.` : undefined,
      tables,
    };
  }
  const host = device as EthHost;
  return {
    id,
    name: host,
    deviceType: "End host (Ethernet NIC)",
    role: `Sends frames with source ${ETH_MAC[host]}; accepts only frames addressed to ${ETH_MAC[host]} or broadcast`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : `Idle this step. Attached to ${host === "HOST-B" ? s.hostB : host === "HOST-A" ? "SW1 ge-0/0/1" : "SW1 ge-0/0/3"}.`,
    controlPlaneRole: `Knows its own MAC ${ETH_MAC[host]}. It does not know or care which switch ports exist.`,
    dataPlaneRole: hop ? `Lookup: ${hop.lookupType} ${hop.lookupKey} → ${hop.lookupResult}. Result: ${hop.output}.` : "Destination-MAC filtering: frames for other MACs (seen during floods) are discarded by the NIC.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
