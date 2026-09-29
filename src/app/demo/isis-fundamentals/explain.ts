import type { NodeExplanation } from "@/components/network3d/types";
import { AREA, IFACES, ROUTER, THREE_WAY_CODE, hex8s, ifKey, lspChecksum, netOf, type IsisRouter, type IsisState } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { hex4 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";

type Table = { title: string; rows: { label: string; value: string }[] };

export function isisTables(r: IsisRouter, s: IsisState): Table[] {
  const ifs = IFACES.filter((i) => i.router === r);
  const spf = s.spf[r];
  return [
    { title: "Identity", rows: [{ label: "Hostname", value: r }, { label: "NET", value: netOf(r) }, { label: "Area ID", value: AREA }, { label: "System ID", value: ROUTER[r].sysId }, { label: "Level capability", value: "Level-2 only (router)" }, { label: "Loopback", value: `${ROUTER[r].loopback}/32` }] },
    {
      title: "Circuits & adjacencies",
      rows: ifs.map((i) => {
        const a = s.adj[ifKey(r, i.name)];
        return { label: i.name, value: `circuit ${s.circuit[ifKey(r, i.name)]}-only · metric 10 · ${a.neighbor ?? i.peer} ${a.state} (3-way ${THREE_WAY_CODE[a.state]})${a.level !== "none" ? ` · ${a.level}` : ""} · hold ${a.hold ? `${a.hold} s` : "—"}` };
      }),
    },
    { title: "Level-2 LSDB", rows: s.lsdb[r].map((l) => ({ label: l.id, value: `${l.originator} · seq ${hex8s(l.seq)} · life ${l.lifetime} s · csum ${hex4(lspChecksum(l))} · IS ${l.isReach.map((n) => `${n.neighbor}/${n.metric}`).join(", ") || "none"} · IP ${l.ipReach.map((p) => `${p.prefix}/${p.len}`).join(", ")}` })) },
    { title: "SPF result", rows: spf ? [...spf.tree.map((t) => ({ label: t.router, value: `distance ${t.dist}${t.nextHop ? ` via ${t.nextHop}` : " (self)"}` })), ...spf.unusable.map((u) => ({ label: "not usable", value: u }))] : [] },
    { title: "IS-IS routes (RIB)", rows: (s.rib[r] ?? []).map((x) => ({ label: x.prefix, value: `metric ${x.metric} via ${x.nextHopAddr} (${x.nextHop}) ${x.iface}` })) },
    { title: "Latest PDU", rows: [{ label: "Last", value: s.lastPdu[r] ?? "none yet" }] },
  ];
}

export function explainIsis(s: IsisState, id: string, stepId: string): NodeExplanation {
  const r = id as IsisRouter;
  const hop = [...s.hops].reverse().find((h) => h.device === r && h.stepId === stepId);
  const ups = IFACES.filter((i) => i.router === r && s.adj[ifKey(r, i.name)].state === "UP").length;
  return {
    id,
    name: r,
    deviceType: `IS-IS Level-2 router (${r.startsWith("PE") ? "provider edge" : "provider core"})`,
    role: `NET ${netOf(r)} · ${ups} adjacenc${ups === 1 ? "y" : "ies"} Up · ${s.lsdb[r].length} LSPs`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: "IS-IS over 802.3/LLC: hellos, LSP flooding, SNPs, SPF.",
    dataPlaneRole: "Forwards IPv4 by the routes SPF installed — IS-IS carries no user data.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: isisTables(r, s),
  };
}
