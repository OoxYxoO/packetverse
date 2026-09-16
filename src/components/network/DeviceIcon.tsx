import type { DeviceKind } from "@/lib/sim-engine/types";

/**
 * Distinct SHAPES per device kind (not just color) so device identity
 * survives grayscale / colorblind viewing — see brief §27 / §42.
 */
export function DeviceIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  switch (kind) {
    case "laptop":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="4" width="16" height="10" rx="1.2" />
          <path d="M2 18h20l-1.5-2.5h-17L2 18Z" />
        </svg>
      );
    case "server":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="3" width="16" height="7" rx="1" />
          <rect x="4" y="14" width="16" height="7" rx="1" />
          <circle cx="7.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="7.5" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "switch":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
          <path d="M6.5 10.2h2M6.5 13.8h2M11 10.2h2M11 13.8h2M15.5 10.2h2M15.5 13.8h2" />
        </svg>
      );
    case "router":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="9" width="18" height="7" rx="1.5" />
          <path d="M7 9V6.5a1 1 0 0 1 1-1h2M17 9V6.5a1 1 0 0 0-1-1h-2" />
          <path d="M6 20l2-4M18 20l-2-4" />
        </svg>
      );
    case "firewall":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 2l8 3.5v6C20 16.5 16.6 20 12 22 7.4 20 4 16.5 4 11.5v-6L12 2Z" />
          <path d="M12 6v12M8 9h8M8 15h8" />
        </svg>
      );
    case "accessPoint":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="17" r="1.4" fill="currentColor" stroke="none" />
          <path d="M8.5 14a5 5 0 0 1 7 0M5.5 11a9 9 0 0 1 13 0" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M7 18a4 4 0 1 1 .7-7.94A5 5 0 0 1 17.5 12H18a3.5 3.5 0 0 1 0 7H7Z" />
        </svg>
      );
    case "pe-router":
    case "p-router":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="9" width="18" height="7" rx="1.5" />
          <path d="M9 9V7M15 9V7" />
          <circle cx="9" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}
