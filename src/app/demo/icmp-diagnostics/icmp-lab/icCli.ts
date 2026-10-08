import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns, interfaceArg } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import { IC_ADDR } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import {
  IC_FILES,
  IC_KIND,
  icCiscoIf,
  icInPrefix,
  icJunosIf,
  icNetOf,
  icRouteTable,
  icValidIp,
  type IcAclEntry,
  type IcAction,
  type IcDev,
  type IcHost,
  type IcIcmpMatch,
  type IcIf,
  type IcIptRule,
  type IcIptType,
  type IcNetCfg,
  type IcProbe,
  type IcRouter,
  type IcRouterCfg,
  type IcRun,
  type IcState,
} from "@/lib/sim-engine/scenarios/icmpNet";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";

/**
 * Terminals of the ICMP lab. Outputs are printed from the network as it is (`view`) and from the tool runs the model
 * produced; every change goes through the model (`act`). Nothing is canned.
 *
 *   HOST-A, HOST-B   Linux: ping (-c -s -M do|want|dont -t, any order), traceroute (UDP, or -I ICMP; -m), curl
 *                    (HOST-A), ip addr, ip route, ip route get (shows the learnt path MTU), sudo ip route flush cache,
 *                    HOST-B: sudo iptables -L/-D/-I/-A/-F (ICMP rules), ss -ltn.
 *   R1, R2           Cisco IOS: show ip interface brief · show ip interface <if> (IP MTU, inbound ACL) · show interfaces
 *                    <if> (counters, giants) · show ip route · show ip traffic (ICMP stats) · show access-lists ·
 *                    show running-config · ping (repeat/size/df-bit) · traceroute · interface: ip mtu, shutdown,
 *                    ip access-group · ip route · ip access-list extended WAN-IN (applied on Enter).
 *                    Junos: show interfaces terse/<if> · show route · show system statistics icmp · show firewall ·
 *                    show configuration · ping (count/size/do-not-fragment/ttl) · traceroute · configure → set/delete
 *                    family inet mtu, disable, static routes, filter terms, filter input → commit (candidate).
 */

export type IcCiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; i: IcIf } | { kind: "acl" };
export interface IcCommit {
  cfg: IcRouterCfg;
  at: number;
  by: string;
}
export interface IcCliApi {
  view: IcState;
  act: (a: IcAction) => IcState;
  history?: string[];
  cisco: IcCiscoMode;
  setCisco: (m: IcCiscoMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: IcRouterCfg;
  setCand: (c: IcRouterCfg) => void;
  hist: IcCommit[];
  commit: (c: IcRouterCfg) => void;
  ask?: (q: CliQuestion | undefined) => void;
}

const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const known = (s: IcState) => [IC_ADDR["HOST-B"], IC_ADDR["R2:LAN"], IC_ADDR["R2:TRANSIT"], IC_ADDR["R1:TRANSIT"], IC_ADDR["R1:LAN"], IC_ADDR["HOST-A"], "198.51.100.99", "10.20.30.40"].filter((x, i, a) => a.indexOf(x) === i && !!s);
const ipArg = (s: IcState): CliArgSpec => ({ choices: known(s), describe: (c) => ({ [IC_ADDR["HOST-B"]]: "HOST-B", [IC_ADDR["R2:LAN"]]: "R2 LAN side", [IC_ADDR["R2:TRANSIT"]]: "R2 transit side", [IC_ADDR["R1:TRANSIT"]]: "R1 transit side", [IC_ADDR["R1:LAN"]]: "R1 LAN side", [IC_ADDR["HOST-A"]]: "HOST-A", "198.51.100.99": "an unused address on HOST-B's LAN", "10.20.30.40": "a network nobody routes" })[c], resolve: (raw) => (icValidIp(raw) ? raw : undefined) });
const num = (lo: number, hi: number, choices: string[], what: string): CliArgSpec => ({ choices, describe: () => `${what} (${lo}–${hi})`, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= lo && +raw <= hi ? String(+raw) : undefined) });
/** Every ordering of the options picked (each option is a list of tokens): real tools don't care about option order. */
function orderings(opts: string[][]): string[][][] {
  const out: string[][][] = [[]];
  const rec = (picked: string[][], rest: string[][]) => {
    for (let i = 0; i < rest.length; i++) {
      const next = [...picked, rest[i]];
      out.push(next);
      rec(next, rest.filter((_, j) => j !== i));
    }
  };
  rec([], opts);
  return out;
}
const isCanon = (picked: string[][], opts: string[][]) => picked.every((p, i) => i === 0 || opts.indexOf(p) > opts.indexOf(picked[i - 1]));
const ms = (hops: number, q: number) => (0.31 + hops * 0.21 + q * 0.017).toFixed(3);

/**
 * The shared parser lowercases what is typed, so its keywords are lowercase. Linux options and names here are
 * case-sensitive (-I is not -i, WAN-IN, INPUT, DROP): each such keyword becomes an argument that accepts exactly it.
 */
