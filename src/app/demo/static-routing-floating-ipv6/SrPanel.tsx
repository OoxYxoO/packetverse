import { CliPanel } from "@/components/lesson/GuideCli";
import { contenders, rib, routeText, type SrState } from "@/lib/sim-engine/scenarios/ccna/staticRouting";

export const showIpRoute = (s: SrState) => ({
  prompt: "R1#",
  command: "show ip route",
  output: ["Codes: L - local, C - connected, S - static, O - OSPF, * - candidate default", "Gateway of last resort is " + (rib(s).find((r) => r.len === 0)?.via ?? "not set"), "", ...rib(s).filter((r) => r.proto !== "L").map(routeText)].join("\n"),
});
export const showIpv6Route = (s: SrState) => ({ prompt: "R1#", command: "show ipv6 route static", output: rib(s, 6).filter((r) => r.proto === "S").map(routeText).join("\n") || "(none)" });

/** Side panel: R1's routing table, and every contender for the prefixes the lesson fights over. */
export function SrPanel({ s }: { s: SrState }) {
  const fights: [string, number][] = [
    ["0.0.0.0", 0],
    ["10.50.0.0", 16],
  ];
  return (
    <div className="space-y-3 text-xs">
      <CliPanel run={showIpRoute(s)} caption="R1 · IPv4 routing table" />
      {rib(s, 6).some((r) => r.proto === "S") ? <CliPanel run={showIpv6Route(s)} caption="R1 · IPv6 static routes" /> : null}
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Contenders per prefix">
        <h3 className="font-semibold text-pv-text">Who competes for each prefix</h3>
        {fights.map(([p, l]) => (
          <div key={p} className="mt-2">
            <p className="font-mono text-pv-text-muted">
              {p}/{l}
            </p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[10.5px]">
              {contenders(s, p, l).map(({ c, installed, usable }, i) => (
                <li key={i} className={`flex justify-between gap-2 ${installed ? "text-pv-success" : usable ? "text-pv-text-muted" : "text-pv-text-faint line-through"}`}>
                  <span>
                    {c.proto} AD {c.ad} via {c.via}
                    {c.note ? ` (${c.note})` : ""}
                  </span>
                  <span>{installed ? "installed" : usable ? "standing by" : "interface down"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      {s.traces.length ? (
        <ul className="space-y-0.5 rounded-xl border border-pv-border p-3 font-mono text-[10.5px] text-pv-text-muted" aria-label="Forwarding decisions so far">
          {s.traces.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
