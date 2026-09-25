import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { BEHAVIOR_LABEL, type EndpointLocalSidEntry } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import { PROTOCOL_HEX } from "./packetCallout";

/**
 * Readable callouts for the SRv6 family (Foundations, Endpoint Behaviors,
 * SRv6 Policy, SRv6 L3VPN). Everything — the active segment (IPv6 DA),
 * Segments Left / Last Entry, the Segment List, the inner payload and BGP
 * route fields — is read back from the PacketVisual the scenario built from
 * post-run state. Nothing is recomputed here, so a callout can never show an
 * SRH the packet does not carry or advance a segment the scenario did not.
 */

/** Meaning of one SID value, supplied by each lesson from its own Local SID Table (e.g. "R3 End.X → R4"). */
export type Srv6SidMeaning = (sidText: string) => string | undefined;

/** "R3 End.X → R4" / "R6 End.DT4 (VRF-CUST4)", read from a live Local SID Table (Endpoint Behaviors, SRv6 Policy) — a misbound entry is named as it is currently bound. */
export function endpointSidMeaning(tables: Partial<Record<string, EndpointLocalSidEntry[]>>, sid: string): string | undefined {
  for (const entries of Object.values(tables)) {
    const e = entries?.find((x) => x.sidText === sid);
    if (!e) continue;
    const p = e.parameter;
    const param = "adjacency" in p ? ` → ${p.adjacency}` : "table" in p ? ` (${p.table})` : "outgoingInterface" in p ? ` → ${p.outgoingInterface}` : "";
    return `${e.owner} ${BEHAVIOR_LABEL[e.behavior]}${param}`;
  }
  return undefined;
}

export interface Srv6PacketView {
  /** Outer IPv6 DA — the active segment (or the Service SID in L3VPN). */
  da?: string;
  sl?: number;
  le?: number;
  /** Segment List in storage order: [0] is the final segment. */
  list: string[];
  inner?: { kind: "IPv4" | "IPv6" | "Ethernet"; dst: string };
  /** End.B6.Encaps: an advanced original packet is nested under a new outer header. */
  nested: boolean;
  bgp?: Record<string, string>;
}

const BEHAVIOR_BADGE: Record<string, string> = {
  END: "End",
  "END.X": "End.X",
  "END.T": "End.T",
  "END.DX6": "End.DX6",
  "END.DX4": "End.DX4",
  "END.DT6": "End.DT6",
  "END.DT4": "End.DT4",
  "END.DX2": "End.DX2",
  "END.B6.ENCAPS": "End.B6.Encaps",
};

const stripOwner = (v: string) => v.replace(/\s*\(.*\)$/, "");

