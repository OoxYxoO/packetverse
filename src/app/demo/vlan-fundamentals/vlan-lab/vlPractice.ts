import { BCAST, RTR_PORT, TRUNK, VL_HOSTS, netOf, vlHostLinkUp, type VlCfg, type VlHost, type VlRun, type VlState } from "@/lib/sim-engine/scenarios/vlanNet";

/**
 * Hands-on challenges of the VLAN Lab's engineering workspace. Each is checked against the network itself — the runs
 * it carried, what was captured where, its configuration — never against what was typed or clicked.
 */

export interface VlChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: VlState) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: VlState) => string;
}
const vlanOf = (cfg: VlCfg, h: VlHost): number | undefined => {
  const at = cfg.hosts[h].at;
  if (!at) return undefined;
  const p = cfg.sw[at.sw].ports[at.port];
  return p.mode === "access" ? p.access : undefined;
};
const capsOf = (s: VlState, r: VlRun) => s.captures.filter((c) => c.run === r.id);
const pings = (s: VlState, from: string, to: string | undefined, fresh = true) => s.runs.filter((r) => (!fresh || r.cfgSeq === s.cfgSeq) && r.results.some((x) => x.send.kind === "ping" && x.send.from === from && x.send.to === to));

export const VL_CHALLENGES: VlChallenge[] = [
  {
    id: "isolation",
    title: "Prove that a broadcast stays in its VLAN",
    how: "Send one ARP request (Generate traffic → broadcasts). It must reach every other host of its VLAN — on both switches — and no host of the other VLAN.",
    done: (s) =>
      s.runs.some((r) => {
        const send = r.results[0]?.send;
        if (!send || send.kind !== "arp" || send.from === "R1") return false;
        const v = vlanOf(s.cfg, send.from);
        const rx = r.waves.flatMap((w) => w.rx).filter((x) => x.frame.dst === BCAST && x.frame.from === send.from);
        const same = VL_HOSTS.filter((h) => h !== send.from && vlHostLinkUp(s.cfg, h) && vlanOf(s.cfg, h) === v);
        const others = VL_HOSTS.filter((h) => h !== send.from && vlanOf(s.cfg, h) !== v);
        return v !== undefined && same.some((h) => s.cfg.hosts[h].at!.sw !== s.cfg.hosts[send.from as VlHost].at?.sw) && same.every((h) => rx.some((x) => x.dev === h)) && others.every((h) => !rx.some((x) => x.dev === h));
      }),
    next: (s) => {
      const arps = s.runs.filter((r) => r.results[0]?.send.kind === "arp" && r.results[0].send.from !== "R1");
      if (!arps.length) return "No ARP request sent yet. Choose “broadcasts an ARP request for” in Generate traffic: a ping doesn't count.";
      return "Your broadcast didn't reach every host of its VLAN on both switches, or it reached the other VLAN. Check the Journey: which ports did it leave through, and does the trunk carry that VLAN?";
    },
  },
  {
    id: "tagged",
    title: "Catch the same frame tagged and untagged",
    how: "Capture one frame twice: on the SW1↔SW2 trunk (tagged with its VID) and on an access port (no tag). Open the trunk port's capture and a host port's capture of the same run.",
    done: (s) => s.runs.some((r) => { const cs = capsOf(s, r); return cs.some((t) => t.point.endsWith(TRUNK) && t.vid !== undefined && cs.some((a) => a.frame.id === t.frame.id && a.vid === undefined && /ge-0\/0\/[12]$/.test(a.point))); }),
    next: (s) =>
      s.runs.length
        ? "None of your runs crossed the SW1↔SW2 trunk tagged. Send between two hosts of the same VLAN on different switches (HOST-A → HOST-B), then compare the trunk's capture with a host port's."
        : "Send a frame that crosses the trunk: HOST-A pings HOST-B. Then open the captures on ge-0/0/24 and on ge-0/0/1.",
  },
  {
    id: "moveD",
    title: "Move HOST-D into Sales",
    how: "Make HOST-D a VLAN 10 host: its switch port (access VLAN) AND its address (sudo ip addr … in its Shell, plus a gateway). Prove it: HOST-D pings HOST-A with TTL 64 — same VLAN, no router.",
    done: (s) => {
      const d = s.cfg.hosts["HOST-D"];
      if (vlanOf(s.cfg, "HOST-D") !== 10 || netOf(d.ip || "0.0.0.0", d.prefix) !== "192.168.10.0") return false;
      return s.runs.some((r) => r.cfgSeq === s.cfgSeq && r.results.some((x) => x.send.from === "HOST-D" && x.send.to === s.cfg.hosts["HOST-A"].ip && x.replied) && r.waves.flatMap((w) => w.rx).some((x) => x.dev === "HOST-D" && x.frame.kind === "echo-rep" && x.frame.ttl === 64));
    },
    next: (s) => {
      const d = s.cfg.hosts["HOST-D"];
      const v = vlanOf(s.cfg, "HOST-D");
      if (v !== 10) return `HOST-D's switch port is in VLAN ${v ?? "—"}. Put SW2 ge-0/0/2 in VLAN 10 first.`;
      if (netOf(d.ip || "0.0.0.0", d.prefix) !== "192.168.10.0") return `The port is in VLAN 10, but HOST-D still has ${d.ip || "no address"}/${d.prefix}. Give it a free 192.168.10.x address and the gateway 192.168.10.1 in its Shell.`;
      if (!pings(s, "HOST-D", s.cfg.hosts["HOST-A"].ip).length) return "Port and address are right. Now prove it: HOST-D pings HOST-A, after your last change.";
      return "HOST-D's ping didn't come back with TTL 64. Read the Journey: where did the request or the reply stop?";
    },
  },
  {
    id: "prune",
    title: "Cut one VLAN off from the router — then restore it",
    how: "Remove VLAN 20 from SW2's trunk to R1 (ge-0/0/23). Show that Engineering still reaches Engineering but not Sales; then put VLAN 20 back and prove HOST-C reaches HOST-A again.",
    done: (s) => {
      const runs = s.runs;
      const broken = runs.findIndex((r) => r.results.some((x) => (x.send.from === "HOST-C" || x.send.from === "HOST-D") && x.send.to.startsWith("192.168.10.") && !x.replied) && capsOf(s, r).every((c) => !(c.point === `SW2 ${RTR_PORT}` && c.vid === 20)));
      if (broken < 0) return false;
      const local = runs.some((r) => r.results.some((x) => ((x.send.from === "HOST-C" && x.send.to === s.cfg.hosts["HOST-D"].ip) || (x.send.from === "HOST-D" && x.send.to === s.cfg.hosts["HOST-C"].ip)) && x.replied));
      return local && s.cfg.sw.SW2.ports[RTR_PORT].allowed.includes(20) && runs.slice(broken + 1).some((r) => r.cfgSeq === s.cfgSeq && r.results.some((x) => x.send.from === "HOST-C" && x.send.to === s.cfg.hosts["HOST-A"].ip && x.replied));
    },
    next: (s) => {
      const failed = s.runs.some((r) => r.results.some((x) => (x.send.from === "HOST-C" || x.send.from === "HOST-D") && x.send.to.startsWith("192.168.10.") && !x.replied) && capsOf(s, r).every((c) => !(c.point === `SW2 ${RTR_PORT}` && c.vid === 20)));
      if (!failed) return "First remove VLAN 20 from SW2 ge-0/0/23, then show HOST-C (or HOST-D) failing to reach a Sales host.";
      const local = s.runs.some((r) => r.results.some((x) => ((x.send.from === "HOST-C" && x.send.to === s.cfg.hosts["HOST-D"].ip) || (x.send.from === "HOST-D" && x.send.to === s.cfg.hosts["HOST-C"].ip)) && x.replied));
      if (!local) return "Show the other half: Engineering still reaches Engineering (HOST-C pings HOST-D).";
      if (!s.cfg.sw.SW2.ports[RTR_PORT].allowed.includes(20)) return "Now put VLAN 20 back on SW2 ge-0/0/23.";
      return "VLAN 20 is back. Prove it: HOST-C pings HOST-A, after your last change.";
    },
  },
  {
    id: "native",
    title: "Make VLAN 10 the native VLAN of the SW1↔SW2 trunk",
    how: "Change the native VLAN to 10 at BOTH ends (one end alone breaks Sales — try it). Prove it: HOST-A pings HOST-B, and the capture on the trunk shows Sales frames crossing untagged.",
    done: (s) => {
      const a = s.cfg.sw.SW1.ports[TRUNK];
      const b = s.cfg.sw.SW2.ports[TRUNK];
      return a.native === 10 && b.native === 10 && s.runs.some((r) => r.cfgSeq === s.cfgSeq && r.results.some((x) => x.send.from === "HOST-A" && x.send.to === s.cfg.hosts["HOST-B"].ip && x.replied) && capsOf(s, r).some((c) => c.point === `SW1 ${TRUNK}` && c.vid === undefined && c.frame.from === "HOST-A"));
    },
    next: (s) => {
      const a = s.cfg.sw.SW1.ports[TRUNK].native;
      const b = s.cfg.sw.SW2.ports[TRUNK].native;
      if (a !== 10 || b !== 10) return `SW1 ge-0/0/24 uses native VLAN ${a}, SW2 ge-0/0/24 uses ${b}. Both ends must be 10.`;
      if (!pings(s, "HOST-A", s.cfg.hosts["HOST-B"].ip).length) return "Both ends use native VLAN 10. Now HOST-A pings HOST-B, after your last change.";
      return "The ping didn't come back, or HOST-A's frames weren't captured untagged on SW1 ge-0/0/24. Check the trunk's capture.";
    },
  },
  {
    id: "hairpin",
    title: "Prove the hairpin",
    how: "Ping between VLANs and show, from captures on SW2's port to R1, the same ping going down to R1 tagged VID 10 and coming back up tagged VID 20 (or the other way round), with the TTL lowered.",
    done: (s) => s.runs.some((r) => r.results.some((x) => x.replied && x.path.includes("R1")) && (() => { const cs = capsOf(s, r).filter((c) => c.point === `SW2 ${RTR_PORT}` && c.frame.kind === "echo"); return cs.some((c) => c.dir === "out" && c.vid !== undefined) && cs.some((c) => c.dir === "in" && c.vid !== undefined && c.frame.ttl < 64); })()),
    next: (s) =>
      s.runs.some((r) => r.results.some((x) => x.path.includes("R1")))
        ? "A ping went through R1 but didn't complete. Fix that first: both VLANs need to reach their subinterface."
        : "Ping from one VLAN to the other (HOST-A → HOST-C), then compare the captures on SW2 ge-0/0/23: VID and TTL, down and back up.",
  },
];
