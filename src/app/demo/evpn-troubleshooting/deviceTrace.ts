import type { DeviceInterfaceData } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  L3_VNI,
  VLAN10,
  VLAN20,
  VNI10010,
  VNI10020,
  VTEP_LOOPBACK,
  type ArenaDeviceId,
  type ArenaLeafId,
  type ArenaState,
} from "@/lib/sim-engine/arena/faultTypes";
import { imetOk, suppressionPresent } from "./evidence";

/**
 * Arena Scene Adapter (brief §33/§36) — converts ArenaState into
 * Device Explorer tab content. Every value here is an observable
 * fact read straight from ArenaState (routes present, sessions up,
 * MTU values, DF beliefs) — never a conclusion, a fault name, or a
 * root-cause sentence. That analysis only ever appears in the
 * post-incident report, generated separately after resolution.
 */

const ROLE_LABEL: Record<string, string> = { primary: "PRIMARY", backup: "BACKUP", ineligible: "Ineligible" };

export function interfacesFor(state: ArenaState, device: ArenaDeviceId): DeviceInterfaceData[] {
  if (device === "SPINE1") {
    return (["LEAF1", "LEAF2", "LEAF3"] as ArenaLeafId[]).map((l) => ({ id: `spine-${l}`, name: `et-0/0/${l.slice(-1)}`, status: "up", neighborId: l, neighborLabel: l, linkType: "Underlay", mtu: 9216, protocols: ["IGP"], role: "idle" }));
  }
  if (device === "LEAF1" || device === "LEAF2" || device === "LEAF3") {
    const uplink: DeviceInterfaceData = { id: `${device}-spine`, name: "et-0/1/0", status: "up", ip: undefined, neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], role: "idle", extra: [{ label: "VTEP", value: VTEP_LOOPBACK[device] }, { label: "Session", value: state.bgpEvpnUp[device] ? "Established" : "Down" }] };
    const access: DeviceInterfaceData[] = [];
    if (device === "LEAF1") access.push({ id: "leaf1-hosta", name: "ge-0/0/0", status: "up", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: `Access (VLAN ${VLAN10})`, mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    if (device === "LEAF1" || device === "LEAF2") access.push({ id: `${device}-servera`, name: "ge-0/0/1", status: state.es.esAttachmentDown === device ? "down" : "up", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: "Access (ESI)", mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    if (device === "LEAF3") access.push({ id: "leaf3-hostb", name: "ge-0/0/0", status: "up", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN10})`, mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    return [uplink, ...access];
  }
  return [];
}

export function esTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  if (!state.es.leafs.includes(leaf)) return [{ label: "Ethernet Segment", value: "Not a member" }];
  return [
    { label: "ESI", value: state.es.esi },
    { label: "Leaves", value: state.es.leafs.join(", ") },
    { label: "This leaf believes DF", value: state.es.dualDfBelief[leaf] ? "yes" : "no" },
    { label: "Attachment to SERVER-A", value: state.es.esAttachmentDown === leaf ? "DOWN" : "up" },
  ];
}

export function vpwsTabRowsFor(state: ArenaState, device: ArenaDeviceId) {
  return [
    { label: "Service", value: `VPWS-${state.vpws.serviceId}` },
    { label: "Local AC", value: `VLAN ${VLAN10} (SERVER-A)` },
    { label: "Remote AC / Endpoint", value: `VLAN ${VLAN20} (HOST-B via LEAF3)` },
    { label: "Redundancy Mode", value: "Single-Active" },
    { label: "Primary", value: state.vpws.primaryPe ?? "(none)" },
    { label: "Backup", value: state.vpws.backupPe ?? "(none)" },
    { label: "This device's advertised L2 MTU", value: state.vpws.l2MtuAdvertised[device as ArenaLeafId] !== undefined ? String(state.vpws.l2MtuAdvertised[device as ArenaLeafId]) : "—" },
    { label: "Remote expected L2 MTU", value: String(state.vpws.remoteExpectedMtu) },
    { label: "Status", value: state.vpws.status.toUpperCase() },
  ];
}

export function vrfTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  return [
    { label: "VRF", value: "TENANT-A" },
    { label: "L3 VNI", value: String(state.l3VniByLeaf[leaf]) },
    { label: "Expected L3 VNI (fabric-wide)", value: String(L3_VNI) },
    { label: `VNI ${VNI10010} IMET`, value: imetOk(state, leaf, VNI10010) ? "member" : "not a member" },
    { label: `VNI ${VNI10020} IMET`, value: imetOk(state, leaf, VNI10020) ? "member" : "not a member" },
  ];
}

export function suppressionTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  return [
    { label: "Target", value: `${state.suppression.targetIp} (${state.suppression.targetMac})` },
    { label: "Local binding present", value: suppressionPresent(state, leaf) ? "yes" : "no" },
  ];
}

export function evpnRibRowsFor(state: ArenaState, device: ArenaDeviceId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  state.type2Routes.forEach((r) => rows.push({ routeType: "2", summary: `${r.mac} / ${r.ip}`, nextHop: r.originLeaf, rd: r.rd, rt: r.rt, extra: r.rtMatchesLocally ? undefined : [{ label: "Import", value: "NOT MATCHED" }] }));
  if (device === "LEAF1" || device === "LEAF2" || device === "LEAF3") {
    rows.push({ routeType: "3", summary: `VNI ${VNI10010} membership`, nextHop: imetOk(state, device, VNI10010) ? "member" : "not a member" });
  }
  rows.push({ routeType: "5", summary: state.type5.prefix, nextHop: state.type5.nextHopVtep, extra: [{ label: "Next hop", value: state.type5.nextHopReachable ? "resolved" : "UNRESOLVED" }] });
  if (device === "LEAF1" || device === "LEAF2") {
    rows.push({ routeType: "1", subKind: "PER EVI", summary: `VPWS-${state.vpws.serviceId}`, nextHop: device, extra: [{ label: "Role", value: ROLE_LABEL[state.vpws.primaryPe === device ? "primary" : state.vpws.backupPe === device ? "backup" : "ineligible"] }] });
    rows.push({ routeType: "4", summary: `ESI ${state.es.esi.slice(-8)}`, nextHop: device });
  }
  return rows;
}