export function srv6View(packet: PacketVisual): Srv6PacketView {
  const layers = packet.layers ?? [];
  const outer = layers.find((l) => l.fields.some((f) => /^Destination Address \(/.test(f.label)));
  const da = outer?.fields.find((f) => /^Destination Address \(/.test(f.label))?.value;
  const srh = outer ? layers.find((l) => /^Segment Routing Header/.test(l.name)) : undefined;
  const num = (label: string) => {
    const v = srh?.fields.find((f) => f.label === label)?.value;
    return v === undefined ? undefined : Number(v);
  };
  const list: string[] = [];
  srh?.fields.forEach((f) => {
    const m = /^Segment List\[(\d+)\]$/.exec(f.label);
    if (m) list[Number(m[1])] = stripOwner(f.value);
  });
  const innerLayer = layers.find((l) => /^Inner /.test(l.name) || (!outer && /^IPv[46]$/.test(l.name)));
  let inner: Srv6PacketView["inner"];
  if (innerLayer) {
    const kind = /Ethernet/.test(innerLayer.name) ? "Ethernet" : /IPv4/.test(innerLayer.name) ? "IPv4" : "IPv6";
    const dst = innerLayer.fields.find((f) => /^Destination (IP|Address|MAC)$/.test(f.label))?.value ?? "";
    inner = { kind, dst };
  }
  const bgpLayer = layers.find((l) => l.name === "MP-BGP VPN UPDATE");
  const bgp = bgpLayer ? Object.fromEntries(bgpLayer.fields.map((f) => [f.label, f.value])) : undefined;
  return { da, sl: num("Segments Left"), le: num("Last Entry"), list, inner, nested: layers.some((l) => /nested/i.test(l.name)), bgp };
}

/** "SRH SL 1 / LE 1 · [0] R6 · [1] R3" or "no SRH (single SID)". */
export function srhText(v: Srv6PacketView, meaning: Srv6SidMeaning): string {
  if (v.sl === undefined) return "no SRH (single SID)";
  const owners = v.list.map((sid, i) => `[${i}] ${meaning(sid)?.split(" ")[0] ?? sid}`).join(" · ");
  return `SRH SL ${v.sl} / LE ${v.le}${owners ? ` · ${owners}` : ""}`;
}

function innerText(inner: Srv6PacketView["inner"], prefix = "inner "): string | undefined {
  if (!inner) return undefined;
  return `${prefix}${inner.kind} → ${inner.dst}`;
}

export function srv6Callout(packet: PacketVisual, meaning: Srv6SidMeaning): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const v = srv6View(packet);

  if (v.bgp) {
    const nlri = v.bgp["NLRI (RD:Prefix)"];
    const sid = v.bgp["Prefix-SID Attribute → SRv6 L3 Service TLV (Type 5)"];
    const behavior = v.bgp["Endpoint Behavior"];
    const reflected = (packet.layers ?? []).some((l) => /RR attributes/.test(l.name));
    return {
      title: `MP-BGP VPN UPDATE${reflected ? " (reflected)" : ""} · ${nlri}`,
      detail: `Control plane · RT ${v.bgp["Extended Community (RT)"]} · next hop ${v.bgp["NEXT_HOP (IPv6)"]} · Service SID ${sid}${behavior ? ` (${behavior})` : ""}`,
      color,
    };
  }

  if (!v.da) {
    // A customer / original packet with no SRv6 encapsulation on it (before H.Encaps, or after decapsulation).
    const [head] = packet.summary.split(" — ");
    return { title: `${head} · no SRv6 header`, detail: `Data plane · ${innerText(v.inner, "") ?? packet.summary}`, color };
  }

  const daMeaning = meaning(v.da);
  const daLabel = daMeaning ?? v.da;
  const badge = packet.badge ?? "";
  const behavior = BEHAVIOR_BADGE[badge];
  const [head] = packet.summary.split(" — ");
  // "Stage shown: …" visuals name their own stage; the badge alone can describe an earlier step (e.g. END.X at R3 on a packet now heading for R6's decap).
  const before = /before (?:R\d+ )?(?:misconfigured |restored )?(End\.\w+) decap/i.exec(packet.summary)?.[1];
  const after = /after (R\d+ End(?:\.\w+)?)/i.exec(packet.summary)?.[1];
  let title: string;
  if (before && after) title = `After ${after} → DA ${daLabel} (pre-decap)`;
  else if (before) title = `Before ${before} decap · DA ${daLabel}`;
  else if (behavior && /SL \d→\d/.test(packet.summary)) title = `${behavior} executed → DA ${daLabel}`;
  else if (behavior === "End.B6.Encaps") title = `End.B6.Encaps · new outer DA ${daLabel}`;
  else if (behavior) title = `${head} · DA ${daLabel}`;
  else if (badge === "FIB") title = `IPv6 transit · DA ${daLabel}`;
  else if (badge === "MATCH") title = `Local SID match · ${daLabel}`;
  else if (badge === "DROP") title = `Dropped · DA ${daLabel}`;
  else if (/^H\.?ENCAPS$/i.test(badge) || badge === "HEADEND") title = `${badge === "HEADEND" ? "Headend" : "H.Encaps"} · DA ${daLabel}`;
  else title = `${head} · DA ${daLabel}`;

  const parts = [`DA ${v.da}`, srhText(v, meaning), v.nested ? "nested original packet (advanced) inside" : undefined, innerText(v.inner)].filter(Boolean);
  return { title, detail: `Data plane · ${parts.join(" · ")}`, color };
}
