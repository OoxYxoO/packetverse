"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

export interface LessonGuideSectionLink {
  id: string;
  label: string;
}

/** One top-level part of a guide (e.g. "This Lesson" vs a general deep dive), with its own section navigation. */
export interface LessonGuideTab {
  id: string;
  label: string;
  /** Short line under the tab label, e.g. "ARP inside this scenario". */
  hint?: string;
  sections: LessonGuideSectionLink[];
  content: ReactNode;
}

interface LessonGuideDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tabs: LessonGuideTab[];
}

/** Keys that copy, select-all, print, save or view source when combined with Ctrl/⌘. */
const BLOCKED_SHORTCUT_KEYS = new Set(["c", "x", "a", "p", "s", "u"]);

/**
 * In-app study-guide reader with top-level tabs, an expanded reading mode,
 * and BEST-EFFORT copy deterrence. It disables text selection, copy/cut,
 * the context menu, dragging, the common Ctrl/⌘ shortcuts and printing,
 * and it covers the content when the window loses focus or PrintScreen is
 * pressed. None of this can truly prevent screenshots, other devices, dev
 * tools or reading the page source: the web platform does not allow it. It
 * only removes the easy paths.
 */
export function LessonGuideDialog({ open, onClose, title, subtitle, tabs }: LessonGuideDialogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shielded, setShielded] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [tabId, setTabId] = useState(tabs[0]?.id);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const sections = tab?.sections ?? [];
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

  // Highlight the section currently in view in the side navigation (re-registered per tab).
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
    tab?.sections.forEach((s) => {
      const el = root.querySelector(`#${CSS.escape(s.id)}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [open, tab]);

  if (!open || !tab) return null;

  const block = (e: { preventDefault: () => void }, msg = "Copying is disabled in the Lesson Guide.") => {
    e.preventDefault();
    flash(msg);
  };

  const switchTab = (id: string) => {
    if (id === tab.id) return;
    const next = tabs.find((t) => t.id === id);
    setTabId(id);
    setActiveSection(next?.sections[0]?.id);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div
      className={clsx("fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm", expanded ? "p-0" : "p-2 sm:p-4")}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Printing the page while the guide is open yields only a notice. */}
      <style>{`@media print { body { visibility: hidden !important; } html::before { visibility: visible; content: "The PacketVerse Lesson Guide can't be printed."; font: 16px sans-serif; } }`}</style>
      <div
        className={clsx(
          "pv-guide-protected relative flex w-full select-none flex-col overflow-hidden border-pv-border bg-pv-bg-elevated shadow-2xl [-webkit-touch-callout:none] print:hidden",
          expanded ? "h-[100dvh] max-w-none rounded-none border-0" : "h-[94vh] max-w-6xl rounded-2xl border",
        )}
        data-expanded={expanded ? "true" : "false"}
        onCopy={(e) => block(e)}
        onCut={(e) => block(e)}
        onContextMenu={(e) => block(e, "The context menu is disabled in the Lesson Guide.")}
        onDragStart={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          // Double/triple-click word/paragraph selection.
          if (e.detail > 1) e.preventDefault();
        }}
      >
        <header className="shrink-0 border-b border-pv-border bg-white/[0.02] px-4 pt-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-pv-cyan-soft">Lesson Guide</p>
              <h2 className="truncate text-lg font-semibold text-pv-text">{title}</h2>
              {subtitle && <p className="truncate text-xs text-pv-text-faint">{subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-pressed={expanded}
                aria-label={expanded ? "Shrink Lesson Guide" : "Expand Lesson Guide"}
                className="flex items-center gap-1.5 rounded-full border border-pv-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-muted transition-colors hover:border-pv-cyan/50 hover:text-pv-cyan-soft"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  {expanded ? (
                    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
                <span className="hidden sm:inline">{expanded ? "Shrink" : "Expand"}</span>
              </button>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close Lesson Guide">
                ✕ Close
              </Button>
            </div>
          </div>

          <div role="tablist" aria-label="Guide parts" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const selected = t.id === tab.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => switchTab(t.id)}
                  className={clsx(
                    "shrink-0 rounded-t-xl border border-b-0 px-4 py-2 text-left transition-colors",
                    selected ? "border-pv-border bg-pv-bg-elevated text-pv-text" : "border-transparent text-pv-text-faint hover:bg-white/[0.03] hover:text-pv-text-muted",
                  )}
                >
                  <span className={clsx("block text-sm font-semibold", selected && "text-pv-cyan-soft")}>{t.label}</span>
                  {t.hint && <span className="block text-[10px] text-pv-text-faint">{t.hint}</span>}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className={clsx("hidden shrink-0 overflow-y-auto border-r border-pv-border p-3 md:block", expanded ? "w-64 lg:w-72" : "w-56")} aria-label={`${tab.label} sections`}>
            <p className="px-2.5 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text-faint">{tab.label}</p>
            <ol className="space-y-0.5">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollRef.current?.querySelector(`#${CSS.escape(s.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                      expanded ? "text-[13px]" : "text-xs",
                      activeSection === s.id ? "bg-pv-cyan/10 font-semibold text-pv-cyan-soft" : "text-pv-text-faint hover:bg-white/5 hover:text-pv-text",
                    )}
                  >
                    <span className="pv-mono w-4 shrink-0 text-[10px] opacity-70">{String(i + 1).padStart(2, "0")}</span>
                    {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" role="tabpanel" aria-label={tab.label}>
              <div className={clsx("mx-auto space-y-10 px-5 py-8 sm:px-8", expanded ? "max-w-4xl sm:py-10 [&_.text-sm]:text-[15px] [&_.text-xs]:text-[13px]" : "max-w-3xl")}>{tab.content}</div>
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
