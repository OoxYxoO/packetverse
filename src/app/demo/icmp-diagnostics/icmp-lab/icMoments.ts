import type { IcDev, IcIf, IcPkt, IcRun } from "@/lib/sim-engine/scenarios/icmpNet";
import { buildStory, isErr, isRouter, pktCode, pktName, samePkt, stopReason, type Beat, type Story } from "./icStory";

/**
 * The ICMP lab's exchange as the ARP lab plays one: a list of moments, one hop each. A moment carries the packet on
 * the wire (if any), the sentence that explains it, the decision of the device that sent it (or that stopped the one
 * before), and — for the packet that just arrived — its outcome, shown on the device it reached ("✓ for me", "✕ TTL
 * expired"). Built from the story (icStory.ts), i.e. from the model's own frames: nothing is decided here.
 */

export interface IcMoment {
  copy?: { from: IcDev; to: IcDev; pkt: IcPkt };
  caption: string;
  tone: "info" | "ok" | "bad" | "icmp";
  /** The device whose checks explain this moment, with the beat that recorded them. */
  decision?: Beat;
  /** What became of the packet this moment carries, shown on the next moment. */
  outcome?: { at: IcDev; label: string; tone: "ok" | "bad" | "icmp" };
  probe: number;
}

export const MOMENT_MS = 950;

const ifName = (i: IcIf | undefined, vendor: "cisco" | "juniper") => (!i ? "eth0" : vendor === "cisco" ? (i === "ge0" ? "Gi0/0" : "Gi0/1") : i === "ge0" ? "ge-0/0/0" : "ge-0/0/1");
/** Short name on the moving marker. */
export const markerLabel = (p: IcPkt) => `${p.proto === "icmp" ? (isErr(p) ? `⚠ ${pktCode(p)} ${pktName(p)}` : p.kind === "echo-req" ? "Echo Request" : "Echo Reply") : p.proto === "udp" ? `UDP :${p.dport}` : `TCP ${p.tcp}`} · TTL ${p.ttl}${p.frags ? ` · ${p.frags} fragments` : ""}`.replace(/ /g, " ");
/** Outcome labels never wrap either. */
export const nbsp = (t: string) => t.replace(/ /g, " ");

export function icMoments(run: IcRun | undefined, vendor: "cisco" | "juniper"): { story: Story; moments: IcMoment[] } {
  const story = buildStory(run);
  const moments: IcMoment[] = [];
  const bs = story.beats;
  let prefix: string | undefined;
  let decision: Beat | undefined;
  let stopped: Beat | undefined;
  const last = () => moments[moments.length - 1];
  bs.forEach((b, i) => {
    const next = bs[i + 1];
    switch (b.k) {
      case "probe":
        moments.push({ caption: b.text, tone: "info", probe: b.probe });
        break;
      case "send":
        prefix = `${b.at} sends ${pktName(b.pkt)} to ${b.pkt.dst} — TTL ${b.pkt.ttl}${b.pkt.len > 600 ? `, ${b.pkt.len} bytes${b.pkt.df ? ", DF set" : ""}` : ""}${b.pkt.frags ? `, in ${b.pkt.frags} fragments` : ""}`;
        decision = undefined;
        break;
      case "process":
        prefix = `${b.at} forwards it: TTL ${b.prev?.ttl ?? b.pkt.ttl} → ${b.pkt.ttl}${b.dec?.route ? `, route ${b.dec.route.prefix}/${b.dec.route.len} out ${ifName(b.dec.route.out, vendor)}` : ""}${b.pkt.frags && !b.prev?.frags ? ` — in ${b.pkt.frags} fragments (too big for the next link, DF clear)` : ""}`;
        decision = b;
        break;
      case "generate":
        prefix =
          b.role === "report"
            ? `${stopped ? `${b.at}: ${stopReason(stopped.dec, stopped.text)}. It ` : `${b.at} `}writes a NEW packet — ICMP ${pktCode(b.pkt)} ${pktName(b.pkt)}${b.pkt.mtu ? ` (mtu ${b.pkt.mtu})` : ""} — from ${b.pkt.src} back to ${b.pkt.dst}`
            : `${b.at} answers with a NEW packet: ${pktName(b.pkt)} back to ${b.pkt.dst}, fresh TTL ${b.pkt.ttl}`;
        decision = stopped ?? b;
        stopped = undefined;
        break;
      case "travel":
        moments.push({ copy: { from: b.at, to: b.to!, pkt: b.pkt }, caption: prefix ?? `${pktName(b.pkt)}: ${b.at} → ${b.to}, TTL ${b.pkt.ttl}`, tone: isErr(b.pkt) ? "icmp" : b.pkt.kind === "echo-rep" ? "ok" : "info", decision, probe: b.probe });
        prefix = undefined;
        decision = undefined;
        break;
      case "stop": {
        const m = last();
        if (m?.copy && m.copy.to === b.at && samePkt(m.copy.pkt, b.pkt)) m.outcome = { at: b.at, label: `✕ ${stopReason(b.dec, b.text)}`, tone: "bad" };
        if (next?.k === "generate" && next.at === b.at) stopped = b;
        // a silent stop: say what happened on its own moment (the ✕ stays on the device meanwhile)
        else moments.push({ caption: b.text, tone: b.tone === "icmp" ? "icmp" : "bad", decision: b, probe: b.probe });
        break;
      }
      case "receive": {
        const m = last();
        const sender = story.probes[b.probe]?.sender;
        const label = b.at === sender ? (b.pkt.kind === "echo-rep" ? `✓ Echo Reply, ttl=${b.pkt.ttl}` : isErr(b.pkt) || b.pkt.kind === "port" ? `${pktCode(b.pkt)} from ${b.pkt.src}` : `✓ ${pktName(b.pkt)}`) : isRouter(b.at) ? "✓ for me" : "✓ received";
        if (m?.copy && m.copy.to === b.at) m.outcome = { at: b.at, label, tone: b.at === sender && (isErr(b.pkt) || b.pkt.kind === "port") ? "icmp" : "ok" };
        break;
      }
      case "silence":
        moments.push({ caption: b.text, tone: "bad", probe: b.probe });
        break;
      case "loop":
        moments.push({ caption: b.text, tone: "bad", probe: b.probe });
        break;
    }
  });
  return { story, moments };
}
