import { FLOOD, IP, MAC, type L2State } from "@/lib/sim-engine/scenarios/ccna/layer2Security";

const Row = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => (
  <>
    <dt>{k}</dt>
    <dd className={bad ? "text-pv-danger" : "text-pv-text"}>{v}</dd>
  </>
);

/** Side panel: which controls are on, and what the hosts currently believe (the evidence an engineer would check). */
export function L2Panel({ s }: { s: L2State }) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="ACC-SW controls">
        <h3 className="font-semibold text-pv-text">ACC-SW · VLAN 10 controls</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
          <Row k="MAC table" v={`${s.macCount.toLocaleString()} / ${FLOOD.tableSize.toLocaleString()}`} bad={s.flooding} />
          <Row k="port-security" v={s.portSec ? `max ${s.portSec.max} · ${s.portSec.mode}` : "off"} />
          <Row k="err-disabled" v={s.errDisabled.join(", ") || "—"} />
          <Row k="dhcp snooping" v={s.snooping ? `on · trusted ${s.trusted.join(", ")}` : "off"} />
          <Row k="arp inspection" v={s.dai ? `on${s.arpAcl.length ? " + ARP ACL" : ""}` : "off"} />
          <Row k="RA Guard" v={s.raGuard ? "host role on access ports" : "off"} />
          <Row k="storm-control" v={s.storm ? `broadcast level ${s.storm.level}%` : "off"} />
        </dl>
      </section>
      {s.bindings.length ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="DHCP snooping bindings">
          <h3 className="font-semibold text-pv-text">show ip dhcp snooping binding</h3>
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
            {s.bindings.map((b) => (
              <li key={b.mac}>
                {b.mac} · {b.ip} · VLAN {b.vlan} · {b.port}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="What the hosts believe">
        <h3 className="font-semibold text-pv-text">What the hosts believe</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
          <Row k="PC1 ARP gateway" v={`${IP.gw} → ${s.pc1ArpGw}`} bad={s.pc1ArpGw !== MAC.gw} />
          <Row k="PC1 IPv6 router" v={s.pc1V6Router} bad={s.pc1V6Router.includes("ATK")} />
          <Row k="PC2 gateway" v={s.pc2Gateway ?? "(no lease yet)"} bad={s.pc2Gateway === IP.atk} />
          {s.printer ? <Row k="PC1 → printer" v={s.printerReachable ? `${IP.prn} → ${MAC.prn}` : `${IP.prn} → incomplete`} bad={!s.printerReachable} /> : null}
        </dl>
      </section>
    </div>
  );
}
