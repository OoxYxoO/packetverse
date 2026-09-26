import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX } from "./packetCallout";

/**
 * Readable bubbles / 3D callouts for the SRv6 advanced lessons (TI-LFA,
 * CSID, SR-MPLS vs SRv6). Every value is read back from the PacketVisual
 * the scenario built from its stored post-run state (plus, for CSID, the
 * journey hop the scenario recorded) — never recomputed, so a callout can
 * never re-run an encapsulation, a decapsulation or a CSID advance.
 * Each lesson supplies `name(address)` from its own scenario helpers
 * (e.g. "P1", "P4 End.X+USD→P2", "PE2 End.DT4 (global table)").
 */
export type AddressName = (address: string) => string | undefined;

/** Canonical lowercase IPv6 text (expands "::", drops leading zeros) so differently-written copies of one address compare equal. */
export function canonicalIpv6(address: string): string {
  const [head, tail] = address.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = address.includes("::") ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => String(parseInt(x || "0", 16).toString(16))).join(":");
}
/** 16-bit hextets of an IPv6 address written in any valid textual form. */
export function ipv6Hextets(address: string): number[] {
  return canonicalIpv6(address).split(":").map((x) => parseInt(x, 16));
}

const field = (l: PacketLayer | undefined, re: RegExp) => l?.fields.find((f) => re.test(f.label))?.value;
const layer = (p: PacketVisual, re: RegExp) => p.layers?.find((l) => re.test(l.name));
const named = (name: AddressName, addr: string | undefined) => (addr ? (name(addr) ?? addr) : "?");
const head = (s: string) => s.split(" — ")[0];

// ---------------------------------------------------------------- TI-LFA
export function tiLfaCallout(packet: PacketVisual, name: AddressName): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const repair = layer(packet, /^TI-LFA Repair Outer/);
  const srh = layer(packet, /^Repair SRH/);
  const nested = layer(packet, /L3VPN Outer|Transport Outer/);
  const inner = layer(packet, /^Inner |^IPv6$/);
  const innerDa = field(inner, /^Destination/);
  const nestedKind = nested ? (/L3VPN/.test(nested.name) ? "L3VPN outer" : "transport outer") : undefined;
  const parts: string[] = [];
  const repairDa = field(repair, /^Destination/);
  if (repair) parts.push(`repair outer SA ${named(name, field(repair, /^Source/))} → DA ${repairDa ?? "?"} (${named(name, repairDa)})`);
  if (repair) parts.push(srh ? `repair SRH ${srh.name.replace(/^Repair SRH /, "")}` : "no SRH");
  if (nested) parts.push(`${nestedKind} SA ${named(name, field(nested, /^Source/))} → DA ${named(name, field(nested, /^Destination/))}`);
  if (inner) parts.push(`${/IPv4/.test(inner.name) ? "IPv4" : "IPv6"} ${named(name, field(inner, /^Source/))} → ${named(name, innerDa)}`);
  const detail = parts.join(" · ");

  let title: string;
  switch (packet.badge) {
    case "H.Encaps":
      title = `REPAIR H.ENCAPS · SA ${named(name, field(repair, /^Source/))} · DA ${named(name, field(repair, /^Destination/))} · ${srh ? "SRH" : "no SRH"}`;
      break;
    case "USD DECAP":
      title = `USD · repair outer removed · ${nestedKind ? `${nestedKind} kept · ` : "original packet exposed · "}forced ${packet.from}→${packet.to}`;
      break;
    case "FORWARD":
      title = `IPv6 transit · DA ${named(name, field(repair ?? nested ?? inner, /^Destination/))}`;
      break;
    case "VERIFIED":
      title = `Verified at ${packet.to} · repair outer already removed`;
      break;
    default:
      title = `${head(packet.summary)} · DA ${named(name, field(repair ?? nested ?? inner, /^Destination/))}`;
  }
  return { title, detail, color };
}

