"use client";

import { TopologyModeSwitcher } from "./TopologyModeSwitcher";

export type PlaneView = "control" | "data" | "both";

interface PlaneViewSwitcherProps {
  value: PlaneView;
  onChange: (value: PlaneView) => void;
}

/**
 * Generic Control-Plane / Data-Plane / Both switch. Deliberately not
 * named after OSPF — every lesson's control plane and data plane mean
 * something different (OSPF: Hello/DBD/LSU vs. IP forwarding; BGP:
 * UPDATE/best-path vs. user traffic; MPLS: LDP vs. labeled data; EVPN:
 * BGP EVPN vs. VXLAN), but the three-way switch itself is identical,
 * so it lives here once instead of being reimplemented per lesson.
 * The page decides what "control" and "data" actually show; this
 * component only renders the toggle.
 */
export function PlaneViewSwitcher({ value, onChange }: PlaneViewSwitcherProps) {
  return (
    <TopologyModeSwitcher
      options={[
        { value: "control", label: "Control Plane" },
        { value: "data", label: "Data Plane" },
        { value: "both", label: "Both" },
      ]}
      value={value}
      onChange={onChange}
      tone="violet"
    />
  );
}
