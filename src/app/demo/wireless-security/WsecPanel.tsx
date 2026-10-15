import { sessionExposed, type Wlan, type WsecState } from "@/lib/sim-engine/scenarios/ccna/wirelessSecurity";

/** Side panel: WLANs and their security, who joined with what, and what the listener in range can read. */
export function WsecPanel({ s }: { s: WsecState }) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="WLANs">
        <h3 className="font-semibold text-pv-text">WLC · WLANs</h3>
        <ul className="mt-2 space-y-1 font-mono text-[10.5px] text-pv-text-muted">
          {s.wlans.map((w) => (
            <li key={w.ssid}>
              <span className="text-pv-text">{w.ssid}</span> · VLAN {w.vlan} · {w.akms.join(" + ")} · PMF {w.pmf}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Clients and listener">
        <h3 className="font-semibold text-pv-text">Clients</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
          {Object.entries(s.joined).map(([c, a]) => (
            <div key={c} className="contents">
              <dt>{c}</dt>
              <dd className={a === "refused" ? "text-pv-danger" : "text-pv-text"}>
                {a === "refused" ? "association refused" : `${a}${sessionExposed(a) ? " · key derivable by PSK holders" : " · private session key"}`}
              </dd>
            </div>
          ))}
          <dt>listener</dt>
          <dd className={s.listenerReads.startsWith("everything") ? "text-pv-danger" : "text-pv-text"}>{s.listenerReads}</dd>
        </dl>
        {s.handshake.length ? <p className="mt-2 font-mono text-[10.5px] text-pv-text-faint">4-way: {s.handshake.join(" → ")}</p> : null}
      </section>
    </div>
  );
}

/** A read-only mock of a WLC's WLAN security page (AireOS-style), filled from the model. */
export function WlcGuiCard({ w }: { w: Wlan }) {
  const psk = w.akms.includes("WPA2-PSK");
  const sae = w.akms.includes("WPA3-SAE");
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-3 border-b border-white/5 py-1 last:border-0">
      <span className="text-pv-text-muted">{k}</span>
      <span className="text-right font-mono text-pv-text">{v}</span>
    </div>
  );
  return (
    <figure className="rounded-xl border border-pv-border bg-[#05080d] p-3 text-xs" aria-label={`WLC GUI: WLANs › Edit '${w.ssid}'`}>
      <figcaption className="mb-2 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">WLANs › Edit &apos;{w.ssid}&apos; › Security › Layer 2</figcaption>
      {row("Profile / SSID", `${w.ssid} / ${w.ssid}`)}
      {row("Interface", `vlan${w.vlan}`)}
      {row("Layer 2 Security", psk && sae ? "WPA2 + WPA3" : sae ? "WPA3" : "WPA+WPA2")}
      {row("WPA2 Policy / Encryption", psk ? "✓ / AES" : "—")}
      {row("WPA3 Policy", sae ? "✓" : "—")}
      {row("Auth Key Mgmt", [psk && "PSK", sae && "SAE"].filter(Boolean).join(" + ") || "—")}
      {row("PSK Format", psk || sae ? "ASCII · 8–63 characters" : "—")}
      {row("PMF", w.pmf)}
    </figure>
  );
}
