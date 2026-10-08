"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

const links = [
  { href: "/learn", label: "Learning Map" },
  { href: "/lessons", label: "Lessons" },
  { href: "/demo/arp-resolution", label: "Interactive Demo" },
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
    </header>
  );
}
