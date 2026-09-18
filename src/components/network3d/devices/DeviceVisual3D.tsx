"use client";

import type { DeviceVisualKind } from "../types";
import { Router3D } from "./Router3D";
import { Switch3D } from "./Switch3D";
import { Firewall3D } from "./Firewall3D";
import { Server3D } from "./Server3D";
import { Host3D } from "./Host3D";
import { Cloud3D } from "./Cloud3D";
import { GenericNetwork3D } from "./GenericNetwork3D";

interface DeviceVisual3DProps {
  visualKind: DeviceVisualKind;
  accentColor: string;
  glow: number;
}

/**
 * Single dispatch point from `DeviceVisualKind` → the actual procedural
 * chassis mesh (brief §36). This is the seam <NetworkNode3D> renders
 * through instead of a plain `boxGeometry` — swapping/adding a shape
 * never touches the node/selection/label logic around it.
 */
export function DeviceVisual3D({ visualKind, accentColor, glow }: DeviceVisual3DProps) {
  switch (visualKind) {
    case "ROUTER":
      return <Router3D accentColor={accentColor} glow={glow} />;
    case "SWITCH":
      return <Switch3D accentColor={accentColor} glow={glow} />;
    case "FIREWALL":
      return <Firewall3D accentColor={accentColor} glow={glow} />;
    case "SERVER":
      return <Server3D accentColor={accentColor} glow={glow} />;
    case "HOST":
      return <Host3D accentColor={accentColor} glow={glow} />;
    case "CLOUD":
      return <Cloud3D accentColor={accentColor} glow={glow} />;
    default:
      return <GenericNetwork3D accentColor={accentColor} glow={glow} />;
  }
}
