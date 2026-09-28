import type { NodeExplanation } from "@/components/network3d/types";
import { hex8 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, POOL, type DhDevice, type DhState } from "@/lib/sim-engine/scenarios/dhcpDns";

type Table = { title: string; rows: { label: string; value: string }[] };

export function clientLeaseRows(s: DhState) {
  const c = s.client;
  return [
    { label: "DHCP state", value: c.phase },
    { label: "Address", value: c.ip ? `${c.ip}/24` : "none" },
    { label: "Mask", value: c.mask ?? "none" },
    { label: "Gateway", value: c.gateway ?? "none" },
    { label: "DNS server", value: c.dns ?? "none" },
    { label: "Lease", value: c.lease ? `${c.lease} s (T1 ${c.lease / 2} s, T2 ${(c.lease * 7) / 8} s)` : "none" },
    { label: "xid", value: c.xid !== undefined ? hex8(c.xid) : "none" },
  ];
}

export function dhTables(device: DhDevice, s: DhState): Table[] {
  switch (device) {
    case "CLIENT":
      return [{ title: "Lease", rows: clientLeaseRows(s) }, { title: "DNS cache", rows: s.dnsCache.length ? s.dnsCache.map((c) => ({ label: c.name, value: `${c.address} (TTL ${c.ttl} s)` })) : [{ label: "cache", value: "empty" }] }];
    case "R1":
      return [
        { title: "DHCP relay", rows: [{ label: "Listens on", value: "ge-0/0/0 (UDP 67 broadcasts)" }, { label: "Helper", value: DH_ADDR["DHCP-SRV"] }, { label: "giaddr", value: DH_ADDR["R1:CLIENT"] }, { label: "Relayed", value: s.relayed.length ? s.relayed.map((r) => `${r.type} ${hex8(r.xid)}`).join(", ") : "none yet" }] },
        { title: "Routing table", rows: [{ label: "10.10.10.0/24", value: "connected ge-0/0/0" }, { label: "10.20.20.0/24", value: "connected ge-0/0/1" }] },
      ];
    case "DHCP-SRV":
      return [
        { title: `Scope ${POOL.subnet}`, rows: [{ label: "Range", value: POOL.range }, { label: "Option 1 Mask", value: MASK }, { label: "Option 3 Router", value: POOL.router }, { label: "Option 6 DNS", value: s.serverOption6 }, { label: "Option 51 Lease", value: `${LEASE_SECONDS} s` }] },
        { title: "Leases", rows: s.serverLeases.length ? s.serverLeases.map((l) => ({ label: l.ip, value: `${l.mac} · xid ${hex8(l.xid)} · DNS ${l.dns}` })) : [{ label: "leases", value: "none yet" }] },
      ];
    case "DNS-SRV":
      return [
        { title: "Records", rows: [{ label: DNS_NAME, value: `A ${DH_ADDR.WEB} · TTL ${DNS_RECORD_TTL} s` }] },
        { title: "Last query", rows: s.lastDns ? [{ label: `id 0x${s.lastDns.id.toString(16).toUpperCase()}`, value: `to ${s.lastDns.server} · ${s.lastDns.result}` }] : [{ label: "queries", value: "none yet" }] },
      ];
    default:
      return [{ title: "Switch", rows: [{ label: "Role", value: device === "SW1" ? "Client LAN 10.10.10.0/24" : "Server LAN 10.20.20.0/24" }] }];
  }
}

export function explainDh(s: DhState, id: string, stepId: string): NodeExplanation {
  const device = id as DhDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = dhTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  const base = { id, name: device, currentAction: act, packetBefore: hop?.input, packetAfter: hop?.output, tables };
  switch (device) {
    case "CLIENT":
      return { ...base, deviceType: "DHCP client + DNS resolver", role: "Learns its IPv4 configuration from DHCP, then resolves names", controlPlaneRole: `State ${s.client.phase}. Knows: ${s.client.ip ? `${s.client.ip}/24, gw ${s.client.gateway}, DNS ${s.client.dns}` : "nothing yet"}.`, dataPlaneRole: hop ? `Result: ${hop.output}.` : "Broadcasts DHCP until bound; unicasts DNS to the server from its lease." };
    case "R1":
      return { ...base, deviceType: "Router + DHCP relay agent", role: "Gateway 10.10.10.1 · relays DHCP broadcasts to 10.20.20.10", controlPlaneRole: `Relay helper ${DH_ADDR["DHCP-SRV"]}; stamps giaddr ${DH_ADDR["R1:CLIENT"]}. Connected: 10.10.10.0/24, 10.20.20.0/24.`, dataPlaneRole: hop ? `Received: ${hop.input}. ${hop.lookupType}: ${hop.lookupResult}. Sent: ${hop.output}.` : "Never forwards 255.255.255.255; relays DHCP broadcasts and routes ordinary unicast." };
    case "DHCP-SRV":
      return { ...base, deviceType: "DHCP server", role: `Scope ${POOL.subnet} (selected by giaddr)`, controlPlaneRole: `Hands out ${POOL.range} with mask, router and DNS (Option 6 = ${s.serverOption6}).`, dataPlaneRole: hop ? `Result: ${hop.output}.` : "Replies to the relay for relayed requests, and directly to the client for renewals." };
    case "DNS-SRV":
      return { ...base, deviceType: "DNS resolver", role: `Answers ${DNS_NAME} A ${DH_ADDR.WEB}`, controlPlaneRole: "Holds the A record with a 300 s TTL (recursion available).", dataPlaneRole: hop ? `Result: ${hop.output}.` : "Answers UDP 53 queries, echoing the Transaction ID." };
    default:
      return { ...base, deviceType: "Ethernet switch", role: device === "SW1" ? "Client LAN" : "Server LAN", controlPlaneRole: "Knows MAC → port only.", dataPlaneRole: hop ? `Result: ${hop.output}.` : "Floods broadcasts within its LAN; forwards unicast by MAC." };
  }
}
