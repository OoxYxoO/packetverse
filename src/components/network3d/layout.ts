import type { DeviceKind } from "@/lib/sim-engine/types";
import type { Node3DData, Region3DData } from "./types";

interface FlatGraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
  kind?: DeviceKind;
}

interface FlatGraphRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: Region3DData["tone"];
}

/**
 * Maps the existing 2D {x,y} percentage layout (the same GRAPH_NODES
 * every lesson already exports for <GraphTopologyViewer>) into 3D
 * world space, adding a depth offset per device kind purely for visual
 * interest — a P router sits slightly back from the PE/CE edge nodes
 * so the core reads as a "core" instead of a flat line. This is a
 * rendering-layout concern only; it invents no new topology data.
 */
export function layoutTo3D(nodes: FlatGraphNode[], opts?: { spread?: number; depth?: number }): Node3DData[] {
  const spread = opts?.spread ?? 16;
  const depth = opts?.depth ?? 3.2;
  return nodes.map((n) => {
    const kind = n.kind ?? "router";
    const worldX = ((n.x - 50) / 100) * spread;
    const zBias = kind === "p-router" ? -depth * 0.55 : kind === "pe-router" ? depth * 0.15 : depth * 0.55;
    const worldZ = ((n.y - 50) / 100) * depth + zBias;
    return { id: n.id, label: n.label, subLabel: n.subLabel, kind, position: [worldX, 0, worldZ], status: "idle" };
  });
}

/**
 * Same percent-space → world-space mapping as `layoutTo3D`, for the
 * boundary boxes a lesson draws behind its nodes (brief: "AS regions
 * should have depth/boundaries") — reuses the identical {x,y}
 * percentage space every lesson's 2D `GraphRegion[]` already uses, so
 * a region and the nodes inside it are guaranteed to line up. A flat
 * floor height is used for every region (`floorHeight`) rather than
 * inventing per-region depth data that doesn't exist in 2D.
 */
export function layoutRegionsTo3D(regions: FlatGraphRegion[], opts?: { spread?: number; depth?: number; floorHeight?: number }): Region3DData[] {
  const spread = opts?.spread ?? 16;
  const depth = opts?.depth ?? 3.2;
  const floorHeight = opts?.floorHeight ?? 1.6;
  return regions.map((r) => {
    const worldX = ((r.x + r.width / 2 - 50) / 100) * spread;
    const worldZ = ((r.y + r.height / 2 - 50) / 100) * depth;
    const worldW = (r.width / 100) * spread;
    const worldD = (r.height / 100) * depth;
    return { id: r.id, label: r.label, center: [worldX, -0.3, worldZ], size: [Math.max(worldW, 1.2), floorHeight, Math.max(worldD, 1.2)], tone: r.tone };
  });
}
