import type { CliArgSpec, CliCommand, CliCommandSet, CliResult } from "@/lib/cli/types";
import { columns as fixedColumns } from "@/lib/cli/format";
import { SS_STATE, TN_ADDR, TN_DNS, TN_HTTP, TN_PORT_NAME, tnClone, tnListener, tnSockets, type TnAclEntry, type TnAction, type TnCfg, type TnIf, type TnIptRule, type TnServiceId, type TnState } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * Terminals of the TCP/UDP lab. Every output is printed from the network as it is (`view`) or from the test the model
 * just ran; every change goes through the model (`act`). Nothing is canned.
 *
 *   Laptop (Linux)  curl [--connect-timeout N] http://10.20.20.20[:port]/ · nc -vz [-w N] 10.20.20.20 <port> ·
 *                   dig @10.20.20.20 server.lab · ping -c N 10.20.20.20 · ss -tan / -tanp / -uan · ip addr · ip route ·
 *                   sleep N (the lab clock moves on: timers expire)
 *   Server (Linux)  ss -tlnp / -ulnp / -tan / -tanp / -uan · systemctl status|start|stop|restart ssh|nginx|named|api ·
 *                   iptables -L / -A|-I INPUT|OUTPUT … -j DROP|REJECT [--reject-with tcp-reset] / -D / -F ·
 *                   nc -lk <port> & · pkill nc · ip addr · ip route · ip route add|del default · curl http://localhost:<port>/
 *   R1              Cisco IOS: show ip interface brief · show interfaces <if> (counters, CRC) · show ip route ·
 *                   show access-lists · show running-config · configure terminal → ip access-list extended EDGE
 *                   (<seq> deny|permit …, no <seq>) · interface <if> → ip access-group EDGE in, (no) shutdown.
 *                   Junos: show interfaces terse · show interfaces <if> extensive · show route · show firewall ·
 *                   show configuration firewall · configure → delete …term / set|delete …filter input → commit.
 */

export type TcpIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; i: TnIf } | { kind: "acl" };
export interface TcpCliApi {
  view: TnState;
  act: (a: TnAction) => TnState;
  ios: TcpIosMode;
  setIos: (m: TcpIosMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: TnCfg["r1"];
  setCand: (c: TnCfg["r1"]) => void;
  /** Lines typed in this terminal session (the console adds the current one after it runs). */
  history?: string[];
}
/** history / show history / show cli history list the command being run too, as real shells do. */
const histCmd = (api: TcpCliApi, syntax: string, numbered: boolean): CliCommand => ({ id: "hist", syntax, summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), syntax].map((x, i) => (numbered ? `  ${i + 1}  ${x}` : `  ${x}`)).join("\n") }) });

/** Table output with each column as wide as its widest cell (+2). */
const columns = (rows: string[][]) => fixedColumns(rows, rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)) + 2));
const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const num = (lo: number, hi: number, choices: string[], what: string): CliArgSpec => ({ choices, describe: () => `${what} (${lo}–${hi})`, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= lo && +raw <= hi ? String(+raw) : undefined) });
const portArg = (choices: string[]): CliArgSpec => ({ choices, describe: (c) => TN_PORT_NAME[+c] ?? "TCP/UDP port", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 65535 ? String(+raw) : undefined) });
const PORTS = ["22", "80", "443", "8080", "8443", "9000"];
/** Mixed-case keywords (INPUT, DROP, -I…) must be typed exactly: the shared parser lowercases, so they become exact-match args. */
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
          const name = `${p}#${i}`;
          args[name] = { choices: [p], describe: () => (p.startsWith("-") ? "option (case-sensitive)" : "name (case-sensitive)"), resolve: (raw) => (raw === p ? p : undefined) };
          return `<${name}>`;
        })
        .join(" ");
      return { ...c, syntax, args };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// ss — the socket table, as ss prints it
// ---------------------------------------------------------------------------------------------------------------
function ss(s: TnState, host: "laptop" | "server", proto: "tcp" | "udp", only?: "listen", procs = false): string {
  const rows = tnSockets(s.cfg, s.tcbs, s.udp, host).filter((r) => r.proto === proto && (only !== "listen" || r.state === "LISTEN" || r.state === "UNCONN"));
  const head = proto === "tcp" ? ["State", "Recv-Q", "Send-Q", "Local Address:Port", "Peer Address:Port", ...(procs ? ["Process"] : [])] : ["State", "Recv-Q", "Send-Q", "Local Address:Port", "Peer Address:Port", ...(procs ? ["Process"] : [])];
  const body = rows.map((r) => [r.state, "0", r.tcb ? String(r.tcb.unacked.reduce((a, u) => a + (u.flags.includes("SYN") || u.flags.includes("FIN") ? 0 : u.len), 0)) : r.state === "LISTEN" ? "511" : "0", r.local, r.peer, ...(procs ? [r.proc ? `users:(("${r.proc}",pid=${pidOf(r.proc)},fd=${r.state === "LISTEN" ? 6 : 7}))` : ""] : [])]);
  return columns([head, ...body]);
}
const pidOf = (p: string) => ({ sshd: 812, nginx: 1044, named: 690, gunicorn: 1520, nc: 2210, curl: 3301 })[p] ?? 999;
const ssNote = (host: string, proto: "tcp" | "udp") =>
  proto === "udp" ? "UDP sockets are never ESTABLISHED: UNCONN just means the socket is open. There is no handshake, so there is no connection state to show." : `Each line is one socket. LISTEN = waiting for SYNs on that port; the other states belong to one conversation, identified by local and peer address:port. ${host === "server" ? "A SYN-RECV here means a SYN arrived and the SYN-ACK went out, but the final ACK hasn't come back." : "TIME-WAIT is the side that closed first, waiting 60 s before forgetting the connection."}`;

