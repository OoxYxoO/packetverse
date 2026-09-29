import type { NodeExplanation } from "@/components/network3d/types";
import { FW, FW1_ROUTES, FW_IFACES, FW_POLICIES, ISP_ROUTES, NAT_PORT, NAT_RULE, WEB_PORT, latestSession, policyText, routeText, tupleText, type FwDevice, type FwSession, type FwState } from "@/lib/sim-engine/scenarios/firewallStateful";

type Table = { title: string; rows: { label: string; value: string }[] };

export const sessionRows = (x: FwSession) => [
  { label: "Session ID", value: String(x.id) },
  { label: "State", value: x.state },
  { label: "Protocol", value: x.protocol },
  { label: "Ingress → egress zone", value: `${x.ingressZone} → ${x.egressZone}` },
  { label: "Original source", value: tupleText(x.origSrc, x.origSport) },
  { label: "Original destination", value: tupleText(x.origDst, x.dport) },
  { label: "Translated source", value: tupleText(x.xlSrc, x.xlSport) },
  { label: "Policy · NAT rule", value: `${x.policy} · ${x.nat}` },
  { label: "Packets out / in", value: `${x.pktsOut} / ${x.pktsIn}` },
  { label: "Bytes out / in", value: `${x.bytesOut} / ${x.bytesIn}` },
];

export function fwTables(device: FwDevice, s: FwState): Table[] {
  if (device === "FW1") {
    const last = latestSession(s);
    return [
      { title: "Interfaces & zones", rows: FW_IFACES.FW1.map((i) => ({ label: i.name, value: `${i.addr}/${i.len} · zone ${i.zone}` })) },
      { title: "Routes", rows: FW1_ROUTES.map((r) => ({ label: `${r.prefix}/${r.len}`, value: routeText(r).replace(`${r.prefix}/${r.len} `, "") })) },
      { title: "Security policy", rows: FW_POLICIES.map((p, i) => ({ label: p.implicit ? "implicit" : `rule ${i + 1}`, value: policyText(p) })) },
      { title: "Source NAT", rows: [{ label: NAT_RULE.name, value: `${NAT_RULE.from} → ${NAT_RULE.to} · ${NAT_RULE.source} → ${s.natAddr} · ${NAT_RULE.ports}` }] },
      { title: "Current decision", rows: s.check ? [{ label: "Packet", value: s.check.packet }, { label: "Session lookup", value: s.check.session }, { label: "Route", value: s.check.route }, { label: "Policy", value: s.check.policy }, { label: "NAT", value: s.check.nat }, { label: "Action", value: s.check.verdict }] : [] },
      { title: "Latest session", rows: last ? sessionRows(last) : [] },
      { title: "Deny log", rows: s.denyLog.map((d, i) => ({ label: `#${i + 1}`, value: `${tupleText(d.src, d.sport)} → ${tupleText(d.dst, d.dport)} from ${d.from} · ${d.reason}` })) },
    ];
  }
  if (device === "ISP") return [{ title: "Routes", rows: ISP_ROUTES.map((r) => ({ label: `${r.prefix}/${r.len}`, value: `connected ${r.iface}` })) }, { title: "Note", rows: [{ label: "Not routed here", value: "anything outside 198.51.100.0/30 and 203.0.113.0/24" }] }];
  if (device === "CLIENT") {
    return [{ title: "Host", rows: [{ label: "IPv4", value: `${FW.client}/24` }, { label: "Default gateway", value: FW.trust }, { label: "Destination", value: tupleText(FW.web, WEB_PORT) }, { label: "Source port", value: s.client.sport ? String(s.client.sport) : "none open" }, { label: "TCP state", value: s.client.state }] }];
  }
  return [{ title: "Server", rows: [{ label: "IPv4", value: `${FW.web}/24` }, { label: "Listening", value: `TCP/${WEB_PORT}` }, { label: "Source tuple received", value: s.web.peer ?? "none yet" }, { label: "Replies to", value: s.web.replyTo ? `${s.web.replyTo} (from ${tupleText(FW.web, WEB_PORT)})` : "none yet" }, { label: "TCP state", value: s.web.state }] }];
}

const TYPE: Record<FwDevice, string> = { CLIENT: "Client host", FW1: "Stateful firewall (routes · policy · sessions · NAT)", ISP: "Provider router", "WEB-SERVER": "HTTPS server" };

export function explainFw(s: FwState, id: string, stepId: string): NodeExplanation {
  const device = id as FwDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const last = latestSession(s);
  const role =
    device === "FW1"
      ? `Zones trust/untrust · SNAT-OUT → ${s.natAddr}:${NAT_PORT}+ · ${last ? `session ${last.id} ${last.state}` : "no sessions"}`
      : device === "CLIENT"
        ? `${FW.client} · gateway ${FW.trust} · TCP ${s.client.state}`
        : device === "WEB-SERVER"
          ? `${FW.web}:${WEB_PORT} · TCP ${s.web.state}`
          : "Routes the customer /30 and the server LAN";
  return {
    id,
    name: device,
    deviceType: TYPE[device],
    role,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: device === "FW1" ? "Configuration: routes, zone policy, NAT rule. State: the session table it builds from traffic." : device === "ISP" ? "Static provider routing; knows nothing about FW1's sessions or NAT." : undefined,
    dataPlaneRole: hop ? `In: ${hop.input}. Result: ${hop.output}.` : device === "FW1" ? "New flows: session → route → policy → NAT. Existing flows: session match only." : "Sends and receives ordinary TCP/IP.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: device === "FW1" && s.natAddr !== FW.untrust ? `SNAT-OUT currently translates to ${s.natAddr}, which is not FW1's untrust address ${FW.untrust}.` : undefined,
    tables: fwTables(device, s),
  };
}
