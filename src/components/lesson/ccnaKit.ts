import type { PacketVisual } from "@/lib/sim-engine/types";
import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole, NodeExplanation, PacketCallout3D, ProcessingStage } from "@/components/network3d/types";
import type { KitBase } from "@/lib/sim-engine/scenarios/ccna/kit";
import { traceFromHops } from "./fundamentalsTrace";

/**
 * Page-side adapters for the CCNA lessons: from a short device catalog (what each device IS, which ports it has, what
 * it knows right now — all read from the model state) to everything the shared lesson shell asks for: device traces,
 * interface lists, node explanations, tables and packet callouts. No protocol logic lives here.
 */
export interface KitPort {
  id: string;
  neighbor?: string;
  /** Human label for the far end, e.g. "SW1 Gi1/0/1" (defaults to the neighbor id). */
  neighborLabel?: string;
  linkType: string;
  up?: boolean;
  ip?: string;
  extra?: [string, string][];
}
export interface KitDevice<S> {
  id: string;
  deviceType: string;
  role: string;
  /** The stage table used when the device is idle at a step. */
  stages: ProcessingStage[];
  ports: (s: S) => KitPort[];
  /** What it knows right now (one line, from state). */
  knows: (s: S) => string;
  tables?: (s: S) => { title: string; rows: { label: string; value: string }[] }[];
  /** An optional extra line for the inspector (e.g. a fault hint that is visible on the device itself). */
  note?: (s: S) => string | undefined;
}

const roleAt = <S extends KitBase>(s: S, device: string, stepId: string, port: string): InterfaceRole => {
  const h = [...s.hops].reverse().find((x) => x.device === device && x.stepId === stepId);
  if (!h) return "idle";
  if (h.ingressInterfaceId === port) return "ingress";
  if (h.egressInterfaceId === port || h.egressInterfaceIds?.includes(port)) return "egress";
  return "idle";
};

export function kitAdapters<S extends KitBase>(devices: KitDevice<S>[], pipelineName = "Processing pipeline") {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const dev = (id: string) => byId.get(id);
  return {
    traceFor: (device: string, s: S, stepId: string): DeviceProcessingTrace => traceFromHops(device, s.hops, stepId, dev(device)?.stages ?? []),
    interfacesFor: (device: string, s: S, stepId: string): DeviceInterfaceData[] =>
      (dev(device)?.ports(s) ?? []).map((p) => ({
        id: p.id,
        name: p.id,
        status: p.up === false ? "down" : "up",
        ip: p.ip,
        neighborId: p.neighbor,
        neighborLabel: p.neighborLabel ?? p.neighbor ?? "no link",
        linkType: p.linkType,
        role: roleAt(s, device, stepId, p.id),
        extra: p.extra?.map(([label, value]) => ({ label, value })),
      })),
    pipelineTitle: (device: string) => `${device} · ${pipelineName}`,
    tablesFor: (device: string, s: S) => dev(device)?.tables?.(s) ?? [],
    explainNode: (s: S, id: string, stepId: string): NodeExplanation => {
      const d = dev(id);
      const h = [...s.hops].reverse().find((x) => x.device === id && x.stepId === stepId);
      const knows = d?.knows(s) ?? "";
      return {
        id,
        name: id,
        deviceType: d?.deviceType ?? "Device",
        role: d?.role ?? "",
        currentAction: h ? `${h.action}: ${h.reason}` : `Idle this step. ${knows}`,
        controlPlaneRole: knows,
        dataPlaneRole: h ? `Received: ${h.input || "—"}. Lookup: ${h.lookupKey || "—"} → ${h.lookupResult || "—"}. Sent: ${h.output || "—"}.` : undefined,
        packetBefore: h?.input,
        packetAfter: h?.output,
        note: d?.note?.(s),
        tables: d?.tables?.(s),
      };
    },
  };
}

const HEX: Record<PacketVisual["protocol"], string> = { ARP: "#f59e0b", ETHERNET: "#94a3b8", IP: "#60a5fa", IPV6: "#38bdf8", TCP: "#34d399", HTTPS: "#34d399", OSPF: "#22d3ee", BGP: "#fb7185", MPLS: "#f472b6", VXLAN: "#facc15" };

/** A packet callout: the packet's own badge and summary, plus the device's latest decision when it is at this hop. */
export function kitCallout<S extends KitBase>(p: PacketVisual, s: S): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const badge = p.badge ?? p.protocol;
  return { title: p.summary.startsWith(badge) ? p.summary : `${badge} · ${p.summary}`, detail: decision, color: HEX[p.protocol] };
}
