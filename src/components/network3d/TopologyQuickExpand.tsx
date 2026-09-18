"use client";

import { useState, type ReactNode } from "react";
import { NetworkScene3D } from "./NetworkScene3D";
import { TopologyFrame } from "./TopologyFrame";
import { TopologyFocusMode } from "./TopologyFocusMode";
import { TopologyModeSwitcher } from "./TopologyModeSwitcher";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { ActivePacket3D, Link3DData, Node3DData, Region3DData } from "./types";

interface TopologyQuickExpandProps {
  /** True while a prediction question is the current step and unanswered — see <TopologyFrame>. */
  questionActive: boolean;
  /** The same generic scene data the page already computes for its own normal-mode <NetworkScene3D> call. */
  nodes: Node3DData[];
  links: Link3DData[];
  activePacket?: ActivePacket3D;
  regions?: Region3DData[];
  /** Step-context strip shown inside Focus Mode's header — same as the richer per-lesson Focus Modes. */
  header?: ReactNode;
  /** The page's own compact/normal-mode topology viewport (2D or 3D, whatever the page already renders). */
  children: ReactNode;
}

/**
 * Drop-in "basic Expand" for any lesson that already computes generic
 * Node3DData/Link3DData/ActivePacket3D/Region3DData for its own 3D view
 * but hasn't hand-built a richer Focus Mode (brief §10-12: "every
 * lesson using the shared 3D topology gets basic Expand/Focus Mode").
 * It owns its own open/selection/camera state entirely — it does NOT
 * need the host page's camera-mode state machine, device-interior
 * mode, or any lesson-specific adapter, which is what keeps this
 * genuinely generic instead of one more hand-wired per-lesson copy.
 *
 * Deliberately basic: large 3D topology, Close, Overview/Free Orbit,
 * and click-to-inspect (label/kind/subLabel/badges only — the fields
 * every Node3DData already carries). No Hop Inspector, no PacketDiff,
 * no HopTimeline, no playback controls — a lesson that wants those
 * still hand-builds its own <TopologyFocusMode> (see sr-mpls-foundations
 * or bgp-enterprise) rather than this component faking them.
 */
export function TopologyQuickExpand({ questionActive, nodes, links, activePacket, regions, header, children }: TopologyQuickExpandProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [camMode, setCamMode] = useState<"overview" | "freeOrbit">("overview");

  const selectedNode = nodes.find((n) => n.id === selectedId);
  const focusPosition: [number, number, number] | undefined = camMode === "overview" ? selectedNode?.position : undefined;

  return (
    <>
      <TopologyFrame questionActive={questionActive} onExpand={() => setOpen(true)}>
        {open ? (
          // One-canvas invariant: don't keep the compact view's own WebGL
          // canvas mounted (and rendering) behind the modal once Focus
          // Mode owns a second one.
          <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
        ) : (
          children
        )}
      </TopologyFrame>

      {open && (
        <TopologyFocusMode
          onClose={() => setOpen(false)}
          header={header}
          toolbar={
            <TopologyModeSwitcher
              options={[
                { value: "overview", label: "Overview" },
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={camMode}
              onChange={setCamMode}
              tone="violet"
            />
          }
          canvas={
            <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">
              <NetworkScene3D nodes={nodes} links={links} activePacket={activePacket} regions={regions} onSelectNode={setSelectedId} focusPosition={focusPosition} mode="overview" />
            </div>
          }
          inspector={
            selectedNode ? (
              <GlassPanel strong className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="pv-mono text-sm font-bold text-pv-text">{selectedNode.label}</h3>
                  <Badge tone="cyan">{selectedNode.kind}</Badge>
                </div>
                {selectedNode.subLabel && <p className="text-xs text-pv-text-muted">{selectedNode.subLabel}</p>}
                {selectedNode.badges && selectedNode.badges.length > 0 && <p className="text-[11px] text-pv-cyan-soft">{selectedNode.badges.join(" · ")}</p>}
              </GlassPanel>
            ) : (
              <GlassPanel className="p-4">
                <p className="text-xs text-pv-text-faint">Click a device to inspect it.</p>
              </GlassPanel>
            )
          }
        />
      )}
    </>
  );
}
