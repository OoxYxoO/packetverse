import type { NodeExplanation } from "@/components/network3d/types";
import { IP, NAME, RECORD_TTL, cached, remaining, type ApDevice, type ApState } from "@/lib/sim-engine/scenarios/troubleshootingApplication";

type Table = { title: string; rows: { label: string; value: string }[] };

export function apTables(d: ApDevice, s: ApState): Table[] {
  if (d === "CLIENT") {
    const c = cached(s);
    return [
      { title: "DNS cache", rows: [{ label: NAME, value: c ? `${c.address} · ${remaining(s)} s of ${c.ttl} s left` : "no fresh entry" }] },
      { title: "HTTP results", rows: s.http.map((h) => ({ label: h.label, value: `${h.target}${h.resolved ? ` → ${h.resolved}` : ""} · TCP ${h.tcp} · ${h.status}` })) },
      { title: "Resolver", rows: [{ label: "DNS server", value: IP.dns }, { label: "Default gateway", value: IP.gwClient }] },
    ];
  }
  if (d === "DNS") return [{ title: "Authoritative zone example.test", rows: [{ label: `${NAME} A`, value: `${s.authA} · TTL ${RECORD_TTL}` }] }, { title: "Answers sent", rows: s.dnsLog.map((x, i) => ({ label: String(i + 1), value: `${x.label}: ${x.answer} TTL ${x.ttl}` })) }];
  if (d === "NETWORK") return [{ title: "Routes", rows: [{ label: "10.30.1.0/24", value: "connected ge-0/0/0" }, { label: "10.40.40.0/24", value: "connected ge-0/0/1" }] }];
  return [
    { title: "Service", rows: [{ label: "Listening", value: `${d === "WEB-OLD" ? IP.old : IP.new}:80/TCP (plain HTTP)` }, { label: `Host ${NAME}`, value: d === "WEB-OLD" ? "503 Service Unavailable" : "200 OK" }] },
  ];
}

export function explainAp(s: ApState, id: string, stepId: string): NodeExplanation {
  const d = id as ApDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const web = d === "WEB-OLD" || d === "WEB-NEW";
  return {
    id,
    name: d,
    deviceType: d === "DNS" ? "Authoritative DNS server" : web ? "Web server (HTTP/80)" : d === "NETWORK" ? "Router / gateway" : "Host",
    role: d === "CLIENT" ? `${IP.client}/24 · resolver ${IP.dns}` : d === "DNS" ? `${IP.dns} · example.test` : d === "WEB-OLD" ? IP.old : d === "WEB-NEW" ? IP.new : "routes between the client and server LANs",
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: d === "DNS" ? "Serves the zone: which address each name maps to, and for how long it may be cached." : d === "CLIENT" ? "Resolves names (cache, then query) before connecting." : web ? "Matches the Host header to a site." : "Connected routes only.",
    dataPlaneRole: web ? "Accepts TCP/80 and returns an HTTP status." : d === "NETWORK" ? "Forwards between 10.30.1.0/24 and 10.40.40.0/24." : d === "DNS" ? "Answers UDP/53 queries." : "Sends DNS queries, TCP segments and HTTP requests.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: apTables(d, s),
  };
}
