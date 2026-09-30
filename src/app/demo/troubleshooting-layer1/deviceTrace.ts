import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { L1_IP, L1_MAC, L1_STAGES, MEDIA, UPLINK, dbm, type L1Device, type L1State, type Sw } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";

export function l1TraceFor(device: L1Device, s: L1State, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, L1_STAGES[device]);
}

function roleAt(s: L1State, device: L1Device, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}
const fmt = (n: number) => n.toLocaleString("en-US");

/** Interfaces as the device itself would report them at the SHOWN step (live device values, not lesson verdicts). */
export function l1InterfacesFor(device: L1Device, s: L1State, stepId: string): DeviceInterfaceData[] {
  if (device === "CLIENT" || device === "SERVER")
    return [{ id: "eth0", name: "eth0", status: "up", ip: `${L1_IP[device]}/24`, neighborId: device === "CLIENT" ? "ACCESS-SW" : "DIST-SW", neighborLabel: device === "CLIENT" ? "ACCESS-SW ge-0/0/1" : "DIST-SW ge-0/0/2", linkType: "1000BASE-T copper", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: L1_MAC[device] }] }];
  const sw = device as Sw;
  const peer: Sw = sw === "ACCESS-SW" ? "DIST-SW" : "ACCESS-SW";
  const c = s.counters[sw];
  const o = s.optics[sw];
  const access = { id: sw === "ACCESS-SW" ? "ge-0/0/1" : "ge-0/0/2", host: sw === "ACCESS-SW" ? "CLIENT" : "SERVER" } as const;
  return [
    { id: access.id, name: access.id, status: "up", neighborId: access.host, neighborLabel: `${access.host} eth0`, linkType: "Access port · 1000BASE-T copper", role: roleAt(s, device, stepId, access.id), extra: [{ label: "Admin / oper", value: "up / up" }, { label: "Errors", value: "input 0 · CRC 0" }] },
    {
      id: UPLINK,
      name: UPLINK,
      status: s.oper[sw] === "up" ? "up" : "down",
      neighborId: peer,
      neighborLabel: `${peer} ${UPLINK}`,
      linkType: `Uplink · ${MEDIA}`,
      role: roleAt(s, device, stepId, UPLINK),
      extra: [
        { label: "Admin / oper", value: `${s.admin[sw]} / ${s.oper[sw]}` },
        { label: "Speed / duplex", value: "1000 Mb/s / full (autonegotiation complete)" },
        { label: "Optics Tx / Rx", value: `${dbm(o.tx)} / ${dbm(o.rx)}` },
        { label: "Input packets", value: fmt(c.inPkts) },
        { label: "Input errors", value: fmt(c.inErrors) },
        { label: "CRC / FCS errors", value: fmt(c.crc) },
        { label: "Output packets / errors", value: `${fmt(c.outPkts)} / ${c.outErrors}` },
        { label: "Carrier transitions", value: String(c.carrierTransitions) },
        { label: "Last change", value: s.lastFlap[sw] },
        { label: "Counters last cleared", value: "never" },
      ],
    },
  ];
}
