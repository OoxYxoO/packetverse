"use client";

import { Fragment, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DeviceInterfaceData, NodeExplanation } from "./types";

export interface DeviceExplorerTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface DeviceExplorerPanelProps {
  explanation: NodeExplanation;
  /** Lesson-supplied tab set — different lessons need different tabs (MPLS: Tables/Control Plane; OSPF: Neighbors/LSDB/Routes), so the shell only owns the header + tab strip. */
  tabs: DeviceExplorerTab[];
  xrayEnabled: boolean;
  onToggleXray: () => void;
  onExit: () => void;
  /** Override the X-Ray toggle's "on" label — defaults to "X-Ray"; a lesson with a meaningful control/data-plane split (BGP: "Control-Plane X-Ray") can be explicit about what X-Ray shows. */
  xrayOnLabel?: string;
}

/**
 * Device Explorer UI (brief §13) — a generic tabbed shell shown while
 * a device is entered. It owns only the header (name/role/X-Ray
 * toggle/exit) and the tab strip; every tab's content is supplied by
 * the lesson page, so this component carries no protocol-specific
 * knowledge of what tabs a given protocol needs.
 */
export function DeviceExplorerPanel({ explanation, tabs, xrayEnabled, onToggleXray, onExit, xrayOnLabel = "X-Ray" }: DeviceExplorerPanelProps) {
  const [tabId, setTabId] = useState<string>(tabs[0]?.id ?? "");
  const active = tabs.find((t) => t.id === tabId) ?? tabs[0];

  return (
    <GlassPanel strong className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="pv-mono text-lg font-bold text-pv-text">{explanation.name}</h3>
          <p className="text-[11px] uppercase tracking-wide text-pv-text-faint">{explanation.deviceType}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="cyan">{explanation.role}</Badge>
          <button
            type="button"
            onClick={onToggleXray}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
              xrayEnabled ? "border-pv-violet/50 bg-pv-violet/15 text-pv-violet" : "border-pv-border text-pv-text-faint hover:text-pv-text",
            )}
          >
            {xrayEnabled ? xrayOnLabel : "Exterior"}
          </button>
          <Button variant="ghost" size="sm" onClick={onExit}>
            ← Overview
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTabId(t.id)}
            className={clsx(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
              (tabId || tabs[0]?.id) === t.id ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>{active?.content}</div>
    </GlassPanel>
  );
}

interface InterfaceListTabProps {
  interfaces: DeviceInterfaceData[];
  selectedInterfaceId?: string;
  onSelectInterface: (id: string) => void;
}

/**
 * Reusable "pick a port, see its detail grid" tab body (brief §2/§17)
 * — the generic fields every lesson has (status/ip/neighbor/link
 * type/mtu/protocols/packets/role) plus whatever protocol-specific
 * fields the lesson's adapter put in `extra` (OSPF's Area/Cost/Hello/
 * Dead/Network Type/Neighbor State, say). Exported so any lesson's
 * Device Explorer "Interfaces" tab can reuse it verbatim.
 */
export function InterfaceListTab({ interfaces, selectedInterfaceId, onSelectInterface }: InterfaceListTabProps) {
  const selectedInterface = interfaces.find((i) => i.id === selectedInterfaceId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {interfaces.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onSelectInterface(i.id)}
            className={clsx(
              "rounded-lg border px-2.5 py-1.5 pv-mono text-[11px] transition-colors",
              selectedInterfaceId === i.id ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text",
            )}
          >
            {i.name}
          </button>
        ))}
      </div>
      {selectedInterface ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-pv-border p-3 pv-mono text-[11px]">
          <span className="text-pv-text-faint">Interface</span>
          <span className="text-pv-text">{selectedInterface.name}</span>
          <span className="text-pv-text-faint">Status</span>
          <span className={selectedInterface.status === "up" ? "text-pv-success" : "text-pv-danger"}>{selectedInterface.status.toUpperCase()}</span>
          <span className="text-pv-text-faint">IP address</span>
          <span className="text-pv-text">{selectedInterface.ip ?? "—"}</span>
          <span className="text-pv-text-faint">Neighbor</span>
          <span className="text-pv-text">{selectedInterface.neighborLabel ?? "—"}</span>
          <span className="text-pv-text-faint">Link type</span>
          <span className="text-pv-text">{selectedInterface.linkType ?? "—"}</span>
          <span className="text-pv-text-faint">MTU</span>
          <span className="text-pv-text">{selectedInterface.mtu ?? "—"}</span>
          <span className="text-pv-text-faint">Protocols</span>
          <span className="text-pv-text">{selectedInterface.protocols?.join(", ") ?? "—"}</span>
          <span className="text-pv-text-faint">Packets this session</span>
          <span className="text-pv-text">{selectedInterface.packetCount ?? 0}</span>
          <span className="text-pv-text-faint">Role right now</span>
          <span className={clsx(selectedInterface.role === "ingress" ? "text-pv-cyan-soft" : selectedInterface.role === "egress" ? "text-pv-success" : "text-pv-text-faint")}>
            {selectedInterface.role === "idle" ? "not in use" : selectedInterface.role}
          </span>
          {selectedInterface.extra?.map((f) => (
            <Fragment key={f.label}>
              <span className="text-pv-text-faint">{f.label}</span>
              <span className="text-pv-text">{f.value}</span>
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">Click a port in the 3D view, or an interface above, to inspect it.</p>
      )}
    </div>
  );
}
