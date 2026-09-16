export function Footer() {
  return (
    <footer className="border-t border-pv-border">
      <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-pv-text-faint">
          PacketVerse — <span className="pv-mono">See the packet. Understand the network.</span>
        </p>
        <p className="text-xs text-pv-text-faint">Built for learning. Networking accuracy reviewed against RFC / vendor documentation.</p>
      </div>
    </footer>
  );
}
