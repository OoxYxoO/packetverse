import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_IP, HOST_MAC, HOST_STAGES, HOST_SW, LACP_STAGES, LAG1_KEY, LAG_NAME, MEMBERS, PORT_PRIORITY, bitsText, eligible, lagStatus, portNumber, selectable, type LacpDevice, type LacpHost, type LacpSide, type LacpState } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";

const isSwitch = (d: LacpDevice): d is LacpSide => d === "SW1" || d === "SW2";

export function lacpTraceFor(device: LacpDevice, s: LacpState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, isSwitch(device) ? LACP_STAGES : HOST_STAGES);
}

function roleAt(s: LacpState, device: LacpDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface || hop.egressInterfaceIds?.includes(iface)) return "egress";
  return "idle";
}

export function lacpInterfacesFor(device: LacpDevice, s: LacpState, stepId: string): DeviceInterfaceData[] {
  if (isSwitch(device)) {
    const hostPorts = (Object.keys(HOST_SW) as LacpHost[]).filter((h) => HOST_SW[h].sw === device);
    const access: DeviceInterfaceData[] = hostPorts.map((h) => ({ id: HOST_SW[h].port, name: HOST_SW[h].port, status: "up", neighborId: h, neighborLabel: `${h} eth0`, linkType: "Access", role: roleAt(s, device, stepId, HOST_SW[h].port), extra: [{ label: "Host", value: `${HOST_IP[h]} · ${HOST_MAC[h]}` }] }));
    const lag: DeviceInterfaceData = {
      id: LAG_NAME,
      name: `${LAG_NAME} (logical)`,
      status: lagStatus(s).members > 0 ? "up" : "down",
      neighborId: device === "SW1" ? "SW2" : "SW1",
      neighborLabel: `${device === "SW1" ? "SW2" : "SW1"} ${LAG_NAME}`,
      linkType: "Link aggregation",
      role: "idle",
      extra: [
        { label: "Status", value: lagStatus(s).text },
        { label: "Local key", value: String(LAG1_KEY[device]) },
        { label: "Distributing members", value: eligible(s, device).join(", ") || "none" },
      ],
    };
    const members: DeviceInterfaceData[] = MEMBERS.map((m) => {
      const l = s.lacp[device][m];
      const sel = selectable(s, device, m);
      return {
        id: m,
        name: m,
        status: s.up[m] ? ("up" as const) : ("down" as const),
        neighborId: device === "SW1" ? "SW2" : "SW1",
        neighborLabel: `${device === "SW1" ? "SW2" : "SW1"} ${m}`,
        linkType: `${LAG_NAME} member`,
        role: roleAt(s, device, stepId, m),
        extra: [
          { label: "LACP mode", value: s.mode[device] === "active" ? "Active" : "Passive" },
          { label: "Actor key", value: String(s.key[device][m]) },
          { label: "Actor port ID", value: `${PORT_PRIORITY}.${portNumber(m)}` },
          { label: "Actor state", value: bitsText(l.actor) },
          { label: "Partner system", value: l.partner ? `${l.partner.sysPriority} / ${l.partner.sysMac}` : "none (defaulted)" },
          { label: "Partner key", value: l.partner ? String(l.partner.key) : "none" },
          { label: "Partner port ID", value: l.partner ? `${l.partner.portPriority}.${l.partner.port}` : "none" },
          { label: "Partner state", value: l.partner ? bitsText(l.partner.state) : "none" },
          { label: `Selected into ${LAG_NAME}`, value: sel.ok ? "yes" : `no — ${sel.why}` },
          { label: "Eligible for customer traffic", value: eligible(s, device).includes(m) ? "yes (Collecting + Distributing)" : "no" },
        ],
      };
    });
    return [...access, lag, ...members];
  }
  const h = device as LacpHost;
  return [{ id: "eth0", name: "eth0", status: "up", ip: `${HOST_IP[h]}/24`, neighborId: HOST_SW[h].sw, neighborLabel: `${HOST_SW[h].sw} ${HOST_SW[h].port}`, linkType: "Access", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: HOST_MAC[h] }, { label: "LACP", value: "not a participant (ordinary Ethernet host)" }] }];
}