// ---------------------------------------------------------------- CSID
/** The recorded journey facts a CSID callout may cite (all copied from the scenario's own hop records). */
export interface CsidHopFacts {
  router: string;
  action: string;
  segmentsLeftBefore?: number;
  segmentsLeftAfter?: number;
  hopLimitBefore: number;
  hopLimitAfter: number;
  indexBefore?: number;
  indexAfter?: number;
}
export function csidCallout(packet: PacketVisual, describeDa: (address: string) => string, hop?: CsidHopFacts): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const ip = layer(packet, /^IPv6 Header/);
  const srh = layer(packet, /^Segment Routing Header/);
  const da = field(ip, /^Destination/) ?? "?";
  const hl = field(ip, /^Hop Limit/);
  const sl = field(srh, /^Segments Left/);
  const le = field(srh, /^Last Entry/);
  const detail = [`DA ${da} (${describeDa(da)})`, srh ? `SRH SL ${sl} / LE ${le}` : "no SRH", `Hop Limit ${hl}`].join(" · ");
  let title: string;
  switch (packet.badge) {
    case "H.Encaps":
      title = `Imposed · ${describeDa(da)} · ${srh ? `SRH SL ${sl}` : "no SRH"}`;
      break;
    case "FIB":
      title = `IPv6 transit · ${describeDa(da)}`;
      break;
    case "SHIFT":
      title = hop ? `NEXT-CSID SHIFT at ${hop.router} · SL unchanged · HL ${hop.hopLimitBefore}→${hop.hopLimitAfter}` : `NEXT-CSID SHIFT · SL unchanged`;
      break;
    case "BOUNDARY":
      title = hop ? `CONTAINER BOUNDARY at ${hop.router} · SL ${hop.segmentsLeftBefore}→${hop.segmentsLeftAfter} · HL ${hop.hopLimitBefore}→${hop.hopLimitAfter}` : "CONTAINER BOUNDARY";
      break;
    case "END.X":
      title = hop ? `End.X + NEXT-CSID at ${hop.router} · forced ${packet.from}→${packet.to} · SL ${hop.segmentsLeftBefore}→${hop.segmentsLeftAfter}` : `End.X + NEXT-CSID · forced ${packet.from}→${packet.to}`;
      break;
    case "REPLACE":
      title = hop && hop.indexAfter !== undefined ? `REPLACE · last advance at ${hop.router}: Index ${hop.indexBefore}→${hop.indexAfter} (packed position ${hop.indexAfter}) · HL ${hop.hopLimitBefore}→${hop.hopLimitAfter}` : `REPLACE · ${describeDa(da)}`;
      break;
    case "MIXED":
      title = `Mixed encoding · ${srh ? `${Number(le) + 1} Segment List entries` : "single entry"} · ${describeDa(da)}`;
      break;
    default:
      title = `${head(packet.summary)} · ${describeDa(da)}`;
  }
  return { title, detail, color };
}

// ---------------------------------------------------------------- SR-MPLS vs SRv6
export function capstoneCallout(packet: PacketVisual, name: AddressName, labelMeaning: (label: string) => string): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const customer = layer(packet, /Customer IPv4|^Inner IPv4/);
  const custText = customer ? `customer IPv4 → ${field(customer, /^Destination/)}` : undefined;
  if (packet.protocol === "MPLS") {
    const shims = (packet.layers ?? []).filter((l) => /^MPLS Shim/.test(l.name));
    const stack = shims.map((l) => `${field(l, /^Label/)} S${field(l, /^S /)}`).join(" / ");
    const top = shims[0] ? field(shims[0], /^Label/) : undefined;
    const title = top ? `SR-MPLS · top ${top} ${labelMeaning(top)} · ${shims.length} label${shims.length > 1 ? "s" : ""}` : "SR-MPLS · no labels";
    return { title, detail: [stack ? `stack ${stack}` : "no labels", custText].filter(Boolean).join(" · "), color };
  }
  const repair = layer(packet, /^TI-LFA Repair Outer/);
  if (repair) {
    const nested = layer(packet, /L3VPN Outer|Transport Outer/);
    const nestedKind = nested && /L3VPN/.test(nested.name) ? "L3VPN outer" : "transport outer";
    return {
      title: `SRv6 repair H.Encaps · SA ${named(name, field(repair, /^Source/))} · DA ${named(name, field(repair, /^Destination/))} · no SRH`,
      detail: [nested ? `${nestedKind} SA ${named(name, field(nested, /^Source/))} → DA ${named(name, field(nested, /^Destination/))}` : undefined, custText].filter(Boolean).join(" · "),
      color,
    };
  }
  const outer = layer(packet, /^Outer IPv6/);
  const srh = layer(packet, /^SRH/);
  const da = field(outer, /^Destination/);
  const isService = !!outer?.fields.some((f) => /Service SID/.test(f.label));
  const title = `${isService ? "SRv6 L3VPN" : "SRv6"} · DA ${named(name, da)} · ${srh ? `SRH SL ${field(srh, /^Segments Left/)}` : "no SRH"}`;
  const list = srh?.fields.filter((f) => /^Segment List/.test(f.label)).map((f) => `${f.label.replace("Segment List", "")} ${f.value}`).join(" · ");
  return { title, detail: [`SA ${named(name, field(outer, /^Source/))}`, list, custText].filter(Boolean).join(" · "), color };
}
