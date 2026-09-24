"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export interface LessonGuideSectionLink {
  id: string;
  label: string;
}

interface LessonGuideDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  sections: LessonGuideSectionLink[];
  children: ReactNode;
}

/** Keys that copy, select-all, print, save or view source when combined with Ctrl/⌘. */
const BLOCKED_SHORTCUT_KEYS = new Set(["c", "x", "a", "p", "s", "u"]);

/**
 * In-app study-guide reader with BEST-EFFORT copy deterrence. It disables
 * text selection, copy/cut, the context menu, dragging, the common
 * Ctrl/⌘ shortcuts and printing, and it covers the content when the window
 * loses focus or PrintScreen is pressed. None of this can truly prevent
 * screenshots, other devices, dev tools or reading the page source: the
 * web platform does not allow it. It only removes the easy paths.
 */
export function LessonGuideDialog({ open, onClose, title, subtitle, sections, children }: LessonGuideDialogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shielded, setShielded] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [activeSection, setActiveSection] = useState<string | undefined>(sections[0]?.id);

  const flash = useCallback((msg: string) => setNotice(msg), []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && BLOCKED_SHORTCUT_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        flash(e.key.toLowerCase() === "p" ? "Printing is disabled for the Lesson Guide." : "Copying is disabled in the Lesson Guide.");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        setShielded(true);
        // Best effort only: overwrite whatever the OS just put on the clipboard (may be refused by the browser).
        navigator.clipboard?.writeText("").catch(() => {});
        flash("Screenshots of the Lesson Guide are discouraged.");
      }
    };
    const onBlur = () => setShielded(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setShielded(true);
    };
    const onBeforePrint = () => setShielded(true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeprint", onBeforePrint);
    document.addEventListener("visibilitychange", onVisibility);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeprint", onBeforePrint);
      document.removeEventListener("visibilitychange", onVisibility);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, flash]);

  // Highlight the section currently in view in the side navigation.
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((en) => en.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { root, rootMargin: "0px 0px -65% 0px" },
    );
    sections.forEach((s) => {
      const el = root.querySelector(`#${CSS.escape(s.id)}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [open, sections]);

  if (!open) return null;

  const block = (e: { preventDefault: () => void }, msg = "Copying is disabled in the Lesson Guide.") => {
    e.preventDefault();
    flash(msg);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      {/* Printing the page while the guide is open yields only a notice. */}
      <style>{`@media print { body { visibility: hidden !important; } html::before { visibility: visible; content: "The PacketVerse Lesson Guide can't be printed."; font: 16px sans-serif; } }`}</style>
      <div
        className="pv-guide-protected relative flex h-[94vh] w-full max-w-6xl select-none flex-col overflow-hidden rounded-2xl border border-pv-border bg-pv-bg-elevated shadow-2xl [-webkit-touch-callout:none] print:hidden"
        onCopy={(e) => block(e)}
        onCut={(e) => block(e)}
        onContextMenu={(e) => block(e, "The context menu is disabled in the Lesson Guide.")}
        onDragStart={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          // Double/triple-click word/paragraph selection.
          if (e.detail > 1) e.preventDefault();
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-pv-border bg-white/[0.02] px-5 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-pv-cyan-soft">Lesson Guide</p>
            <h2 className="truncate text-lg font-semibold text-pv-text">{title}</h2>
            {subtitle && <p className="truncate text-xs text-pv-text-faint">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close Lesson Guide">
            ✕ Close
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-pv-border p-3 md:block" aria-label="Guide sections">
            <ol className="space-y-0.5">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollRef.current?.querySelector(`#${CSS.escape(s.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className={
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors " +
                      (activeSection === s.id ? "bg-pv-cyan/10 font-semibold text-pv-cyan-soft" : "text-pv-text-faint hover:bg-white/5 hover:text-pv-text")
                    }
                  >
                    <span className="pv-mono w-4 shrink-0 text-[10px] opacity-70">{String(i + 1).padStart(2, "0")}</span>
                    {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-10 px-5 py-8 sm:px-8">{children}</div>
            </div>
            <Watermark />
          </div>
        </div>

        <footer className="shrink-0 border-t border-pv-border px-5 py-2 text-[10px] text-pv-text-faint">
          Protected study material · © PacketVerse · for personal learning inside the app
        </footer>

        {shielded && (
          <button
            type="button"
            onClick={() => setShielded(false)}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-pv-bg-elevated/95 text-center backdrop-blur-xl"
          >
            <span className="text-3xl" aria-hidden>
              🔒
            </span>
            <span className="text-sm font-semibold text-pv-text">Lesson Guide paused</span>
            <span className="max-w-xs text-xs text-pv-text-muted">The guide is hidden while this window is inactive. Click anywhere to continue reading.</span>
          </button>
        )}

        {notice && (
          <div role="status" className="absolute bottom-12 left-1/2 z-30 -translate-x-1/2 rounded-full border border-pv-warning/40 bg-black/85 px-4 py-2 text-xs font-medium text-pv-warning shadow-lg">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}

function Watermark() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id="pv-guide-watermark" width="260" height="160" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <text x="0" y="90" fill="currentColor" className="text-white" fontSize="13" fontFamily="monospace" opacity="0.035">
            PacketVerse · Lesson Guide
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#pv-guide-watermark)" />
    </svg>
  );
}