function exactCase(set: CliCommandSet): CliCommandSet {
  return {
    ...set,
    commands: set.commands.map((c) => {
      const parts = c.syntax.split(" ");
      if (!parts.some((p) => !(p.startsWith("<") && p.endsWith(">")) && p !== p.toLowerCase())) return c;
      const args: Record<string, CliArgSpec> = { ...(c.args ?? {}) };
      const syntax = parts
        .map((p, i) => {
          if ((p.startsWith("<") && p.endsWith(">")) || p === p.toLowerCase()) return p;
          const name = args[p] ? `${p}#${i}` : p;
          args[name] = { choices: [p], describe: () => (p.startsWith("-") ? "option (case-sensitive)" : "name (case-sensitive)"), resolve: (raw) => (raw === p ? p : undefined) };
          return `<${name}>`;
        })
        .join(" ");
      return { ...c, syntax, args };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Output formats (shared with the lab's probe panel)
// ---------------------------------------------------------------------------------------------------------------
const hopsOf = (p: IcProbe) => Math.max(1, p.frames.filter((f) => f.kind === "move").length / 2);
export function linuxPingText(r: IcRun): string {
  const data = r.args.data ?? 56;
  const lines = [`PING ${r.dst} (${r.dst}) ${data}(${data + 28}) bytes of data.`];
  r.probes.forEach((p, i) => {
    const seq = i + 1;
    if (p.localError) return lines.push(p.localError);
    const a = p.answer;
    if (!a) return;
    if (a.kind === "echo-rep") lines.push(`${data + 8} bytes from ${a.src}: icmp_seq=${seq} ttl=${a.ttl} time=${ms(hopsOf(p), i)} ms`);
    else if (a.kind === "ttl") lines.push(`From ${a.src} icmp_seq=${seq} Time to live exceeded`);
    else if (a.kind === "frag") lines.push(`From ${a.src} icmp_seq=${seq} Frag needed and DF set (mtu = ${a.mtu})`);
    else if (a.kind === "host") lines.push(`From ${a.src} icmp_seq=${seq} Destination Host Unreachable`);
    else if (a.kind === "net") lines.push(`From ${a.src} icmp_seq=${seq} Destination Net Unreachable`);
    else if (a.kind === "port") lines.push(`From ${a.src} icmp_seq=${seq} Destination Port Unreachable`);
  });
  const n = r.probes.length;
  const errs = r.probes.filter((p) => p.localError || (p.answer && p.answer.kind !== "echo-rep")).length;
  lines.push("", `--- ${r.dst} ping statistics ---`, `${n} packets transmitted, ${r.received} received${errs ? `, +${errs} errors` : ""}, ${Math.round(((n - r.received) / n) * 100)}% packet loss, time ${(n - 1) * 1001}ms`);
  return lines.join("\n");
}
export function linuxTraceText(r: IcRun): string {
  const lines = [`traceroute to ${r.dst} (${r.dst}), ${r.args.max ?? 30} hops max, 60 byte packets`];
  r.hops!.forEach((hop, h) => {
    let line = `${String(h + 1).padStart(2)} `;
    let lastFrom = "";
    hop.forEach((p, q) => {
      const a = p.answer;
      if (!a) return (line += " *");
      if (a.src !== lastFrom) line += ` ${a.src} (${a.src})`;
      lastFrom = a.src;
      line += `  ${ms(h + 1, q)} ms${a.kind === "host" ? " !H" : a.kind === "net" ? " !N" : a.kind === "frag" ? ` !F-${a.mtu}` : ""}`;
    });
    lines.push(line);
  });
  return lines.join("\n");
}
export function iosPingText(r: IcRun, size: number, df: boolean): string {
  const ch = r.probes.map((p) => (p.answer?.kind === "echo-rep" ? "!" : p.answer?.kind === "frag" ? "M" : p.answer?.kind === "ttl" ? "&" : p.answer && IC_KIND[p.answer.kind!].type === 3 ? "U" : ".")).join("");
  const ok = r.received;
  const n = r.probes.length;
  return ["Type escape sequence to abort.", `Sending ${n}, ${size}-byte ICMP Echos to ${r.dst}, timeout is 2 seconds:`, ...(df ? ["Packet sent with the DF bit set"] : []), ch, `Success rate is ${Math.round((ok / n) * 100)} percent (${ok}/${n})${ok ? ", round-trip min/avg/max = 1/1/2 ms" : ""}`].join("\n");
}
export function iosTraceText(r: IcRun): string {
  const lines = ["Type escape sequence to abort.", `Tracing the route to ${r.dst}`, "VRF info: (vrf in name/id, vrf out name/id)"];
  r.hops!.forEach((hop, h) => {
    let line = `${String(h + 1).padStart(3)}`;
    let lastFrom = "";
    hop.forEach((p) => {
      const a = p.answer;
      if (!a) return (line += "  *");
      if (a.src !== lastFrom) line += ` ${a.src}`;
      lastFrom = a.src;
      line += a.kind === "host" ? " !H" : a.kind === "net" ? " !N" : " 1 msec";
    });
    lines.push(line);
  });
  return lines.join("\n");
}
export function junosPingText(r: IcRun, data: number, counted: boolean): string {
  const lines = [`PING ${r.dst} (${r.dst}): ${data} data bytes`];
  r.probes.forEach((p, i) => {
    const a = p.answer;
    if (!a) return;
    if (a.kind === "echo-rep") lines.push(`${data + 8} bytes from ${a.src}: icmp_seq=${i} ttl=${a.ttl} time=${ms(hopsOf(p), i)} ms`);
    else lines.push(`36 bytes from ${a.src}: ${a.kind === "ttl" ? "Time to live exceeded" : a.kind === "frag" ? `frag needed and DF set (MTU ${a.mtu})` : a.kind === "host" ? "Destination Host Unreachable" : a.kind === "net" ? "Destination Net Unreachable" : "Destination Port Unreachable"}`);
  });
  const n = r.probes.length;
  if (!counted) lines.push("^C");
  lines.push(`--- ${r.dst} ping statistics ---`, `${n} packets transmitted, ${r.received} packets received, ${Math.round(((n - r.received) / n) * 100)}% packet loss`);
  return lines.join("\n");
}
export function junosTraceText(r: IcRun): string {
  const lines = [`traceroute to ${r.dst} (${r.dst}), 30 hops max, 40 byte packets`];
  r.hops!.forEach((hop, h) => {
    let line = `${String(h + 1).padStart(2)} `;
    let lastFrom = "";
    hop.forEach((p, q) => {
      const a = p.answer;
      if (!a) return (line += " *");
      if (a.src !== lastFrom) line += ` ${a.src} (${a.src})`;
      lastFrom = a.src;
      line += `  ${ms(h + 1, q)} ms${a.kind === "host" ? " !H" : a.kind === "net" ? " !N" : ""}`;
    });
    lines.push(line);
  });
  return lines.join("\n");
}
export function curlText(r: IcRun): string {
  const c = r.curl!;
  const file = r.args.file ?? "small";
  const size = file === "big" ? "50.0M" : " 900";
  const head = ["  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current", "                                 Dload  Upload   Total   Spent    Left  Speed"];
  if (c.ok) return [...head, `100 ${size}  100 ${size}    0     0   ${file === "big" ? "112M" : "878k"}      0 --:--:-- --:--:-- --:--:--  ${file === "big" ? "112M" : "878k"}`].join("\n");
  if (c.reason === "no-route") return [...head, "  0     0    0     0    0     0      0      0 --:--:--  0:00:03 --:--:--     0", `curl: (7) Failed to connect to ${r.dst} port 80 after 3001 ms: No route to host`].join("\n");
  const connected = r.probes[0]?.answer?.tcp === "SYN-ACK";
  return [...head, `  0 ${connected ? size : "    0"}    0     0    0     0      0      0 --:--:--  0:00:30 --:--:--     0`, connected ? `curl: (28) Operation timed out after 30001 milliseconds with 0 out of ${IC_FILES[file].bytes} bytes received` : `curl: (28) Failed to connect to ${r.dst} port 80 after 30001 ms: Connection timed out`].join("\n");
}
export const explainProbe = (r: IcRun) => {
  if (r.tool === "curl") return r.curl!.ok ? `Downloaded ${IC_FILES[r.args.file ?? "small"].bytes.toLocaleString("en-US")} bytes${r.curl!.retried ? ` — HOST-B's first full-size segment was refused (ICMP 3/4 reached it), so it resent at the path MTU` : ""}.` : r.curl!.reason === "no-route" ? "An ICMP Host Unreachable came back for the TCP connection: Linux gives up at once." : r.probes[0]?.answer?.tcp === "SYN-ACK" ? "Connected and asked for the file, but no data segment ever arrived — and no error either." : "The connection attempt got no answer at all.";
  return undefined;
};

// ---------------------------------------------------------------------------------------------------------------
// Hosts (Linux)
// ---------------------------------------------------------------------------------------------------------------
const pmtuArg: CliArgSpec = { choices: ["do", "want", "dont"], describe: (c) => ({ do: "set DF, never fragment (not even locally)", want: "set DF, fragment locally above the known path MTU (default)", dont: "don't set DF" })[c], resolve: (raw) => (["do", "want", "dont"].includes(raw) ? raw : undefined) };
const IPT_TYPES: IcIptType[] = ["echo-request", "destination-unreachable", "fragmentation-needed", "time-exceeded"];
const iptArg: CliArgSpec = { choices: IPT_TYPES, describe: (c) => ({ "echo-request": "ping requests (type 8)", "destination-unreachable": "all type 3", "fragmentation-needed": "type 3 code 4 (PMTUD)", "time-exceeded": "type 11" })[c], resolve: (raw) => (IPT_TYPES.includes(raw as IcIptType) ? raw : undefined) };

function hostSet(api: IcCliApi, h: IcHost): CliCommandSet {
  const s = api.view;
  const c = s.cfg[h];
  const name = h.toLowerCase();
  const setHost = (patch: Partial<IcNetCfg[IcHost]>, text: string) => {
    const cfg = clone(s.cfg);
    Object.assign(cfg[h], patch);
    api.act({ type: "cfg", cfg, text });
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "Interfaces, addresses and MTU", run: () => ({ output: [`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000`, `    inet 127.0.0.1/8 scope host lo`, `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu ${c.mtu} qdisc fq_codel state UP group default qlen 1000`, `    inet ${c.ip}/${c.prefix} brd ${icNetOf(c.ip, c.prefix).replace(/\.0$/, ".255")} scope global eth0`].join("\n"), explanation: "mtu is the largest IP packet this interface sends in one piece. Every link on the path has its own — the smallest one is the path MTU." }) },
    { id: "addr", syntax: "ip a", summary: "Short for ip addr", hidden: true, run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu ${c.mtu}\n    inet ${c.ip}/${c.prefix} scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "Routing table", run: () => ({ output: [`default via ${c.gw} dev eth0 proto static`, `${icNetOf(c.ip, c.prefix)}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n") }) },
    {
      id: "get",
      syntax: "ip route get <ip>",
      summary: "How a packet to <ip> leaves — and the path MTU learnt for it",
      args: { ip: ipArg(s) },
      run: ({ ip }) => {
        const local = icInPrefix(ip, c.ip, c.prefix);
        const m = c.pmtu[ip];
        return { output: `${ip} ${local ? "" : `via ${c.gw} `}dev eth0 src ${c.ip} uid 1000\n    cache ${m ? `expires 597sec mtu ${m}` : ""}`.trimEnd(), explanation: m ? `The kernel remembers an ICMP 3/4 for ${ip}: packets to it must be ≤ ${m} bytes. That cache is what Path MTU Discovery builds.` : "No path MTU learnt for this destination: the interface MTU applies until an ICMP 3/4 says otherwise." };
      },
    },
    { id: "flush", syntax: "sudo ip route flush cache", summary: "Forget learnt path MTUs", run: () => (api.act({ type: "flush-pmtu", dev: h }), { output: "" }) },
    { id: "hist", syntax: "history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "history"].map((x, i) => `  ${i + 1}  ${x}`).join("\n") }) },
  ];
  // ping, any option order
  const pOpts =[["-c", "<count>"], ["-s", "<size>"], ["-M", "<pmtu>"], ["-t", "<ttl>"]];
  for (const picked of orderings(pOpts)) {
    cmds.push({
      id: "ping",
      syntax: ["ping", ...picked.flat(), "<ip>"].join(" "),
      summary: picked.length ? "Echo Requests with options (-c count, -s data bytes, -M do|want|dont, -t TTL)" : "Send 4 Echo Requests",
      hidden: !(picked.length === 0 || (isCanon(picked, pOpts) && [["-c"], ["-c", "-s", "-M"], ["-c", "-t"], ["-c", "-s", "-M", "-t"]].some((v) => v.join() === picked.map((x) => x[0]).join()))),
      args: { ip: ipArg(s), count: num(1, 10, ["1", "4"], "how many"), size: num(0, 1572, ["56", "1372", "1373", "1472"], "ICMP data bytes; IP packet = size + 28"), pmtu: pmtuArg, ttl: num(1, 255, ["1", "2", "3", "64"], "starting TTL") },
      run: ({ ip, count, size, pmtu, ttl }) => {
        const r = api.act({ type: "ping", dev: h, dst: ip, count: count ? +count : 4, data: size ? +size : 56, mode: (pmtu as "do" | "want" | "dont") ?? "want", ttl: ttl ? +ttl : 64 }).last!;
        return { output: linuxPingText(r) };
      },
    });
  }
  const tOpts = [["-I"], ["-m", "<max>"]];
  for (const picked of orderings(tOpts)) {
    cmds.push({
      id: "trace",
      syntax: ["traceroute", ...picked.flat(), "<ip>"].join(" "),
      summary: picked.some((p) => p[0] === "-I") ? "Traceroute with ICMP Echo probes" : picked.length ? "Traceroute (-m max hops)" : "Traceroute with UDP probes (Linux default)",
      hidden: !(picked.length === 0 || (picked.length === 1 && picked[0][0] === "-I")),
      args: { ip: ipArg(s), max: num(1, 30, ["5", "30"], "max hops") },
      run: ({ ip, max }) => ({ output: linuxTraceText(api.act({ type: "trace", dev: h, dst: ip, icmp: picked.some((p) => p[0] === "-I"), max: max ? +max : 30 }).last!) }),
    });
  }
  if (h === "HOST-A") {
    const url: CliArgSpec = { choices: [`http://${IC_ADDR["HOST-B"]}${IC_FILES.small.path}`, `http://${IC_ADDR["HOST-B"]}${IC_FILES.big.path}`], describe: (c) => (c.endsWith(".iso") ? "a 50 MB file" : "a 900-byte page"), resolve: (raw) => (raw === `http://${IC_ADDR["HOST-B"]}${IC_FILES.small.path}` || raw === `http://${IC_ADDR["HOST-B"]}/` ? "small" : raw === `http://${IC_ADDR["HOST-B"]}${IC_FILES.big.path}` ? "big" : undefined) };
    const curl = (file: string) => {
      const r = api.act({ type: "curl", file: file as "small" | "big" }).last!;
      return { output: curlText(r), explanation: explainProbe(r) };
    };
    cmds.push({ id: "curl", syntax: "curl -o /dev/null <url>", summary: "Download over HTTP (TCP) and discard it", args: { url }, run: ({ url: f }) => curl(f) });
    cmds.push({ id: "curl", syntax: "curl -O <url>", summary: "Download to a file", hidden: true, args: { url }, run: ({ url: f }) => curl(f) });
  }
  if (h === "HOST-B") {
    const list = () => ["Chain INPUT (policy ACCEPT)", "num  target     prot opt source               destination", ...c.input.map((r, i) => `${String(i + 1).padEnd(4)} ${r.target.padEnd(10)} icmp --  0.0.0.0/0            0.0.0.0/0            ${r.type === "all" ? "" : `icmptype ${({ "echo-request": 8, "destination-unreachable": 3, "fragmentation-needed": "3 code 4", "time-exceeded": 11 } as Record<string, string | number>)[r.type]}`}`)].join("\n");
    const add = (rule: IcIptRule, first: boolean) => setHost({ input: first ? [rule, ...c.input] : [...c.input, rule] }, `HOST-B: iptables ${first ? "-I" : "-A"} INPUT -p icmp --icmp-type ${rule.type} -j ${rule.target}`);
    cmds.push(
      { id: "ipt-l", syntax: "sudo iptables -L INPUT -n --line-numbers", summary: "List the INPUT firewall rules", run: () => ({ output: list(), explanation: "First match wins; anything not matched follows the policy (ACCEPT). A DROP sends nothing back — not even an ICMP error." }) },
      { id: "ipt-l", syntax: "sudo iptables -L", summary: "List the firewall rules", hidden: true, run: () => ({ output: list() }) },
      { id: "ipt-d", syntax: "sudo iptables -D INPUT <num>", summary: "Delete rule <num> from INPUT", args: { num: num(1, 9, c.input.map((_, i) => String(i + 1)), "rule number") }, run: ({ num: n }) => (c.input[+n - 1] ? (setHost({ input: c.input.filter((_, i) => i !== +n - 1) }, `HOST-B: iptables -D INPUT ${n} (removed ${c.input[+n - 1].type} ${c.input[+n - 1].target})`), { output: "" }) : refuse("iptables: Index of deletion too big.")) },
      ...(["-I", "-A"] as const).flatMap((op) =>
        (["DROP", "ACCEPT"] as const).map((target) => ({ id: "ipt-add", syntax: `sudo iptables ${op} INPUT -p icmp --icmp-type <type> -j ${target}`, summary: `${op === "-I" ? "Insert at the top" : "Append"}: ${target} an ICMP type`, args: { type: iptArg }, run: ({ type }: Record<string, string>) => (add({ type: type as IcIptType, target }, op === "-I"), { output: "" }) })),
      ),
      { id: "ipt-f", syntax: "sudo iptables -F INPUT", summary: "Remove every INPUT rule", run: () => (setHost({ input: [] }, "HOST-B: iptables -F INPUT"), { output: "" }) },
      { id: "ss", syntax: "ss -ltn", summary: "Listening TCP sockets", run: () => ({ output: "State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port\nLISTEN  0       511            0.0.0.0:80          0.0.0.0:*\nLISTEN  0       128            0.0.0.0:22          0.0.0.0:*", explanation: "The web server listens on TCP 80. Nothing listens on the UDP ports traceroute uses, so HOST-B answers those probes with ICMP 3/3." }) },
    );
  }
  return exactCase({ vendor: "cisco", deviceId: h, deviceName: h, prompt: `admin@${name}:~$ `, commands: cmds });
}
export const icHostSet = (api: IcCliApi, h: IcHost) => withSelfPing(hostSet(api, h), "linux", [api.view.cfg[h].ip]);

// ---------------------------------------------------------------------------------------------------------------
// Routers
// ---------------------------------------------------------------------------------------------------------------
const MASK: Record<number, string> = { 0: "0.0.0.0", 24: "255.255.255.0", 30: "255.255.255.252", 32: "255.255.255.255", 16: "255.255.0.0", 8: "255.0.0.0", 25: "255.255.255.128", 26: "255.255.255.192", 27: "255.255.255.224", 28: "255.255.255.240", 29: "255.255.255.248" };
const lenOfMask = (m: string) => Number(Object.keys(MASK).find((k) => MASK[+k] === m));
const ICMP_IOS: IcIcmpMatch[] = ["echo", "echo-reply", "unreachable", "time-exceeded", "packet-too-big"];
const ICMP_JUNOS: Record<string, IcIcmpMatch> = { "echo-request": "echo", "echo-reply": "echo-reply", unreachable: "unreachable", "time-exceeded": "time-exceeded" };
const junosIcmpName = (m?: IcIcmpMatch) => (m === "echo" ? "echo-request" : m === "packet-too-big" ? "unreachable" : m);
const routerDevs = (s: IcState, r: IcRouter) => s.cfg[r];

function routerShows(api: IcCliApi, r: IcRouter) {
  const s = api.view;
  const cfg = routerDevs(s, r);
  const pt = (i: IcIf) => `${r}:${i}` as const;
  return { cfg, pt, s };
}

/** An empty hierarchy prints nothing on Junos; say why, so silence isn't mistaken for a broken command. */
const emptyLevel = (output: string, level: string, which: "active" | "candidate") => (output ? { output } : { output, explanation: `Nothing is configured under ${level} in the ${which} configuration.` });

export function junosText(c: IcRouterCfg, path: string[] = []): string {
  const ifs = (["ge0", "ge1"] as IcIf[]).map((i) => [`    ${icJunosIf(i)} {`, ...(c.ifs[i].up ? [] : ["        disable;"]), "        unit 0 {", "            family inet {", ...(c.acl?.appliedIn === i ? ["                filter {", "                    input WAN-IN;", "                }"] : []), ...(c.ifs[i].mtu !== 1500 ? [`                mtu ${c.ifs[i].mtu};`] : []), `                address ${c.ifs[i].ip}/${c.ifs[i].prefix};`, "            }", "        }", "    }"].join("\n"));
  const ro = !c.statics.length ? "" : ["routing-options {", "    static {", ...c.statics.map((x) => `        route ${x.prefix}/${x.len} next-hop ${x.via};`), "    }", "}"].join("\n");
  const fw = c.acl ? ["firewall {", "    family inet {", "        filter WAN-IN {", ...c.acl.entries.map((e) => [`            term ${e.term} {`, ...(e.proto === "icmp" ? ["                from {", "                    protocol icmp;", ...(e.icmp && e.icmp !== "any" ? [`                    icmp-type ${junosIcmpName(e.icmp)};`] : []), "                }"] : []), `                then ${e.action === "permit" ? "accept" : "discard"};`, "            }"].join("\n")), "        }", "    }", "}"].join("\n") : "";
  const all = [["interfaces {", ...ifs, "}"].join("\n"), ro, fw].filter(Boolean).join("\n");
  if (!path.length) return all;
  if (path[0] === "interfaces" && path[1]) {
    // One interface: its statements only (no wrapper), as Junos prints the hierarchy level.
    const i = (["ge0", "ge1"] as IcIf[]).findIndex((x) => icJunosIf(x) === path[1]);
    return i < 0 ? "" : ifs[i].split("\n").slice(1, -1).map((l) => l.slice(8)).join("\n");
  }
  if (path[0] === "interfaces") return ifs.map((b) => b.replace(/^ {4}/gm, "")).join("\n");
  if (path[0] === "routing-options") return !ro ? "" : ro.split("\n").slice(1, -1).map((l) => l.replace(/^ {4}/, "")).join("\n");
  if (path[0] === "firewall") return fw.split("\n").slice(1, -1).map((l) => l.replace(/^ {4}/, "")).join("\n");
  return "";
}

function iosRouter(api: IcCliApi, r: IcRouter): CliCommandSet {
  const { cfg, pt, s } = routerShows(api, r);
  const ifArg = interfaceArg("cisco", { ge0: icCiscoIf("ge0"), ge1: icCiscoIf("ge1") }, { ge0: r === "R1" ? "LAN-A (HOST-A)" : "LAN-B (HOST-B)", ge1: "transit link" });
  const mode = api.cisco;
  const change = (mut: (c: IcRouterCfg) => void, text: string) => {
    const net = clone(s.cfg);
    mut(net[r]);
    api.act({ type: "cfg", cfg: net, text: `${r}: ${text}` });
  };
  const brief = () => columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...(["ge0", "ge1"] as IcIf[]).map((i) => [icCiscoIf(i), cfg.ifs[i].ip, "YES", "manual", cfg.ifs[i].up ? "up" : "administratively down", cfg.ifs[i].up ? "up" : "down"])], [23, 16, 4, 7, 22, 8]);
  const ipIf = (i: IcIf) => [`${icCiscoIf(i)} is ${cfg.ifs[i].up ? "up" : "administratively down"}, line protocol is ${cfg.ifs[i].up ? "up" : "down"}`, `  Internet address is ${cfg.ifs[i].ip}/${cfg.ifs[i].prefix}`, `  MTU is ${cfg.ifs[i].mtu} bytes`, `  Outgoing access list is not set`, `  Inbound  access list is ${cfg.acl?.appliedIn === i ? "WAN-IN" : "not set"}`, "  ICMP unreachables are always sent"].join("\n");
  const intf = (i: IcIf) => {
    const k = s.counters[pt(i)];
    return [`${icCiscoIf(i)} is ${cfg.ifs[i].up ? "up" : "administratively down"}, line protocol is ${cfg.ifs[i].up ? "up" : "down"}`, `  Internet address is ${cfg.ifs[i].ip}/${cfg.ifs[i].prefix}`, `  MTU 1500 bytes, BW 1000000 Kbit/sec`, `     ${k.in} packets input, 0 no buffer`, `     0 runts, ${k.giants} giants, 0 throttles`, `     ${k.giants} input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored`, `     ${k.out} packets output, 0 underruns`].join("\n");
  };
  const routes = () => {
    const rt = icRouteTable(cfg);
    const lines = ["Codes: L - local, C - connected, S - static, * - candidate default", "", rt.some((x) => x.kind === "static" && x.len === 0 && x.active) ? `Gateway of last resort is ${rt.find((x) => x.len === 0)!.via} to network 0.0.0.0` : "Gateway of last resort is not set", ""];
    for (const x of rt.filter((y) => y.active)) lines.push(x.kind === "static" ? `S${x.len === 0 ? "*" : " "}       ${x.prefix}/${x.len} [1/0] via ${x.via}` : `${x.kind === "local" ? "L" : "C"}        ${x.prefix}/${x.len} is directly connected, ${icCiscoIf(x.iface!)}`);
    return lines.join("\n");
  };
  const traffic = () => {
    const st = s.stats[r];
    const g = (k: keyof typeof st.sent, side: "sent" | "rcvd") => st[side][k] ?? 0;
    return ["ICMP statistics:", `  Rcvd: 0 format errors, 0 checksum errors, 0 redirects, ${g("host", "rcvd") + g("net", "rcvd") + g("port", "rcvd") + g("frag", "rcvd")} unreachable`, `        ${g("echo-req", "rcvd")} echo, ${g("echo-rep", "rcvd")} echo reply, 0 mask requests, 0 mask replies, 0 quench`, `        0 parameter, 0 timestamp, 0 timestamp replies, 0 info request, 0 other`, `        0 irdp solicitations, 0 irdp advertisements`, `        ${g("ttl", "rcvd")} time exceeded`, `  Sent: 0 redirects, ${g("host", "sent") + g("net", "sent") + g("port", "sent") + g("frag", "sent")} unreachable, 0 echo, ${g("echo-rep", "sent")} echo reply`, `        0 mask requests, 0 mask replies, 0 quench, 0 timestamp replies`, `        0 info reply, ${g("ttl", "sent")} time exceeded, 0 parameter problem`].join("\n");
  };
  const acls = () => (cfg.acl ? ["Extended IP access list WAN-IN", ...cfg.acl.entries.map((e) => `    ${e.seq} ${e.action} ${e.proto} any any${e.icmp && e.icmp !== "any" ? ` ${e.icmp}` : ""}${e.hits ? ` (${e.hits} match${e.hits > 1 ? "es" : ""})` : ""}`)].join("\n") : "");
  const running = (only?: IcIf) => {
    const blk = (i: IcIf) => [`interface ${icCiscoIf(i)}`, ` ip address ${cfg.ifs[i].ip} ${MASK[cfg.ifs[i].prefix]}`, ...(cfg.ifs[i].mtu !== 1500 ? [` ip mtu ${cfg.ifs[i].mtu}`] : []), ...(cfg.acl?.appliedIn === i ? [" ip access-group WAN-IN in"] : []), ...(cfg.ifs[i].up ? [] : [" shutdown"]), "!"];
    if (only) return blk(only).join("\n");
    return [`hostname ${r}`, "!", ...blk("ge0"), ...blk("ge1"), ...cfg.statics.map((x) => `ip route ${x.prefix} ${MASK[x.len]} ${x.via}`), "!", ...(cfg.acl ? ["ip access-list extended WAN-IN", ...cfg.acl.entries.map((e) => ` ${e.seq} ${e.action} ${e.proto} any any${e.icmp && e.icmp !== "any" ? ` ${e.icmp}` : ""}`), "!"] : []), "end"].join("\n");
  };
  const show: CliCommand[] = [
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces and status", run: () => ({ output: brief() }) },
    { id: "ipif", syntax: "show ip interface <interface>", summary: "IP MTU, inbound filter", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: ipIf(i as IcIf), explanation: "MTU is the largest IP packet this interface sends whole. A packet bigger than that is fragmented — or, with DF, dropped with ICMP 3/4 sent back." }) },
    { id: "intf", syntax: "show interfaces <interface>", summary: "Counters, giants", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: intf(i as IcIf), explanation: "Giants are frames bigger than this interface accepts — dropped on arrival, with no ICMP sent. An MTU mismatch between the two ends of a link shows up here." }) },
    { id: "route", syntax: "show ip route", summary: "Routing table", run: () => ({ output: routes(), explanation: "Everything this router can forward to. A missing route here means its replies and its ICMP messages toward that network have nowhere to go." }) },
    { id: "traffic", syntax: "show ip traffic", summary: "ICMP statistics (sent/received)", run: () => ({ output: traffic(), explanation: "Sent counters prove this router generated ICMP (Time Exceeded, unreachables) even when the sender never received it." }) },
    { id: "acl", syntax: "show access-lists", summary: "Filters and their match counters", run: () => ({ output: acls(), explanation: cfg.acl ? "Matches count every packet each line caught. A deny line that keeps counting is silently discarding traffic." : "No filters configured." }) },
    { id: "run", syntax: "show running-config", summary: "Current configuration", run: () => ({ output: running() }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One interface", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: running(i as IcIf) }) },
  ];
  const ping = (ip: string, repeat?: string, size?: string, df?: boolean) => {
    const total = size ? +size : 100;
    const run = api.act({ type: "ping", dev: r, dst: ip, count: repeat ? +repeat : 5, data: Math.max(0, total - 28), mode: df ? "do" : "dont", ttl: 255 }).last!;
    return { output: iosPingText(run, total, !!df), explanation: "IOS ping sizes are the whole IP datagram (default 100). ! reply · . timeout · U unreachable · M could not fragment (3/4) · & TTL expired." };
  };
  const pingCmds: CliCommand[] = orderings([["repeat", "<repeat>"], ["size", "<size>"], ["df-bit"]]).map((picked) => ({
    id: "ping",
    syntax: ["ping", "<ip>", ...picked.flat()].join(" "),
    summary: picked.length ? "Ping with repeat count, datagram size, DF bit" : "Send 5 Echo Requests (100 bytes)",
    hidden: !(picked.length === 0 || (picked.length === 3 && isCanon(picked, [["repeat", "<repeat>"], ["size", "<size>"], ["df-bit"]]))),
    args: { ip: ipArg(s), repeat: num(1, 20, ["5"], "count"), size: num(36, 1600, ["100", "1400", "1401", "1500"], "datagram bytes") },
    run: ({ ip, repeat, size }) => ping(ip, repeat, size, picked.some((p) => p[0] === "df-bit")),
  }));
  const exec: CliCommand[] = [
    ...show,
    ...pingCmds,
    { id: "trace", syntax: "traceroute <ip>", summary: "Trace the path (UDP probes)", args: { ip: ipArg(s) }, run: ({ ip }) => ({ output: iosTraceText(api.act({ type: "trace", dev: r, dst: ip }).last!) }) },
    { id: "conf", syntax: "configure terminal", summary: "Configuration mode", run: () => (api.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
    { id: "hist", syntax: "show history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  const ipA = (): CliArgSpec => ({ choices: ["198.51.100.0", "192.0.2.0", "0.0.0.0"], resolve: (raw) => (icValidIp(raw) ? raw : undefined) });
  const maskA: CliArgSpec = { choices: ["255.255.255.0", "0.0.0.0"], resolve: (raw) => (Object.values(MASK).includes(raw) ? raw : undefined) };
  const nhA: CliArgSpec = { choices: [r === "R1" ? IC_ADDR["R2:TRANSIT"] : IC_ADDR["R1:TRANSIT"]], resolve: (raw) => (icValidIp(raw) ? raw : undefined) };
  const conf: CliCommand[] = [
    ...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })),
    { id: "if", syntax: "interface <interface>", summary: "Configure an interface", args: { interface: ifArg }, run: ({ interface: i }) => (api.setCisco({ kind: "if", i: i as IcIf }), { output: "" }) },
    { id: "route", syntax: "ip route <prefix> <mask> <nexthop>", summary: "Add a static route", args: { prefix: ipA(), mask: maskA, nexthop: nhA }, run: ({ prefix, mask, nexthop }) => (change((c) => { const len = lenOfMask(mask); if (!c.statics.some((x) => x.prefix === prefix && x.len === len && x.via === nexthop)) c.statics.push({ prefix, len, via: nexthop }); }, `ip route ${prefix} ${mask} ${nexthop}`), { output: "", explanation: "Added to the configuration. Check show ip route, then send a probe." }) },
    { id: "noroute", syntax: "no ip route <prefix> <mask> <nexthop>", summary: "Remove a static route", args: { prefix: ipA(), mask: maskA, nexthop: nhA }, run: ({ prefix, mask, nexthop }) => (cfg.statics.some((x) => x.prefix === prefix && x.len === lenOfMask(mask) && x.via === nexthop) ? (change((c) => { c.statics = c.statics.filter((x) => !(x.prefix === prefix && x.len === lenOfMask(mask) && x.via === nexthop)); }, `no ip route ${prefix} ${mask} ${nexthop}`), { output: "" }) : refuse("%No matching route to delete")) },
    { id: "acl", syntax: "ip access-list extended WAN-IN", summary: "Edit the WAN-IN filter", run: () => (api.setCisco({ kind: "acl" }), { output: "", explanation: "Editing the WAN-IN entries: permit / deny lines are checked top to bottom, and anything not permitted is denied." }) },
    { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
    { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
  ];
  const ifCmds = (i: IcIf): CliCommand[] => [
    { id: "ipmtu", syntax: "ip mtu <bytes>", summary: "Largest IP packet this interface sends whole", args: { bytes: num(576, 1500, ["1400", "1500"], "bytes") }, run: ({ bytes }) => (change((c) => { c.ifs[i].mtu = +bytes; }, `interface ${icCiscoIf(i)} ip mtu ${bytes}`), { output: "", explanation: `${icCiscoIf(i)} now sends IP packets up to ${bytes} B whole. The other end of the link must agree — packets bigger than its MTU arrive as giants and are dropped.` }) },
    { id: "noipmtu", syntax: "no ip mtu", summary: "Back to the default IP MTU (1500)", run: () => (change((c) => { c.ifs[i].mtu = 1500; }, `interface ${icCiscoIf(i)} no ip mtu`), { output: "" }) },
    { id: "shut", syntax: "shutdown", summary: "Disable the interface", run: () => (change((c) => { c.ifs[i].up = false; }, `interface ${icCiscoIf(i)} shutdown`), { output: `%LINK-5-CHANGED: Interface ${icCiscoIf(i)}, changed state to administratively down` }) },
    { id: "noshut", syntax: "no shutdown", summary: "Enable the interface", run: () => (change((c) => { c.ifs[i].up = true; }, `interface ${icCiscoIf(i)} no shutdown`), { output: `%LINK-3-UPDOWN: Interface ${icCiscoIf(i)}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${icCiscoIf(i)}, changed state to up` }) },
    { id: "grp", syntax: "ip access-group WAN-IN in", summary: "Apply WAN-IN to traffic arriving here", run: () => (change((c) => { c.acl = { entries: c.acl?.entries ?? [], appliedIn: i }; }, `interface ${icCiscoIf(i)} ip access-group WAN-IN in`), { output: "", explanation: `WAN-IN now filters every packet arriving on ${icCiscoIf(i)}, ICMP included.` }) },
    { id: "nogrp", syntax: "no ip access-group WAN-IN in", summary: "Remove the inbound filter", run: () => (change((c) => { if (c.acl) c.acl.appliedIn = undefined; }, `interface ${icCiscoIf(i)} no ip access-group WAN-IN in`), { output: "" }) },
    { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setCisco({ kind: "config" }), { output: "" }) },
    { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
  ];
  const seqA: CliArgSpec = { choices: (cfg.acl?.entries ?? []).map((e) => String(e.seq)), describe: () => "sequence number", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 1000 ? String(+raw) : undefined) };
  const icmpA: CliArgSpec = { choices: ICMP_IOS, resolve: (raw) => (ICMP_IOS.includes(raw as IcIcmpMatch) ? raw : undefined) };
  const putEntry = (e: Omit<IcAclEntry, "hits" | "term">) =>
    change((c) => {
      const entries = (c.acl?.entries ?? []).filter((x) => x.seq !== e.seq);
      entries.push({ ...e, term: e.proto === "ip" ? `allow-all-${e.seq}` : `${e.action === "deny" ? "block" : "allow"}-${e.icmp ?? "icmp"}`, hits: 0 });
      entries.sort((a, b) => a.seq - b.seq);
      c.acl = { entries, appliedIn: c.acl?.appliedIn };
    }, `WAN-IN ${e.seq} ${e.action} ${e.proto} any any${e.icmp ? ` ${e.icmp}` : ""}`);
  const aclCmds: CliCommand[] = [
    ...(["permit", "deny"] as const).flatMap((action): CliCommand[] => [
      { id: "ace", syntax: `<seq> ${action} ip any any`, summary: `${action} all IP traffic`, args: { seq: seqA }, run: ({ seq }: Record<string, string>) => (putEntry({ seq: +seq, action, proto: "ip" }), { output: "" }) },
      { id: "ace", syntax: `<seq> ${action} icmp any any <type>`, summary: `${action} one ICMP type`, args: { seq: seqA, type: icmpA }, run: ({ seq, type }: Record<string, string>) => (putEntry({ seq: +seq, action, proto: "icmp", icmp: type as IcIcmpMatch }), { output: "" }) },
    ]),
    { id: "noace", syntax: "no <seq>", summary: "Delete an entry", args: { seq: seqA }, run: ({ seq }) => (cfg.acl?.entries.some((e) => e.seq === +seq) ? (change((c) => { c.acl!.entries = c.acl!.entries.filter((e) => e.seq !== +seq); }, `WAN-IN no ${seq}`), { output: "" }) : refuse(`% Entry ${seq} not found`)) },
    { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setCisco({ kind: "config" }), { output: "" }) },
    { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
  ];
  const cmds = mode.kind === "exec" ? exec : mode.kind === "config" ? conf : mode.kind === "if" ? [...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })), ...ifCmds(mode.i)] : [...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })), ...aclCmds];
  const prompt = mode.kind === "exec" ? `${r}#` : mode.kind === "config" ? `${r}(config)#` : mode.kind === "if" ? `${r}(config-if)#` : `${r}(config-ext-nacl)#`;
  return exactCase({ vendor: "cisco", deviceId: r, deviceName: r, prompt, commands: cmds });
}