// ---------------------------------------------------------------------------------------------------------------
// The Laptop
// ---------------------------------------------------------------------------------------------------------------
function laptopSet(api: TcpCliApi): CliCommandSet {
  const s = api.view;
  const run = (a: TnAction, note?: string) => {
    const n = api.act(a);
    return { output: n.last?.output ?? "", explanation: note };
  };
  const ipT = { choices: [TN_ADDR.server], describe: () => "the Server", resolve: (raw: string) => (raw === TN_ADDR.server ? raw : undefined) };
  const sec = num(1, 300, ["5", "10", "30"], "seconds");
  const curlUrl = (raw: string) => {
    const m = /^http:\/\/10\.20\.20\.20(?::(\d+))?\/?$/.exec(raw);
    return m ? String(m[1] ?? 80) : undefined;
  };
  const url: CliArgSpec = { choices: ["http://10.20.20.20/", "http://10.20.20.20:8080/", "http://10.20.20.20:8443/"], describe: () => "URL on the Server (HTTP)", resolve: (raw) => curlUrl(raw) };
  const cmds: CliCommand[] = [
    { id: "curl", syntax: "curl <url>", summary: "Fetch a web page over TCP (handshake, request, page, close)", args: { url }, run: ({ url: p }) => run({ type: "curl", port: +p }, "curl opened a TCP connection, sent its request and read the page. Watch the topology: the handshake comes first, the data rides the established connection, then the close.") },
    { id: "curl", syntax: "curl --connect-timeout <sec> <url>", summary: "The same, giving up on the connection after <sec> seconds", args: { sec, url }, run: ({ sec: t, url: p }) => run({ type: "curl", port: +p, timeout: +t }) },
    { id: "nc", syntax: "nc -vz <ip> <port>", summary: "Test a TCP port: connect, then close at once", args: { ip: ipT, port: portArg(PORTS) }, run: ({ port }) => run({ type: "nc", port: +port }, "Succeeded = the three-way handshake completed. Refused = a RST (or ICMP) came back. Timed out = nothing came back at all.") },
    { id: "nc", syntax: "nc -zv <ip> <port>", summary: "", hidden: true, args: { ip: ipT, port: portArg(PORTS) }, run: ({ port }) => run({ type: "nc", port: +port }) },
    { id: "nc", syntax: "nc -vz -w <sec> <ip> <port>", summary: "Test a TCP port, giving up after <sec> seconds", args: { sec, ip: ipT, port: portArg(PORTS) }, run: ({ sec: t, port }) => run({ type: "nc", port: +port, timeout: +t }) },
    { id: "dig", syntax: `dig <at> ${TN_DNS.name}`, summary: "Ask the Server's DNS for server.lab (one UDP datagram, one answer)", args: { at: { choices: [`@${TN_ADDR.server}`], describe: () => "the DNS server to ask", resolve: (raw) => (raw === `@${TN_ADDR.server}` ? raw : undefined) } }, run: () => run({ type: "dig" }, "No handshake: one datagram out, one datagram back. If nothing comes back, dig (the application) retries — UDP never does.") },
    { id: "ping", syntax: "ping -c <n> <ip>", summary: "Is the Server reachable at the IP layer? (ICMP)", args: { n: num(1, 5, ["1", "3"], "count"), ip: ipT }, run: ({ n }) => run({ type: "ping", count: +n }, "Ping tests IP reachability both ways. It says nothing about whether a TCP port is open.") },
    { id: "ss", syntax: "ss -tan", summary: "TCP sockets on this host (all states, numeric)", run: () => ({ output: ss(s, "laptop", "tcp"), explanation: ssNote("laptop", "tcp") }) },
    { id: "ss", syntax: "ss -tanp", summary: "TCP sockets with the owning process", run: () => ({ output: ss(s, "laptop", "tcp", undefined, true), explanation: ssNote("laptop", "tcp") }) },
    { id: "ss", syntax: "ss -tn", summary: "", hidden: true, run: () => ({ output: ss(s, "laptop", "tcp") }) },
    { id: "ss", syntax: "ss -uan", summary: "UDP sockets on this host", run: () => ({ output: ss(s, "laptop", "udp"), explanation: ssNote("laptop", "udp") }) },
    { id: "ip-addr", syntax: "ip addr", summary: "This host's addresses", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${s.cfg.laptop.ip}/${s.cfg.laptop.prefix} brd 192.168.10.255 scope global eth0` }) },
    { id: "ip-route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${s.cfg.laptop.gw} dev eth0\n192.168.10.0/24 dev eth0 proto kernel scope link src ${s.cfg.laptop.ip}` }) },
    { id: "sleep", syntax: "sleep <sec>", summary: "Wait: the lab clock moves on (TIME-WAIT and retry timers expire)", args: { sec: num(1, 300, ["10", "60"], "seconds") }, run: ({ sec: t }) => (api.act({ type: "sleep", seconds: +t }), { output: "", explanation: `${t} s passed on the lab clock. Check ss -tan again: timers that ran out have done their work.` }) },
    histCmd(api, "history", true),
  ];
  return { vendor: "cisco", deviceId: "laptop", deviceName: "laptop", prompt: "admin@laptop:~$ ", commands: cmds };
}

