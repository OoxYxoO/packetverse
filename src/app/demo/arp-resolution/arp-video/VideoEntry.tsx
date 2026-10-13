"use client";

/** How the ARP lesson page opens the interactive video: a header button and a poster card (prototype). */

export function VideoButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-lg border border-pv-warning/50 bg-pv-warning/10 px-3 py-1.5 text-xs font-semibold text-pv-warning transition-colors hover:bg-pv-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-warning">
      ▶ Watch the video <span className="font-normal opacity-80">· prototype</span>
    </button>
  );
}

export function VideoPosterCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-pv-warning/30 bg-gradient-to-r from-[#1a1305] via-[#0b1120] to-[#0b1120] p-3 text-left transition-colors hover:border-pv-warning/60 sm:p-4">
      <span className="relative grid size-16 shrink-0 place-items-center rounded-xl bg-pv-warning/15 sm:size-20">
        <span className="grid size-10 place-items-center rounded-full bg-pv-warning text-[#1a1203] shadow-[0_0_30px_rgba(245,158,11,.45)] transition-transform group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-0.5 size-5" aria-hidden fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-pv-warning">
          Interactive video <span className="rounded-full border border-pv-warning/50 px-1.5 font-semibold normal-case tracking-normal">prototype</span>
        </span>
        <span className="mt-0.5 block text-base font-semibold text-pv-text">How does a computer find a MAC address?</span>
        <span className="block text-sm text-pv-text-muted">A narrated explainer that starts in an office, then follows ARP across the network. It stops now and then to ask what happens next.</span>
      </span>
    </button>
  );
}
