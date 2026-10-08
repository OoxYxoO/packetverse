import type { ReactNode } from "react";
import { DNS_NAME } from "@/lib/sim-engine/scenarios/dhcpDns";
import { DL_ADDR, DL_WEB_NEW, configured, type DlConfig, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * Narration for the DHCP & DNS Lab: what the last action did and why (read from where its packets went), and what a
 * configuration change means. Shared by the learning levels and the engineer mode.
 */

/** Explain, in process terms, the DHCP step the last packets belong to. */
function dhcpWhy(pk: DlState["capture"], c: DlState["client"]): string {
  const has = (t: string) => pk.some((p) => p.info.includes(t));
  if (!pk.length) return "No packets in this step.";
  if (has("Release")) return "The client handed its address back. The server returns it to the pool, and the client has no address until it asks again.";
  if (has("RENEWING")) return `At T1 (half the lease) the client already has an address, so it doesn't broadcast: it unicasts a REQUEST from ${c.ip} straight to the server that leased it (after making sure it knows its gateway's MAC). R1 just routes it; the relay isn't involved. The ACK restarts the lease and carries the server's current options.`;
  if (has("REBINDING") || has("RENEW, broadcast")) return "The client broadcast a REQUEST for its current address to any server; R1 relayed it. The ACK carries the server's current options.";
  if (has("ACK")) return `The server recorded the lease and confirmed it with an ACK carrying the address, mask, gateway (option 3), DNS server (option 6) and lease time. Only now does the client configure its interface: until the ACK it had nothing to use.`;
  if (has("Request")) return `The client broadcasts its REQUEST so every DHCP server hears which offer it chose: option 50 names the address, option 54 the server. It is still a broadcast from 0.0.0.0 (the client has no address yet), so R1 relays it again with giaddr. Nothing is configured on the client until the ACK.`;
  if (has("Offer")) return "The DISCOVER left the client as a broadcast from 0.0.0.0 because it has no address. Broadcasts don't cross routers, but R1 is a relay: it built a new unicast to DHCP-SRV and wrote its own client-LAN address (giaddr 10.10.10.1) into it, so the server knew which scope to offer from. The server reserved an address and sent the OFFER back through R1, which delivered it to the client.";
  return pk[pk.length - 1].notes.join(" ");
}

/** The cause of a failed lookup or ping, read from where its packets stopped. */
function failureWhy(s: DlState, pk: DlState["capture"]): string | undefined {
  const c = s.client;
  const arpFail = pk.find((p) => p.proto === "ARP" && p.src === c.ip && p.lost);
  if (arpFail) return `Nothing that needs the gateway was ever sent. To send off its subnet the client first needs the MAC address of its gateway ${c.gw}; it asked with ARP and nobody answered (nobody owns ${c.gw}). That breaks every remote destination, by name or by IP. The gateway came from DHCP option 3.`;
  const dropped = pk.find((p) => p.proto === "DNS" && p.hops[p.hops.length - 1].act === "drop");
  if (dropped) return `The query reached R1 and went no further: R1 asked “who has ${c.dns}?” on the server LAN and nobody answered, so it couldn't build the frame and dropped it. The client was told (DHCP option 6) to use a DNS server that doesn't exist. IP traffic is unaffected: only names fail.`;
  const refused = pk.find((p) => p.msg === "Port unreachable" && p.src === DL_ADDR.DNS);
  if (refused) return "The query crossed the whole network and reached DNS-SRV, but no DNS service listens on UDP 53: the host answered “port unreachable”. The host and the path are fine (it answers pings); the service is down.";
  const unanswered = pk.find((p) => p.msg === "Echo request" && p.lost);
  if (unanswered) return `The echo request left R1 towards ${unanswered.dst} (ge-0/0/2) and nothing came back: that server is switched off.`;
  return undefined;
}

export function dlNarrate(s: DlState): { ok: boolean; happened: ReactNode; why: ReactNode } {
  const pk = s.capture.filter((p) => s.lastPackets.includes(p.no));
  const lost = pk.find((p) => p.lost);
  const c = s.client;
  const identity = configured(c) ? `The client is ${c.phase}: ${c.ip}, gateway ${c.gw}, DNS ${c.dns}.` : c.phase === "APIPA" ? `The client gave itself ${c.ip} (link-local): no gateway, no DNS.` : `The client is in state ${c.phase}${c.offered ? `, holding an offer of ${c.offered}` : ""}.`;
  const flow = pk.length ? (
    <span className="block pv-mono text-[12px] text-pv-text-muted">
      {pk.map((p) => `${p.msg}${p.lost ? " ✕" : ""}`).join("  →  ")}
    </span>
  ) : null;
  if (s.lastResult && (s.lastResult.kind === "resolve" || s.lastResult.kind === "ping")) {
    const r = s.lastResult;
    const fail = failureWhy(s, pk);
    return {
      ok: r.ok,
      happened: (
        <>
          <span className="block text-pv-text">
            {r.kind === "resolve" ? "Lookup: " : "Ping: "}
            {r.text}
          </span>
          {flow ?? <span className="block text-[12px]">No packet was sent{r.kind === "resolve" && r.ok ? ": answered from the client's own cache" : ""}.</span>}
        </>
      ),
      why: r.ok
        ? r.kind === "resolve"
          ? pk.length
            ? `The client sent its query to ${c.dns}, the DNS server it learned from DHCP option 6${pk.some((p) => p.proto === "ARP") ? " (after learning its gateway's MAC with ARP)" : ""}. DNS-SRV answered, and the client cached the answer for the record's TTL.`
            : "A cached answer was still valid (its TTL hadn't run out), so the client didn't need to ask the DNS server."
          : "The echo request reached its destination and the reply came back: IP connectivity in both directions works. (That proves nothing about any service on that host.)"
        : (fail ?? (lost ? `${lost.lost}.` : r.text)),
    };
  }
  return {
    ok: !lost,
    happened: (
      <>
        <span className="block text-pv-text">{identity}</span>
        {flow}
      </>
    ),
    why: lost ? `${(lost.lost ?? "").replace(/^./, (x) => x.toUpperCase())}. ${lost.hops[lost.hops.length - 1].text}` : dhcpWhy(pk, c),
  };
}

export const DL_CONFIG_EXPLAIN = (k: keyof DlConfig, v: DlConfig[keyof DlConfig]): { title: string; where: string; meaning: string; expect: string } => {
  if (k === "relay") return v ? { title: "R1 relay switched on", where: "R1", meaning: "R1 again re-sends DHCP broadcasts from the client LAN to the server as unicast, stamping giaddr.", expect: "New DISCOVERs reach the server; clients can get leases. Check R1 ge-0/0/1: the relayed packets appear there again." } : { title: "R1 relay switched off", where: "R1", meaning: "R1 now drops DHCP broadcasts like any other broadcast. Nothing from the client LAN reaches the DHCP server.", expect: "Existing leases keep working until they need the relay. New clients end up with 169.254.x.x. Evidence: DISCOVERs on R1 ge-0/0/0, nothing on ge-0/0/1." };
  if (k === "option6") return { title: `DHCP option 6 (DNS server) = ${v}`, where: "DHCP-SRV scope", meaning: v === DL_ADDR.DNS ? "Future ACKs will tell clients to use the real DNS server." : `Future ACKs will tell clients to use ${v} for DNS, an address nobody owns.`, expect: "Clients only pick this up when they get or renew a lease. Then: names " + (v === DL_ADDR.DNS ? "resolve again." : "fail (the query dies at R1, which can't find that host), IPs still work.") };
  if (k === "option3") return { title: `DHCP option 3 (default gateway) = ${v}`, where: "DHCP-SRV scope", meaning: v === DL_ADDR.RC ? "Future ACKs hand out the real gateway, R1." : `Future ACKs will hand out ${v} as the default gateway. No device owns that address.`, expect: "After a client renews: " + (v === DL_ADDR.RC ? "remote destinations work again." : "its ARP requests for the gateway go unanswered, so nothing leaves the LAN (including DNS); the real gateway 10.10.10.1 still answers a ping.") };
  if (k === "poolFree") return { title: (v as number) > 0 ? `Pool has ${v} free addresses` : "Pool exhausted", where: "DHCP-SRV scope", meaning: (v as number) > 0 ? "The server can offer addresses again." : "Every address in 10.10.10.50–150 is leased. The server receives DISCOVERs but has nothing to offer.", expect: (v as number) > 0 ? "New clients get leases." : "Existing clients are fine; every NEW client ends up with 169.254.x.x. Evidence: the DISCOVER reaches DHCP-SRV, no OFFER, and its log says “no free leases”." };
  if (k === "dnsUp") return v ? { title: "DNS service started on DNS-SRV", where: "DNS-SRV", meaning: "named listens on UDP 53 again.", expect: "Lookups work again (clients with a cached answer never noticed)." } : { title: "DNS service stopped on DNS-SRV", where: "DNS-SRV (the host stays up)", meaning: "Nothing listens on UDP 53. Queries still arrive; the host answers ICMP port unreachable.", expect: "Lookups fail with “connection refused”. Pinging the DNS server still works. Cached answers keep working until they expire." };
  return v ? { title: "DHCP service started on DHCP-SRV", where: "DHCP-SRV", meaning: "dhcpd listens on UDP 67 again.", expect: "Renewals and new clients succeed." } : { title: "DHCP service stopped on DHCP-SRV", where: "DHCP-SRV (the host stays up)", meaning: "Nothing listens on UDP 67. Requests still arrive; the host answers ICMP port unreachable. Clients with a lease keep using it.", expect: "New clients get nothing (169.254); renewals fail; at expiry clients lose their address. Pinging DHCP-SRV still works." };
};
export const DL_MIGRATE_EXPLAIN = { title: `DNS record changed: ${DNS_NAME} → ${DL_WEB_NEW}`, where: "DNS-SRV", meaning: "The authoritative answer is now the new server; the old one is switched off.", expect: "Clients with the old answer cached keep using it until its TTL runs out (or they flush): their lookups put nothing on the wire. New lookups get the new address." };