/** Junos commit check: a static whose next hop isn't connected is legal (inactive); a filter applied must exist. */
function junosCheck(c: IcRouterCfg): string | undefined {
  if (c.acl?.appliedIn && !c.acl.entries.length) return "error: filter WAN-IN referenced but not defined";
  return undefined;
}

function junosRouter(api: IcCliApi, r: IcRouter): CliCommandSet {
  const { cfg, pt, s } = routerShows(api, r);
  const ifArg = interfaceArg("juniper", { ge0: "ge-0/0/0", ge1: "ge-0/0/1" }, { ge0: r === "R1" ? "LAN-A (HOST-A)" : "LAN-B (HOST-B)", ge1: "transit link" });
  const cand = api.cand;
  const active = cfg;
  const same = (a: IcRouterCfg, b: IcRouterCfg) => junosText(a) === junosText(b);
  const dirty = !same(cand, active);
  const terse = () => columns([["Interface", "Admin", "Link", "Proto", "Local"], ...(["ge0", "ge1"] as IcIf[]).flatMap((i) => [[icJunosIf(i), cfg.ifs[i].up ? "up" : "down", cfg.ifs[i].up ? "up" : "down", "", ""], [`${icJunosIf(i)}.0`, cfg.ifs[i].up ? "up" : "down", cfg.ifs[i].up ? "up" : "down", "inet", `${cfg.ifs[i].ip}/${cfg.ifs[i].prefix}`]])], [16, 6, 5, 6, 20]);
  const intf = (i: IcIf) => {
    const k = s.counters[pt(i)];
    return [`Physical interface: ${icJunosIf(i)}, ${cfg.ifs[i].up ? "Enabled" : "Administratively down"}, Physical link is ${cfg.ifs[i].up ? "Up" : "Down"}`, `  Link-level type: Ethernet, MTU: 1514`, `  Input errors: Errors: ${k.giants}, Drops: ${k.aclDrops}, Framing errors: 0, Runts: 0, Giants: ${k.giants}`, `  Logical interface ${icJunosIf(i)}.0`, `    Input packets : ${k.in}`, `    Output packets: ${k.out}`, `    Protocol inet, MTU: ${cfg.ifs[i].mtu}`, ...(cfg.acl?.appliedIn === i ? ["      Input Filters: WAN-IN"] : []), `      Addresses, Flags: Is-Preferred Is-Primary`, `        Destination: ${icNetOf(cfg.ifs[i].ip, cfg.ifs[i].prefix)}/${cfg.ifs[i].prefix}, Local: ${cfg.ifs[i].ip}`].join("\n");
  };
  const route = () => {
    const rt = icRouteTable(cfg).filter((x) => x.active);
    return [`inet.0: ${rt.length} destinations, ${rt.length} routes (${rt.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rt.flatMap((x) => [`${`${x.prefix}/${x.len}`.padEnd(19)}*[${x.kind === "connected" ? "Direct/0" : x.kind === "local" ? "Local/0" : "Static/5"}] 1w0d`, x.kind === "static" ? `                    >  to ${x.via} via ${icJunosIf(x.iface!)}.0` : `                    >  via ${icJunosIf(x.iface!)}.0`])].join("\n");
  };
  const stats = () => {
    const st = s.stats[r];
    const g = (k: keyof typeof st.sent, side: "sent" | "rcvd") => st[side][k] ?? 0;
    const unreachS = g("host", "sent") + g("net", "sent") + g("port", "sent") + g("frag", "sent");
    return ["icmp:", `        ${unreachS + g("ttl", "sent")} calls to icmp_error`, "        Output Histogram", `                ${g("echo-rep", "sent")} echo reply`, `                ${unreachS} destination unreachable`, `                ${g("ttl", "sent")} time exceeded`, "        Input Histogram", `                ${g("echo-rep", "rcvd")} echo reply`, `                ${g("echo-req", "rcvd")} echo`, `                ${g("ttl", "rcvd")} time exceeded`].join("\n");
  };
  const fw = () => (cfg.acl ? ["Filter: WAN-IN", "Counters:", columns([["Name", "Bytes", "Packets"], ...cfg.acl.entries.map((e) => [e.term, String(e.hits * 56), String(e.hits)])], [30, 12, 8])].join("\n") : "");
  const op: CliCommand[] = [
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces and status", run: () => ({ output: terse() }) },
    { id: "intf", syntax: "show interfaces <iface>", summary: "Counters, inet MTU, filters", args: { iface: ifArg }, run: ({ iface }) => ({ output: intf(iface as IcIf), explanation: "Protocol inet MTU is the largest IP packet sent whole. Giants are frames bigger than this side accepts: dropped silently on arrival." }) },
    { id: "route", syntax: "show route", summary: "Routing table", run: () => ({ output: route() }) },
    { id: "stats", syntax: "show system statistics icmp", summary: "ICMP sent/received", run: () => ({ output: stats(), explanation: "Output counters prove this router generated ICMP errors, whether or not they ever reached the sender." }) },
    { id: "fw", syntax: "show firewall", summary: "Filter term counters", run: () => ({ output: fw() || "No filters." }) },
    { id: "cfg", syntax: "show configuration", summary: "Active configuration", run: () => ({ output: junosText(active) }) },
    ...(["interfaces", "routing-options", "firewall"] as const).map((p) => ({ id: "cfg", syntax: `show configuration ${p}`, summary: `The ${p} hierarchy`, run: () => emptyLevel(junosText(active, [p]), p, "active") })),
    { id: "cfg", syntax: "show configuration interfaces <iface>", summary: "One interface's active configuration", args: { iface: ifArg }, run: ({ iface }) => ({ output: junosText(active, ["interfaces", icJunosIf(iface as IcIf)]) }) },
    { id: "commits", syntax: "show system commit", summary: "Commit history", run: () => ({ output: api.hist.map((c, i) => `${i}   ${new Date(c.at || Date.now() - 3600000).toISOString().replace("T", " ").slice(0, 19)} UTC by ${c.by} via cli`).join("\n") }) },
    ...orderings([["count", "<count>"], ["size", "<size>"], ["do-not-fragment"], ["ttl", "<ttl>"]]).map((picked) => ({
      id: "ping",
      syntax: ["ping", "<ip>", ...picked.flat()].join(" "),
      summary: picked.length ? "Ping with count, data size, DF, TTL" : "Ping (Ctrl+C to stop)",
      hidden: !(picked.length === 0 || (picked.length === 1 && picked[0][0] === "count") || (picked.length === 4 && isCanon(picked, [["count", "<count>"], ["size", "<size>"], ["do-not-fragment"], ["ttl", "<ttl>"]]))),
      args: { ip: ipArg(s), count: num(1, 20, ["5"], "count"), size: num(0, 1572, ["56", "1372", "1373", "1472"], "data bytes; IP packet = size + 28"), ttl: num(1, 255, ["1", "2"], "TTL") },
      run: ({ ip, count, size, ttl }: Record<string, string>) => {
        const data = size ? +size : 56;
        const run = api.act({ type: "ping", dev: r, dst: ip, count: count ? +count : 5, data, mode: picked.some((p) => p[0] === "do-not-fragment") ? "do" : "dont", ttl: ttl ? +ttl : 64 }).last!;
        return { output: junosPingText(run, data, !!count), explanation: "Junos size is the ICMP data (like Linux): the IP packet is size + 28." };
      },
    })),
    { id: "trace", syntax: "traceroute <ip>", summary: "Trace the path", args: { ip: ipArg(s) }, run: ({ ip }) => ({ output: junosTraceText(api.act({ type: "trace", dev: r, dst: ip }).last!) }) },
    { id: "hist", syntax: "show cli history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  const setC = (mut: (c: IcRouterCfg) => void, explanation?: string) => {
    const n = clone(cand);
    mut(n);
    api.setCand(n);
    return { output: "", explanation: explanation ?? "Candidate only: the router keeps the active configuration until you commit." };
  };
  const termA: CliArgSpec = { choices: (cand.acl?.entries ?? []).map((e) => e.term), describe: () => "term name", resolve: (raw) => (/^[a-z][a-z0-9-]{0,30}$/i.test(raw) ? raw : undefined) };
  const term = (c: IcRouterCfg, name: string) => {
    c.acl = c.acl ?? { entries: [] };
    let e = c.acl.entries.find((x) => x.term === name);
    if (!e) {
      e = { seq: (c.acl.entries.at(-1)?.seq ?? 0) + 10, term: name, action: "permit", proto: "ip", hits: 0 };
      c.acl.entries.push(e);
    }
    return e;
  };
  const prefA: CliArgSpec = { choices: ["192.0.2.0/24", "198.51.100.0/24", "0.0.0.0/0"], describe: () => "prefix/length", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) && icValidIp(raw.split("/")[0]) && +raw.split("/")[1] <= 32 ? raw : undefined) };
  const nhA: CliArgSpec = { choices: [r === "R1" ? IC_ADDR["R2:TRANSIT"] : IC_ADDR["R1:TRANSIT"]], resolve: (raw) => (icValidIp(raw) ? raw : undefined) };
  const doCommit = (quit: boolean): CliResult => {
    const err = dirty ? junosCheck(cand) : undefined;
    if (err) return refuse(`${err}\nerror: configuration check-out failed`);
    if (dirty) api.commit(cand);
    if (quit) api.setJunosEdit(false);
    const output = quit ? "commit complete\nExiting configuration mode" : "commit complete";
    return dirty ? { output, explanation: "Active now. Verify on the device (show …), then send a fresh probe — a commit is not a repair until traffic proves it." } : { output };
  };
  const edit: CliCommand[] = [
    ...op.map((c) => ({ ...c, id: `run:${c.id}`, syntax: `run ${c.syntax}` })),
    { id: "mtu", syntax: "set interfaces <iface> unit 0 family inet mtu <bytes>", summary: "IP MTU of an interface", args: { iface: ifArg, bytes: num(576, 1500, ["1400", "1500"], "bytes") }, run: ({ iface, bytes }) => setC((c) => { c.ifs[iface as IcIf].mtu = +bytes; }) },
    { id: "delmtu", syntax: "delete interfaces <iface> unit 0 family inet mtu", summary: "Back to the default inet MTU (1500)", args: { iface: ifArg }, run: ({ iface }) => setC((c) => { c.ifs[iface as IcIf].mtu = 1500; }) },
    { id: "dis", syntax: "set interfaces <iface> disable", summary: "Disable an interface", args: { iface: ifArg }, run: ({ iface }) => setC((c) => { c.ifs[iface as IcIf].up = false; }) },
    { id: "deldis", syntax: "delete interfaces <iface> disable", summary: "Enable an interface", args: { iface: ifArg }, run: ({ iface }) => (cand.ifs[iface as IcIf].up ? refuse("warning: statement not found") : setC((c) => { c.ifs[iface as IcIf].up = true; })) },
    { id: "static", syntax: "set routing-options static route <prefix> next-hop <nexthop>", summary: "Add a static route", args: { prefix: prefA, nexthop: nhA }, run: ({ prefix, nexthop }) => setC((c) => { const [p, l] = prefix.split("/"); if (!c.statics.some((x) => x.prefix === p && x.len === +l)) c.statics.push({ prefix: p, len: +l, via: nexthop }); }) },
    { id: "delstatic", syntax: "delete routing-options static route <prefix>", summary: "Remove a static route", args: { prefix: prefA }, run: ({ prefix }) => { const [p, l] = prefix.split("/"); return cand.statics.some((x) => x.prefix === p && x.len === +l) ? setC((c) => { c.statics = c.statics.filter((x) => !(x.prefix === p && x.len === +l)); }) : refuse("warning: statement not found"); } },
    { id: "fltin", syntax: "set interfaces <iface> unit 0 family inet filter input WAN-IN", summary: "Apply WAN-IN inbound", args: { iface: ifArg }, run: ({ iface }) => setC((c) => { c.acl = { entries: c.acl?.entries ?? [], appliedIn: iface as IcIf }; }) },
    { id: "delfltin", syntax: "delete interfaces <iface> unit 0 family inet filter", summary: "Remove the inbound filter", args: { iface: ifArg }, run: ({ iface }) => (cand.acl?.appliedIn === iface ? setC((c) => { c.acl!.appliedIn = undefined; }) : refuse("warning: statement not found")) },
    { id: "tproto", syntax: "set firewall family inet filter WAN-IN term <term> from protocol icmp", summary: "Term matches ICMP", args: { term: termA }, run: ({ term: t }) => setC((c) => { term(c, t).proto = "icmp"; }) },
    { id: "ttype", syntax: "set firewall family inet filter WAN-IN term <term> from icmp-type <type>", summary: "Term matches one ICMP type", args: { term: termA, type: { choices: Object.keys(ICMP_JUNOS), resolve: (raw) => (ICMP_JUNOS[raw] ? raw : undefined) } }, run: ({ term: t, type }) => setC((c) => { const e = term(c, t); e.proto = "icmp"; e.icmp = ICMP_JUNOS[type]; }) },
    { id: "tthen", syntax: "set firewall family inet filter WAN-IN term <term> then <action>", summary: "accept or discard", args: { term: termA, action: { choices: ["accept", "discard"], resolve: (raw) => (raw === "accept" || raw === "discard" ? raw : undefined) } }, run: ({ term: t, action }) => setC((c) => { term(c, t).action = action === "accept" ? "permit" : "deny"; }) },
    { id: "deltrm", syntax: "delete firewall family inet filter WAN-IN term <term>", summary: "Remove a term", args: { term: termA }, run: ({ term: t }) => (cand.acl?.entries.some((e) => e.term === t) ? setC((c) => { c.acl!.entries = c.acl!.entries.filter((e) => e.term !== t); }) : refuse("warning: statement not found")) },
    { id: "show", syntax: "show", summary: "The candidate (try show | compare)", run: () => ({ output: junosText(cand) }) },
    ...(["interfaces", "routing-options", "firewall"] as const).map((p) => ({ id: "show", syntax: `show ${p}`, summary: `Candidate ${p}`, run: () => emptyLevel(junosText(cand, [p]), p, "candidate") })),
    { id: "show", syntax: "show interfaces <iface>", summary: "One interface in the candidate", args: { iface: ifArg }, run: ({ iface }) => ({ output: junosText(cand, ["interfaces", icJunosIf(iface as IcIf)]) }) },
    { id: "commit", syntax: "commit", summary: "Activate the candidate", run: () => doCommit(false) },
    { id: "commit", syntax: "commit and-quit", summary: "Activate the candidate and leave configuration mode", run: () => doCommit(true) },
    { id: "commit", syntax: "commit check", summary: "Validate without activating", run: () => { const err = junosCheck(cand); return err ? refuse(`${err}\nerror: configuration check-out failed`) : { output: "configuration check succeeds" }; } },
    { id: "rollback", syntax: "rollback", summary: "Discard uncommitted changes", run: () => (api.setCand(clone(active)), { output: "load complete" }) },
    { id: "rollback", syntax: "rollback <n>", summary: "Load an earlier commit into the candidate", args: { n: { choices: api.hist.map((_, i) => String(i)), resolve: (raw) => (/^\d+$/.test(raw) && +raw < api.hist.length ? raw : undefined) } }, run: ({ n }) => (api.setCand(clone(api.hist[+n].cfg)), { output: "load complete" }) },
    {
      id: "exit",
      syntax: "exit",
      summary: "Leave configuration mode",
      run: () => {
        if (!dirty || !api.ask) return (api.setJunosEdit(false), { output: "Exiting configuration mode" });
        api.ask({
          node: r,
          prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ",
          answer: (line) => {
            api.ask?.(undefined);
            if (/^n(o)?$/i.test(line.trim())) return { output: "" };
            api.setJunosEdit(false);
            return { output: "Exiting configuration mode" };
          },
          cancel: () => (api.ask?.(undefined), ""),
        });
        return { output: "" };
      },
    },
  ];
  const cmds: CliCommand[] = api.junosEdit ? edit : [...op, { id: "conf", syntax: "configure", summary: "Configuration mode (candidate)", run: () => (!dirty && api.setCand(clone(active)), api.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) }];
  return exactCase({ vendor: "juniper", deviceId: r, deviceName: r, prompt: api.junosEdit ? `admin@${r}# ` : `admin@${r}> `, commands: cmds });
}
/** A router answers its own addresses — only on interfaces that are up. */
const routerOwn = (api: IcCliApi, r: IcRouter) => (["ge0", "ge1"] as IcIf[]).filter((i) => api.view.cfg[r].ifs[i].up).map((i) => api.view.cfg[r].ifs[i].ip);
export const icRouterSets = (api: IcCliApi, r: IcRouter): Record<CliVendor, CliCommandSet> => ({ cisco: withSelfPing(iosRouter(api, r), "ios", routerOwn(api, r)), juniper: withSelfPing(junosRouter(api, r), "junos", routerOwn(api, r)) });
export const icJunosConfig = (hist: IcCommit[]) => (which: "committed" | number, path: string[]) => {
  const e = which === "committed" ? hist[0] : hist[which];
  return e ? junosText(e.cfg, path) : undefined;
};
export type { IcDev };