// ---------------------------------------------------------------------------------------------------------------
// The Server
// ---------------------------------------------------------------------------------------------------------------
const UNITS: Record<string, TnServiceId> = { ssh: "sshd", nginx: "nginx", named: "named", api: "api" };
function iptList(rules: TnIptRule[], chain?: "INPUT" | "OUTPUT", counters = false) {
  const block = (ch: "INPUT" | "OUTPUT") => {
    const rs = rules.filter((r) => r.chain === ch);
    return [`Chain ${ch} (policy ACCEPT${counters ? " 0 packets, 0 bytes" : ""})`, `num ${counters ? " pkts " : ""}target     prot opt in     source               destination`, ...rs.map((r, i) => `${String(i + 1).padEnd(4)}${counters ? String(r.pkts).padStart(5) + " " : ""}${(r.target === "REJECT-RST" ? "REJECT" : r.target).padEnd(11)}${r.proto.padEnd(5)}--  ${(r.inIf ?? "*").padEnd(7)}0.0.0.0/0            0.0.0.0/0            ${r.port ? `${r.proto} ${ch === "INPUT" ? "dpt" : "spt"}:${r.port}` : ""}${r.target === "REJECT" ? " reject-with icmp-port-unreachable" : r.target === "REJECT-RST" ? " reject-with tcp-reset" : ""}`)].join("\n");
  };
  return (chain ? [chain] : (["INPUT", "OUTPUT"] as const)).map((c) => block(c as "INPUT" | "OUTPUT")).join("\n\n");
}
function serverSet(api: TcpCliApi): CliCommandSet {
  const s = api.view;
  const c = s.cfg.server;
  const set = (f: (x: TnCfg["server"]) => void, text: string) => {
    const cfg = tnClone(s.cfg);
    f(cfg.server);
    api.act({ type: "cfg", cfg, text: `Server: ${text}` });
  };
  const unit: CliArgSpec = { choices: Object.keys(UNITS), describe: (u) => c.services.find((x) => x.id === UNITS[u])?.what, resolve: (raw) => (UNITS[raw.replace(/\.service$/, "")] ? raw.replace(/\.service$/, "") : undefined) };
  const svc = (u: string) => c.services.find((x) => x.id === UNITS[u])!;
  const status = (u: string) => {
    const x = svc(u);
    return [`● ${u}.service - ${x.what}`, `     Loaded: loaded (/lib/systemd/system/${u}.service; enabled)`, `     Active: ${x.running ? "active (running)" : "inactive (dead)"}`, ...(x.running ? [`   Main PID: ${pidOf(x.proc)} (${x.proc})`, ...x.ports.map((p) => `     Listen: ${x.proto.toUpperCase()} 0.0.0.0:${p}`)] : [])].join("\n");
  };
  const add = (rule: TnIptRule, first: boolean) => set((x) => (x.ipt = first ? [rule, ...x.ipt] : [...x.ipt, rule]), `iptables ${first ? "-I" : "-A"} ${rule.chain} -p ${rule.proto}${rule.port ? ` --${rule.chain === "INPUT" ? "dport" : "sport"} ${rule.port}` : ""} -j ${rule.target === "REJECT-RST" ? "REJECT --reject-with tcp-reset" : rule.target}`);
  const targets: [string, TnIptRule["target"]][] = [
    ["DROP", "DROP"],
    ["REJECT", "REJECT"],
  ];
  const iptCmds: CliCommand[] = [];
  for (const op of ["-A", "-I"] as const)
    for (const proto of ["tcp", "udp"] as const) {
      for (const [t, target] of targets) {
        iptCmds.push({ id: "ipt-add", syntax: `sudo iptables ${op} INPUT -p ${proto} --dport <port> -j ${t}`, summary: `${op === "-I" ? "Insert at the top" : "Append"}: ${t} incoming ${proto.toUpperCase()} to <port>`, args: { port: portArg(PORTS) }, run: ({ port }) => (add({ chain: "INPUT", proto, port: +port, target, pkts: 0 }, op === "-I"), { output: "" }) });
        iptCmds.push({ id: "ipt-add", syntax: `sudo iptables ${op} INPUT -i eth0 -p ${proto} --dport <port> -j ${t}`, summary: "", hidden: true, args: { port: portArg(PORTS) }, run: ({ port }) => (add({ chain: "INPUT", proto, port: +port, target, inIf: "eth0", pkts: 0 }, op === "-I"), { output: "" }) });
      }
      if (proto === "tcp") iptCmds.push({ id: "ipt-add", syntax: `sudo iptables ${op} INPUT -p tcp --dport <port> -j REJECT --reject-with tcp-reset`, summary: `${op === "-I" ? "Insert" : "Append"}: answer incoming TCP to <port> with a reset`, args: { port: portArg(PORTS) }, run: ({ port }) => (add({ chain: "INPUT", proto: "tcp", port: +port, target: "REJECT-RST", pkts: 0 }, op === "-I"), { output: "" }) });
      iptCmds.push({ id: "ipt-add", syntax: `sudo iptables ${op} OUTPUT -p ${proto} --sport <port> -j DROP`, summary: `${op === "-I" ? "Insert" : "Append"}: drop this host's own ${proto.toUpperCase()} replies from <port>`, args: { port: portArg(PORTS) }, run: ({ port }) => (add({ chain: "OUTPUT", proto, port: +port, target: "DROP", pkts: 0 }, op === "-I"), { output: "" }) });
    }
  const cmds: CliCommand[] = [
    { id: "ss-l", syntax: "ss -tlnp", summary: "Which TCP ports are listening, and which process owns each", run: () => ({ output: ss(s, "server", "tcp", "listen", true), explanation: "If the port the client uses isn't in this list, nothing will accept its SYN: the Server's TCP answers RST — “connection refused”." }) },
    { id: "ss-l", syntax: "ss -ulnp", summary: "Which UDP ports are open, and which process owns each", run: () => ({ output: ss(s, "server", "udp", "listen", true), explanation: ssNote("server", "udp") }) },
    { id: "ss", syntax: "ss -tan", summary: "Every TCP socket on this host", run: () => ({ output: ss(s, "server", "tcp"), explanation: ssNote("server", "tcp") }) },
    { id: "ss", syntax: "ss -tanp", summary: "Every TCP socket, with its process", run: () => ({ output: ss(s, "server", "tcp", undefined, true), explanation: ssNote("server", "tcp") }) },
    { id: "ss", syntax: "ss -uan", summary: "Every UDP socket on this host", run: () => ({ output: ss(s, "server", "udp"), explanation: ssNote("server", "udp") }) },
    { id: "systemctl", syntax: "systemctl status <unit>", summary: "Is a service running, and what does it listen on?", args: { unit }, run: ({ unit: u }) => ({ output: status(u) }) },
    ...(["start", "stop", "restart"] as const).map((op) => ({
      id: "systemctl-op",
      syntax: `sudo systemctl ${op} <unit>`,
      summary: `${op[0].toUpperCase()}${op.slice(1)} a service`,
      args: { unit },
      run: ({ unit: u }: Record<string, string>) => {
        const x = svc(u);
        set((y) => (y.services.find((z) => z.id === x.id)!.running = op !== "stop"), `systemctl ${op} ${u}`);
        return { output: "", explanation: op === "stop" ? `${x.proc} no longer listens on ${x.proto.toUpperCase()} ${x.ports.join(", ")}. Verify with ${x.proto === "tcp" ? "ss -tlnp" : "ss -ulnp"}.` : `${x.proc} listens on ${x.proto.toUpperCase()} ${x.ports.join(", ")}. A started service isn't proof the clients can reach it — test from the Laptop.` };
      },
    })),
    { id: "ipt-l", syntax: "sudo iptables -L -n --line-numbers", summary: "List this host's firewall rules", run: () => ({ output: iptList(c.ipt), explanation: "First match wins. DROP sends nothing back; REJECT answers (ICMP port unreachable, or a TCP reset with --reject-with tcp-reset)." }) },
    { id: "ipt-l", syntax: "sudo iptables -L -n -v", summary: "List the rules with how many packets each matched", run: () => ({ output: iptList(c.ipt, undefined, true) }) },
    { id: "ipt-l", syntax: "sudo iptables -L", summary: "", hidden: true, run: () => ({ output: iptList(c.ipt) }) },
    ...(["INPUT", "OUTPUT"] as const).map((ch) => ({ id: "ipt-l", syntax: `sudo iptables -L ${ch} -n --line-numbers`, summary: `List the ${ch} rules`, run: () => ({ output: iptList(c.ipt, ch) }) })),
    ...iptCmds,
    ...(["INPUT", "OUTPUT"] as const).map((ch) => ({
      id: "ipt-d",
      syntax: `sudo iptables -D ${ch} <num>`,
      summary: `Delete rule <num> from ${ch}`,
      args: { num: num(1, 9, c.ipt.filter((r) => r.chain === ch).map((_, i) => String(i + 1)), "rule number") },
      run: ({ num: n }: Record<string, string>) => {
        const rs = c.ipt.filter((r) => r.chain === ch);
        const victim = rs[+n - 1];
        if (!victim) return refuse("iptables: Index of deletion too big.");
        set((x) => (x.ipt = x.ipt.filter((r) => r !== x.ipt.find((y) => JSON.stringify(y) === JSON.stringify(victim)))), `iptables -D ${ch} ${n}`);
        return { output: "" };
      },
    })),
    { id: "ipt-f", syntax: "sudo iptables -F", summary: "Remove every rule", run: () => (set((x) => (x.ipt = []), "iptables -F"), { output: "" }) },
    {
      id: "nc-l",
      syntax: "nc -lk <port> &",
      summary: "Start a listener on TCP <port> in the background",
      args: { port: portArg(["9000", "8080"]) },
      run: ({ port }) => {
        if (tnListener(s.cfg, "tcp", +port)) return refuse(`nc: Address already in use`);
        set((x) => (x.nc = [...x.nc, +port]), `nc -lk ${port} & (listening on TCP ${port})`);
        return { output: `[${c.nc.length + 1}] ${pidOf("nc") + c.nc.length}`, explanation: `nc now listens on TCP ${port}: check ss -tlnp, then connect from the Laptop.` };
      },
    },
    { id: "pkill", syntax: "pkill nc", summary: "Stop every nc listener", run: () => (c.nc.length ? (set((x) => (x.nc = []), "pkill nc"), { output: c.nc.map((p, i) => `[${i + 1}]+  Terminated              nc -lk ${p}`).join("\n") }) : refuse("")) },
    { id: "curl-local", syntax: "curl <url>", summary: "Test a service from the Server itself (over loopback)", args: { url: { choices: ["http://localhost/", "http://localhost:8443/"], describe: () => "a URL on this host (loopback)", resolve: (raw) => { const m = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?\/?$/.exec(raw); return m ? String(m[1] ?? 80) : undefined; } } }, run: ({ url: port }) => {
      const owner = tnListener(s.cfg, "tcp", +port);
      const blocked = c.ipt.find((r) => r.chain === "INPUT" && r.proto === "tcp" && r.port === +port && r.target !== "ACCEPT" && !r.inIf);
      if (!owner || owner === "sshd" || owner === "nc") return { output: `curl: (7) Failed to connect to localhost port ${port} after 0 ms: Connection refused`, explanation: "Nothing that speaks HTTP listens on that port on this host." };
      if (blocked) return { output: `curl: (28) Failed to connect to localhost port ${port} after 130000 ms: Connection timed out` };
      return { output: owner === "nginx" ? `<!doctype html>…<h1>It works over TCP.</h1>… (${TN_HTTP.response} bytes)` : `{"status":"ok","service":"api"}`, explanation: "Over loopback the request never touches eth0, R1 or a rule bound to -i eth0. Working here proves the service — not the network path to it." };
    } },
    { id: "ip-addr", syntax: "ip addr", summary: "This host's addresses", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${c.ip}/${c.prefix} brd 10.20.20.255 scope global eth0` }) },
    { id: "ip-route", syntax: "ip route", summary: "This host's routes — can its replies get back?", run: () => ({ output: [...(c.gw ? [`default via ${c.gw} dev eth0`] : []), `10.20.20.0/24 dev eth0 proto kernel scope link src ${c.ip}`].join("\n"), explanation: c.gw ? undefined : "No default route: this host can only reach 10.20.20.0/24. Its answers to anyone else can't be sent — it would receive SYNs and never answer." }) },
    { id: "ip-route-add", syntax: `sudo ip route add default via ${TN_ADDR.r1wan}`, summary: "Add the default route via R1", run: () => (c.gw ? refuse("RTNETLINK answers: File exists") : (set((x) => (x.gw = TN_ADDR.r1wan), "ip route add default via 10.20.20.1"), { output: "" })) },
    { id: "ip-route-del", syntax: "sudo ip route del default", summary: "Remove the default route", run: () => (!c.gw ? refuse("RTNETLINK answers: No such process") : (set((x) => (x.gw = undefined), "ip route del default"), { output: "" })) },
  ];
  return exactCase({ vendor: "cisco", deviceId: "server", deviceName: "server", prompt: "admin@server:~$ ", commands: [...cmds, histCmd(api, "history", true)] });
}

// ---------------------------------------------------------------------------------------------------------------
// R1
// ---------------------------------------------------------------------------------------------------------------
const IOS_IF: Record<TnIf, string> = { gi0: "GigabitEthernet0/0", gi1: "GigabitEthernet0/1" };
const JUNOS_IF: Record<TnIf, string> = { gi0: "ge-0/0/0", gi1: "ge-0/0/1" };
const ifArg = (names: Record<TnIf, string>): CliArgSpec => ({ choices: Object.values(names), describe: (c) => (c.endsWith("0") ? "toward the Laptop" : "toward the Server"), resolve: (raw) => Object.values(names).find((n) => n.toLowerCase() === raw.toLowerCase() || (n.startsWith("Gig") && `gi${n.slice(-3)}` === raw.toLowerCase()) || (n.startsWith("Gig") && `g${n.slice(-3)}` === raw.toLowerCase())) });
const ifOf = (name: string): TnIf => (name.endsWith("0/0") ? "gi0" : "gi1");
export const iosAclLine = (e: TnAclEntry) => {
  const end = (ip?: string, port?: number) => `${ip ? `host ${ip}` : "any"}${port !== undefined ? ` eq ${port === 80 ? "www" : port}` : ""}`;
  return `${e.seq} ${e.action} ${e.proto} ${end(e.src, e.srcPort)} ${end(e.dst, e.dstPort)}`.replace(/ +/g, " ");
};
function routerShows(s: TnState, junos: boolean): CliCommand[] {
  const r = s.cfg.r1;
  const ctr = (i: TnIf) => s.counters[i === "gi0" ? "r1:gi0" : "r1:gi1"];
  if (!junos)
    return [
      { id: "sh-ipint", syntax: "show ip interface brief", summary: "Interfaces, addresses and state", run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...(["gi0", "gi1"] as TnIf[]).map((i) => [IOS_IF[i], r.ifs[i].ip, "YES", "manual", r.ifs[i].up ? "up" : "administratively down", r.ifs[i].up ? "up" : "down"])]) }) },
      { id: "sh-int", syntax: "show interfaces <if>", summary: "Counters of one interface (packets, CRC errors)", args: { if: ifArg(IOS_IF) }, run: ({ if: n }) => {
        const i = ifOf(n);
        const k = ctr(i);
        return { output: [`${n} is ${r.ifs[i].up ? "up" : "administratively down"}, line protocol is ${r.ifs[i].up ? "up" : "down"}`, `  Internet address is ${r.ifs[i].ip}/${r.ifs[i].prefix}`, "  MTU 1500 bytes, BW 1000000 Kbit/sec", `     ${k.in} packets input, ${k.crc} input errors, ${k.crc} CRC, 0 frame, 0 overrun`, `     ${k.out} packets output, 0 output errors`].join("\n"), explanation: k.crc ? "CRC errors: frames arrived damaged and were discarded. Above IP nobody is told — TCP only notices the missing bytes and retransmits." : undefined };
      } },
      { id: "sh-route", syntax: "show ip route", summary: "R1's routing table", run: () => ({ output: ["Codes: C - connected, L - local", "", "Gateway of last resort is not set", "", ...(["gi0", "gi1"] as TnIf[]).filter((i) => r.ifs[i].up).flatMap((i) => [`C        ${i === "gi0" ? "192.168.10.0" : "10.20.20.0"}/24 is directly connected, ${IOS_IF[i]}`, `L        ${r.ifs[i].ip}/32 is directly connected, ${IOS_IF[i]}`])].join("\n") }) },
      { id: "sh-acl", syntax: "show access-lists", summary: "R1's ACLs, with how many packets matched each line", run: () => ({ output: [`Extended IP access list ${r.acl.name}`, ...r.acl.entries.map((e) => `    ${iosAclLine(e)}${e.hits ? ` (${e.hits} matches)` : ""}`)].join("\n"), explanation: r.acl.appliedIn ? `Applied inbound on ${IOS_IF[r.acl.appliedIn]}. A deny drops silently — no RST, no ICMP. Matches counting up while the client times out is strong evidence.` : "Not applied to any interface: it filters nothing." }) },
      { id: "sh-run", syntax: "show running-config", summary: "R1's configuration", run: () => ({ output: ["hostname R1", "!", ...(["gi0", "gi1"] as TnIf[]).flatMap((i) => [`interface ${IOS_IF[i]}`, ` ip address ${r.ifs[i].ip} 255.255.255.0`, ...(r.acl.appliedIn === i ? [` ip access-group ${r.acl.name} in`] : []), ...(r.ifs[i].up ? [] : [" shutdown"]), "!"]), `ip access-list extended ${r.acl.name}`, ...r.acl.entries.map((e) => ` ${iosAclLine(e)}`), "!", "end"].join("\n") }) },
    ];
  const term = (e: TnAclEntry) => `t${e.seq}`;
  return [
    { id: "sh-int", syntax: "show interfaces terse", summary: "Interfaces and state", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...(["gi0", "gi1"] as TnIf[]).map((i) => [`${JUNOS_IF[i]}.0`, r.ifs[i].up ? "up" : "down", r.ifs[i].up ? "up" : "down", "inet", `${r.ifs[i].ip}/24`])]) }) },
    { id: "sh-int", syntax: "show interfaces <if> extensive", summary: "Counters and errors of one interface", args: { if: ifArg(JUNOS_IF) }, run: ({ if: n }) => {
      const i = ifOf(n);
      const k = ctr(i);
      return { output: [`Physical interface: ${n}, Enabled, Physical link is ${r.ifs[i].up ? "Up" : "Down"}`, "  Traffic statistics:", `   Input  packets: ${k.in}`, `   Output packets: ${k.out}`, "  Input errors:", `    Errors: ${k.crc}, Drops: 0, Framing errors: ${k.crc}, Runts: 0`].join("\n") };
    } },
    { id: "sh-route", syntax: "show route", summary: "R1's routing table", run: () => ({ output: ["inet.0: 4 destinations, 4 routes", "", ...(["gi0", "gi1"] as TnIf[]).filter((i) => r.ifs[i].up).flatMap((i) => [`${i === "gi0" ? "192.168.10.0" : "10.20.20.0"}/24     *[Direct/0] > via ${JUNOS_IF[i]}.0`, `${r.ifs[i].ip}/32  *[Local/0] Local via ${JUNOS_IF[i]}.0`])].join("\n") }) },
    { id: "sh-fw", syntax: "show firewall", summary: "Filter counters", run: () => ({ output: [`Filter: ${r.acl.name}`, "Counters:", "Name                         Bytes      Packets", ...r.acl.entries.map((e) => `${term(e).padEnd(29)}${String(e.hits * 60).padEnd(11)}${e.hits}`)].join("\n") }) },
    { id: "sh-cfg", syntax: "show configuration firewall", summary: "The filter's terms", run: () => ({ output: [`family inet {`, `    filter ${r.acl.name} {`, ...r.acl.entries.flatMap((e) => [`        term ${term(e)} {`, ...(e.proto !== "ip" || e.src || e.srcPort || e.dstPort ? [`            from {`, ...(e.src ? [`                source-address ${e.src}/32;`] : []), ...(e.proto !== "ip" ? [`                protocol ${e.proto};`] : []), ...(e.srcPort !== undefined ? [`                source-port ${e.srcPort};`] : []), ...(e.dstPort !== undefined ? [`                destination-port ${e.dstPort};`] : []), "            }"] : []), `            then ${e.action === "permit" ? "accept" : "discard"};`, "        }"]), "    }", "}", ...(r.acl.appliedIn ? [`# applied: interfaces ${JUNOS_IF[r.acl.appliedIn]} unit 0 family inet filter input ${r.acl.name}`] : [])].join("\n") }) },
  ];
}
function r1Ios(api: TcpCliApi): CliCommandSet {
  const s = api.view;
  const r = s.cfg.r1;
  const set = (f: (x: TnCfg["r1"]) => void, text: string) => {
    const cfg = tnClone(s.cfg);
    f(cfg.r1);
    api.act({ type: "cfg", cfg, text: `R1: ${text}` });
  };
  const mode = api.ios;
  const prompt = mode.kind === "exec" ? "R1#" : mode.kind === "config" ? "R1(config)#" : mode.kind === "if" ? "R1(config-if)#" : "R1(config-ext-nacl)#";
  const exit: CliCommand[] = [
    { id: "end", syntax: "end", summary: "Back to privileged EXEC", run: () => (api.setIos({ kind: "exec" }), { output: "" }) },
    { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setIos(mode.kind === "config" ? { kind: "exec" } : { kind: "config" }), { output: "" }) },
  ];
  let cmds: CliCommand[];
  if (mode.kind === "exec") cmds = [...routerShows(s, false), histCmd(api, "show history", false), { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }];
  else if (mode.kind === "config")
    cmds = [
      { id: "if", syntax: "interface <if>", summary: "Configure an interface", args: { if: ifArg(IOS_IF) }, run: ({ if: n }) => (api.setIos({ kind: "if", i: ifOf(n) }), { output: "" }) },
      { id: "acl", syntax: `ip access-list extended ${r.acl.name.toLowerCase()}`, summary: `Edit the ACL ${r.acl.name}`, run: () => (api.setIos({ kind: "acl" }), { output: "", explanation: `Editing the ${r.acl.name} entries: lines are checked top to bottom by sequence number, and anything not permitted is denied.` }) },
      ...exit,
      ...routerShows(s, false).map((c) => ({ ...c, syntax: `do ${c.syntax}`, hidden: true })),
    ];
  else if (mode.kind === "if") {
    const i = mode.i;
    cmds = [
      { id: "ag", syntax: `ip access-group ${r.acl.name.toLowerCase()} in`, summary: "Filter what arrives on this interface", run: () => (set((x) => (x.acl.appliedIn = i), `interface ${IOS_IF[i]} ip access-group ${r.acl.name} in`), { output: "", explanation: `${r.acl.name} now filters every packet arriving on ${IOS_IF[i]}.` }) },
      { id: "no-ag", syntax: `no ip access-group ${r.acl.name.toLowerCase()} in`, summary: "Stop filtering here", run: () => (set((x) => (x.acl.appliedIn = x.acl.appliedIn === i ? undefined : x.acl.appliedIn), `interface ${IOS_IF[i]} no ip access-group ${r.acl.name} in`), { output: "" }) },
      { id: "shut", syntax: "shutdown", summary: "Disable the interface", run: () => (set((x) => (x.ifs[i].up = false), `interface ${IOS_IF[i]} shutdown`), { output: "" }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable the interface", run: () => (set((x) => (x.ifs[i].up = true), `interface ${IOS_IF[i]} no shutdown`), { output: "" }) },
      ...exit,
    ];
  } else {
    const seq = num(1, 99, ["5", "10", "15", "20"], "sequence number");
    const port = portArg(["80", "443", "53", "22", "8443"]);
    const put = (e: TnAclEntry) => set((x) => (x.acl.entries = [...x.acl.entries.filter((y) => y.seq !== e.seq), e].sort((a, b) => a.seq - b.seq)), `ACL ${r.acl.name}: ${iosAclLine(e)}`);
    cmds = [
      { id: "ace", syntax: "<seq> permit ip any any", summary: "Permit everything", args: { seq }, run: ({ seq: n }) => (put({ seq: +n, action: "permit", proto: "ip", hits: 0 }), { output: "" }) },
      ...(["deny", "permit"] as const).flatMap((action) => [
        { id: "ace", syntax: `<seq> ${action} tcp host ${TN_ADDR.server} eq <port> any`, summary: `${action} TCP from the Server's port`, args: { seq, port }, run: ({ seq: n, port: p }: Record<string, string>) => (put({ seq: +n, action, proto: "tcp", src: TN_ADDR.server, srcPort: +p, hits: 0 }), { output: "" }) },
        { id: "ace", syntax: `<seq> ${action} tcp any host ${TN_ADDR.server} eq <port>`, summary: `${action} TCP to the Server's port`, args: { seq, port }, run: ({ seq: n, port: p }: Record<string, string>) => (put({ seq: +n, action, proto: "tcp", dst: TN_ADDR.server, dstPort: +p, hits: 0 }), { output: "" }) },
        { id: "ace", syntax: `<seq> ${action} udp any host ${TN_ADDR.server} eq <port>`, summary: `${action} UDP to the Server's port`, args: { seq, port }, run: ({ seq: n, port: p }: Record<string, string>) => (put({ seq: +n, action, proto: "udp", dst: TN_ADDR.server, dstPort: +p, hits: 0 }), { output: "" }) },
      ]),
      { id: "no-ace", syntax: "no <seq>", summary: "Remove a line", args: { seq: num(1, 99, r.acl.entries.map((e) => String(e.seq)), "sequence number") }, run: ({ seq: n }) => (r.acl.entries.some((e) => e.seq === +n) ? (set((x) => (x.acl.entries = x.acl.entries.filter((e) => e.seq !== +n)), `ACL ${r.acl.name}: no ${n}`), { output: "" }) : refuse("% Entry does not exist")) },
      ...exit,
    ];
  }
  return exactCase({ vendor: "cisco", deviceId: "r1", deviceName: "R1", prompt, commands: cmds });
}
function r1Junos(api: TcpCliApi): CliCommandSet {
  const s = api.view;
  const edit = api.junosEdit;
  const cand = api.cand;
  const prompt = edit ? "admin@R1# " : "admin@R1> ";
  const term = num(1, 99, cand.acl.entries.map((e) => `t${e.seq}`), "term");
  const termArg: CliArgSpec = { ...term, resolve: (raw) => (cand.acl.entries.some((e) => `t${e.seq}` === raw) ? raw : undefined) };
  const dirty = JSON.stringify(cand) !== JSON.stringify(s.cfg.r1);
  const doCommit = (quit: boolean): CliResult => {
    if (dirty) {
      const cfg = tnClone(s.cfg);
      cfg.r1 = tnClone(cand);
      api.act({ type: "cfg", cfg, text: "R1: Junos commit" });
    }
    if (quit) api.setJunosEdit(false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete" };
  };
  // The candidate's firewall, printed exactly like the active one.
  const candShow = routerShows({ ...s, cfg: { ...s.cfg, r1: cand } }, true).find((c) => c.syntax === "show configuration firewall");
  const cmds: CliCommand[] = edit
    ? [
        { id: "del-term", syntax: `delete firewall family inet filter ${cand.acl.name} term <term>`, summary: "Remove a term (candidate)", args: { term: termArg }, run: ({ term: t }) => (api.setCand({ ...cand, acl: { ...cand.acl, entries: cand.acl.entries.filter((e) => `t${e.seq}` !== t) } }), { output: "" }) },
        { id: "del-in", syntax: "delete interfaces <if> unit 0 family inet filter input", summary: "Stop filtering on an interface (candidate)", args: { if: ifArg(JUNOS_IF) }, run: ({ if: n }) => (api.setCand({ ...cand, acl: { ...cand.acl, appliedIn: cand.acl.appliedIn === ifOf(n) ? undefined : cand.acl.appliedIn } }), { output: "" }) },
        { id: "set-in", syntax: `set interfaces <if> unit 0 family inet filter input ${cand.acl.name}`, summary: "Filter what arrives on an interface (candidate)", args: { if: ifArg(JUNOS_IF) }, run: ({ if: n }) => (api.setCand({ ...cand, acl: { ...cand.acl, appliedIn: ifOf(n) } }), { output: "" }) },
        ...(candShow ? [{ ...candShow, id: "show-fw", syntax: "show firewall", summary: "The candidate's filter terms" }] : []),
        { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
        { id: "commit", syntax: "commit and-quit", summary: "Activate the candidate and leave configuration mode", run: () => doCommit(true) },
        { id: "commit", syntax: "commit check", summary: "Validate without activating", run: () => ({ output: "configuration check succeeds", explanation: dirty ? "Valid, but nothing is active until you commit." : undefined }) },
        { id: "rollback", syntax: "rollback", summary: "Discard uncommitted changes", run: () => (api.setCand(tnClone(s.cfg.r1)), { output: "load complete" }) },
        { id: "exit", syntax: "exit", summary: "Leave configuration mode", run: () => (api.setJunosEdit(false), dirty ? { output: "The configuration has been changed but not committed\nExiting configuration mode", explanation: "The candidate keeps your changes: configure again and commit, or rollback to discard them." } : { output: "Exiting configuration mode" }) },
        ...routerShows(s, true).map((c) => ({ ...c, syntax: `run ${c.syntax}`, hidden: true })),
      ]
    : [...routerShows(s, true), histCmd(api, "show cli history", false), { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (dirty || api.setCand(tnClone(s.cfg.r1)), api.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed" : "Entering configuration mode" }) }];
  return exactCase({ vendor: "juniper", deviceId: "r1", deviceName: "R1", prompt, commands: cmds });
}

export const tcpLaptopSet = laptopSet;
export const tcpServerSet = serverSet;
export const tcpR1Sets = (api: TcpCliApi) => ({ cisco: r1Ios(api), juniper: r1Junos(api) });
export const SS = SS_STATE;
