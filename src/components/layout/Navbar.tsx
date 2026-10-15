"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

// Certification-first: studying for an exam is the main way in; career tracks and the catalog use the same lessons.
const links = [
  { href: "/certifications", label: "Certifications" },
  { href: "/learn", label: "Career Tracks" },
  { href: "/lessons", label: "Lessons" },
  { href: "/dashboard", label: "Dashboard" },
];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-pv-border bg-pv-bg/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-pv-cyan/10 ring-1 ring-pv-cyan/30">
            <span className="h-2 w-2 rounded-full bg-pv-cyan animate-glow" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-pv-text">PacketVerse</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href) ? "page" : undefined}
              className={clsx(
                "rounded-full px-4 py-2 text-sm transition-colors",
                isActive(pathname, l.href) ? "bg-white/[0.06] text-pv-text" : "text-pv-text-muted hover:text-pv-text",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link href="/demo/arp-resolution">
            <Button size="sm">Try Interactive Demo</Button>
          </Link>
        </div>
      </nav>
      {/* small screens: the same links, one scrollable row (the desktop row is hidden below md) */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-t border-pv-border px-4 py-2 md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(pathname, l.href) ? "page" : undefined}
            className={clsx("shrink-0 rounded-full px-3 py-1.5 text-sm", isActive(pathname, l.href) ? "bg-white/[0.06] text-pv-text" : "text-pv-text-muted")}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
