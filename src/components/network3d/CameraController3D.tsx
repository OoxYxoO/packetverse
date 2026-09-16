"use client";

import { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";

interface CameraController3DProps {
  /** World position to fly to and look at, or undefined to stay put / return home. */
  focusPosition?: [number, number, number];
  /** Eye offset from focusPosition — lets device close-ups use a tighter, more front-on framing than the overview does. */
  eyeOffset?: [number, number, number];
  /** Called once after every programmatic fly-to completes. */
  onSettled?: () => void;
}

const HOME_TARGET: [number, number, number] = [0, 0, 0];
const HOME_EYE: [number, number, number] = [0, 6, 11];
const DEFAULT_EYE_OFFSET: [number, number, number] = [1.6, 2.2, 3.6];

/**
 * Wraps drei's <CameraControls> (which already gives free orbit/zoom/pan
 * for "Free Orbit") and adds a programmatic smooth fly-to used when a
 * device/interface/link is clicked, a device is entered, or Follow-Packet
 * mode focuses the active hop.
 */
export function CameraController3D({ focusPosition, eyeOffset = DEFAULT_EYE_OFFSET, onSettled }: CameraController3DProps) {
  const controls = useRef<CameraControls>(null);

  useEffect(() => {
    if (!controls.current) return;
    if (!focusPosition) {
      controls.current.setLookAt(...HOME_EYE, ...HOME_TARGET, true).then(() => onSettled?.());
      return;
    }
    const [x, y, z] = focusPosition;
    const [ex, ey, ez] = eyeOffset;
    controls.current.setLookAt(x + ex, y + ey, z + ez, x, y, z, true).then(() => onSettled?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPosition?.[0], focusPosition?.[1], focusPosition?.[2], eyeOffset[0], eyeOffset[1], eyeOffset[2]]);

  return <CameraControls ref={controls} minDistance={1.2} maxDistance={22} dollyToCursor={false} />;
}
