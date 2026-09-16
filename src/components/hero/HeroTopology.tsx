"use client";

import dynamic from "next/dynamic";

const HeroScene = dynamic(() => import("./HeroScene").then((m) => m.HeroScene), {
  ssr: false,
  loading: () => null,
});

export function HeroTopology() {
  return (
    <div className="absolute inset-0">
      <HeroScene />
      {/* Soft vignette so the headline/CTA column stays legible over
          the 3D scene without hiding it — nodes near the edges (e.g.
          the laptop and cloud) stay fully visible. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 34% 36% at 50% 44%, rgba(5,7,13,0.96) 0%, rgba(5,7,13,0.85) 60%, transparent 100%)",
        }}
      />
    </div>
  );
}
