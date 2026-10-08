import type { CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, junosMac, readOnlyBoundaryCommands } from "@/lib/cli/format";
import { DNS_RECORD_TTL } from "@/lib/sim-engine/scenarios/dhcpDns";
import { DL_APIPA, DL_IFACES, DL_MAC, DL_NODE_IFACES, configured, dhcpProblem, dhcpRunning, fmtT, leaseLeft, type DlIface, type DlNode, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { dhcpdConf, zoneFile } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";

/**
 * The DHCP & DNS Lab's CLI adapter: scenario truth → command output. Every command reads the same lab state as the
 * Investigate panel (counters, ARP, MAC tables, relay counters, leases, logs). Outputs are trimmed to the lines that
 * matter for this lab; the CLI is read-only.
 */

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const MACS: Record<string, string> = { [DL_MAC.CLIENT]: "CLIENT", [DL_MAC.R1C]: "R1 ge-0/0/0", [DL_MAC.R1S]: "R1 ge-0/0/1", [DL_MAC.SRV]: "DHCP-SRV", [DL_MAC.DNS]: "DNS-SRV" };
export const SHELL: Partial<Record<DlNode, string>> = { CLIENT: "Windows command prompt", "DHCP-SRV": "Linux shell", "DNS-SRV": "Linux shell" };

function ifaceNames(node: DlNode, vendor: CliVendor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of DL_NODE_IFACES[node]) out[i] = vendor === "cisco" ? (DL_IFACES[i].cisco.startsWith("Gi") ? DL_IFACES[i].cisco.replace("Gi", "GigabitEthernet") : DL_IFACES[i].cisco) : DL_IFACES[i].name;
  return out;
}
function ifaceHelp(node: DlNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of DL_NODE_IFACES[node]) out[i] = `towards ${DL_IFACES[i].faces}`;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// R1 — gateway and DHCP relay
// ---------------------------------------------------------------------------------------------------------------
function r1(s: DlState, vendor: CliVendor): CliCommandSet {
  const names = ifaceNames("R1", vendor);
  const ifArg = { iface: interfaceArg(vendor, names, ifaceHelp("R1")) };
  const relay = s.config.relay && !!s.config.helper;
  const helperOn = (i: DlIface) => relay && DL_IFACES[i].name === s.config.helperIf;
  const ctr = (i: DlIface) => s.net.counters[i];
  const arpRows = Object.entries(s.net.arp.R1);
  const cmds: CliCommand[] =
    vendor === "cisco"
      ? [
          {
            id: "r1-ip-brief",
            syntax: "show ip interface brief",
            summary: "Interfaces, addresses and status",
            run: () => ({
              output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...DL_NODE_IFACES.R1.map((i) => [names[i], DL_IFACES[i].ip!, "YES", "manual", "up", "up"])], [23, 16, 5, 7, 22]),
              explanation: "All three interfaces are up with their addresses. Up/up proves the links work; it says nothing about relaying or routing decisions.",
            }),
          },
          {
            id: "r1-ip-int",
            syntax: "show ip interface <iface>",
            summary: "Layer 3 settings of one interface, including the DHCP helper",
            args: ifArg,
            run: ({ iface }) => {
              const i = iface as DlIface;
              const helper = helperOn(i) ? `  Helper address is ${s.config.helper}` : "  Helper address is not set";
              return {
                output: [`${names[i]} is up, line protocol is up`, `  Internet address is ${DL_IFACES[i].ip}/${i === "R1:ge-0/0/2" ? 30 : 24}`, "  Broadcast address is 255.255.255.255", helper, "  Directed broadcast forwarding is disabled"].join("\n"),
                explanation: i === "R1:ge-0/0/0" ? (helperOn(i) ? `The helper address is what makes R1 a DHCP relay on the client LAN: DHCP broadcasts arriving here are re-sent as unicast to ${s.config.helper}.` : "No helper address on the client-facing interface: DHCP broadcasts from clients arrive here and go nowhere. This line alone explains clients that get 169.254 addresses.") : helperOn(i) ? "A helper is configured on this, the servers' side, but clients' broadcasts never arrive here: it relays nothing. It belongs on the interface facing the clients." : "The helper only matters on the interface where the clients' broadcasts arrive (the client LAN side).",
              };
            },
          },
          {
            id: "r1-int",
            syntax: "show interfaces <iface>",
            summary: "Interface counters: packets and broadcasts in and out",
            args: ifArg,
            run: ({ iface }) => {
              const i = iface as DlIface;
              const c = ctr(i);
              return {
                output: [`${names[i]} is up, line protocol is up`, `  Hardware is Gigabit Ethernet, address is ${ciscoMac(DL_IFACES[i].mac!)}`, `  Internet address is ${DL_IFACES[i].ip}`, `     ${c.inPkts} packets input, ${c.inBcast} broadcasts`, `     ${c.outPkts} packets output, ${c.outBcast} broadcasts`, "     0 input errors, 0 CRC, 0 output errors"].join("\n"),
                explanation: "Counters started at zero when the lab began. They prove traffic crossed this interface and in which direction, not what kind or why. Compare two interfaces: frames in on one side and nothing out on the other means R1 stopped them.",
              };
            },
          },
          {
            id: "r1-arp",
            syntax: "show ip arp",
            summary: "R1's ARP cache",
            run: () => ({
              output: columns([["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"], ...DL_NODE_IFACES.R1.filter((i) => i !== "R1:ge-0/0/2").map((i) => ["Internet", DL_IFACES[i].ip!, "-", ciscoMac(DL_IFACES[i].mac!), "ARPA", names[i]]), ...arpRows.map(([ip, m]) => ["Internet", ip, "0", m === "incomplete" ? "Incomplete" : ciscoMac(m), "ARPA", ip.startsWith("10.10.10.") ? names["R1:ge-0/0/0"] : names["R1:ge-0/0/1"]])], [10, 17, 11, 16, 6]),
              explanation: arpRows.some(([, m]) => m === "incomplete") ? "An Incomplete entry means R1 asked “who has this address?” and nobody answered. R1 can't forward anything to that address: it has no MAC to put in the frame." : "R1 knows the MAC address of every neighbor it has talked to. A host R1 needs but doesn't know would show up as Incomplete.",
            }),
          },
          {
            id: "r1-route",
            syntax: "show ip route",
            summary: "Routing table",
            run: () => ({ output: ["Gateway of last resort is 198.51.100.1 to network 0.0.0.0", "", "S*    0.0.0.0/0 [1/0] via 198.51.100.1", "C     10.10.10.0/24 is directly connected, GigabitEthernet0/0", "C     10.20.20.0/24 is directly connected, GigabitEthernet0/1", "C     198.51.100.0/30 is directly connected, GigabitEthernet0/2"].join("\n"), explanation: "Both LANs are directly connected, so R1 can route between them. Routing isn't the problem in this lab: the interesting failures are relaying, ARP and services." }),
          },
          {
            id: "r1-run-int",
            syntax: "show running-config interface <iface>",
            summary: "The configuration of one interface",
            args: ifArg,
            run: ({ iface }) => {
              const i = iface as DlIface;
              return { output: [`interface ${names[i]}`, ` ip address ${DL_IFACES[i].ip} ${i === "R1:ge-0/0/2" ? "255.255.255.252" : "255.255.255.0"}`, ...(helperOn(i) ? [` ip helper-address ${s.config.helper}`] : []), " no shutdown", "end"].join("\n"), explanation: helperOn(i) ? (i === "R1:ge-0/0/0" ? "ip helper-address is the relay configuration." : "A helper on the servers' side relays nothing: client broadcasts arrive on Gi0/0.") : i === "R1:ge-0/0/0" ? "No ip helper-address line: this interface does not relay DHCP." : undefined };
            },
          },
        ]
      : [
          {
            id: "r1-terse",
            syntax: "show interfaces terse",
            summary: "Interfaces, addresses and status",
            run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...DL_NODE_IFACES.R1.flatMap((i) => [[names[i], "up", "up", "", ""], [`${names[i]}.0`, "up", "up", "inet", `${DL_IFACES[i].ip}/${i === "R1:ge-0/0/2" ? 30 : 24}`]])], [16, 6, 6, 6]), explanation: "All interfaces are up with their addresses. That proves the links work, not that DHCP is relayed." }),
          },
          {
            id: "r1-int",
            syntax: "show interfaces <iface>",
            summary: "Interface counters",
            args: ifArg,
            run: ({ iface }) => {
              const i = iface as DlIface;
              const c = ctr(i);
              return { output: [`Physical interface: ${names[i]}, Enabled, Physical link is Up`, `  Current address: ${junosMac(DL_IFACES[i].mac!)}`, "  Traffic statistics:", `   Input  packets:            ${c.inPkts}`, `   Output packets:            ${c.outPkts}`, `   Input broadcasts:          ${c.inBcast}`, `   Output broadcasts:         ${c.outBcast}`].join("\n"), explanation: "Counters started at zero when the lab began. Frames in on one interface and nothing out on the other means R1 stopped them." };
            },
          },
          {
            id: "r1-relay-stats",
            syntax: "show dhcp relay statistics",
            summary: "What the DHCP relay agent received and sent",
            run: () => {
              if (!relay) return { output: "DHCP relay is not configured on this router.", explanation: "No relay configuration: client broadcasts arriving on ge-0/0/0 are simply dropped." };
              const r = s.net.relay;
              return { output: ["Packets dropped:", "    Total                      0", "", "Messages received:", `    BOOTREQUEST                ${r.fromClients}`, `    DHCPDISCOVER               ${r.byType.DISCOVER ?? 0}`, `    DHCPREQUEST                ${r.byType.REQUEST ?? 0}`, `    BOOTREPLY                  ${r.fromServer}`, "", "Messages sent:", `    BOOTREQUEST                ${r.toServer}`, `    BOOTREPLY                  ${r.toClients}`].join("\n"), explanation: "BOOTREQUESTs come from clients and are sent on to the server; BOOTREPLYs come from the server and are sent on to clients. Requests received but no replies means the server side is silent: look at DHCP-SRV next." };
            },
          },
          {
            id: "r1-relay-conf",
            syntax: "show configuration forwarding-options dhcp-relay",
            summary: "The DHCP relay configuration",
            run: () => ({ output: relay ? ["server-group {", "    DHCP-SERVERS {", `        ${s.config.helper};`, "    }", "}", "group CLIENTS {", "    active-server-group DHCP-SERVERS;", `    interface ${s.config.helperIf}.0;`, "}"].join("\n") : "", explanation: relay ? "Clients on ge-0/0/0 are relayed to the DHCP-SERVERS group." : "Empty: nothing is configured, so R1 relays nothing." }),
          },
          {
            id: "r1-arp",
            syntax: "show arp no-resolve",
            summary: "R1's ARP cache",
            run: () => ({ output: columns([["MAC Address", "Address", "Interface", "Flags"], ...arpRows.filter(([, m]) => m !== "incomplete").map(([ip, m]) => [junosMac(m), ip, ip.startsWith("10.10.10.") ? "ge-0/0/0.0" : "ge-0/0/1.0", "none"])], [19, 15, 13]) + (arpRows.some(([, m]) => m === "incomplete") ? `\n(no entry for: ${arpRows.filter(([, m]) => m === "incomplete").map(([ip]) => ip).join(", ")})` : ""), explanation: "Junos lists only resolved neighbors. An address R1 needed but couldn't resolve is simply missing, and nothing can be forwarded to it." }),
          },
          {
            id: "r1-route",
            syntax: "show route",
            summary: "Routing table",
            run: () => ({ output: ["inet.0: 6 destinations, 6 routes", "", "0.0.0.0/0          *[Static/5] > to 198.51.100.1 via ge-0/0/2.0", "10.10.10.0/24      *[Direct/0] > via ge-0/0/0.0", "10.20.20.0/24      *[Direct/0] > via ge-0/0/1.0", "198.51.100.0/30    *[Direct/0] > via ge-0/0/2.0"].join("\n"), explanation: "Both LANs are directly connected: routing between them isn't the problem in this lab." }),
          },
        ];
  return { vendor, deviceId: "R1", deviceName: "R1", prompt: vendor === "cisco" ? "R1#" : "admin@R1> ", commands: [...cmds, ...readOnlyBoundaryCommands(vendor)] };
}

// ---------------------------------------------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------------------------------------------
function sw(s: DlState, node: "SW1" | "SW2", vendor: CliVendor): CliCommandSet {
  const names = ifaceNames(node, vendor);
  const ifArg = { iface: interfaceArg(vendor, names, ifaceHelp(node)) };
  const table = Object.entries(s.net.mac[node]);
  // IOS prints ports in their short form in the MAC table (Gi1/0/24), as the topology labels them.
  const portName = (junosPort: string) => (vendor === "cisco" ? DL_IFACES[`${node}:${junosPort}` as DlIface].cisco : junosPort);
  const cmds: CliCommand[] = [
    vendor === "cisco"
      ? { id: "sw-mac", syntax: "show mac address-table", summary: "Which MAC address was learned on which port", run: () => ({ output: columns([["Vlan", "Mac Address", "Type", "Ports"], ...table.map(([m, port]) => ["1", ciscoMac(m), "DYNAMIC", portName(port)])], [6, 17, 10]), explanation: `Each line says: a frame FROM this MAC arrived on that port. ${node === "SW1" ? "If the client's MAC is here, the client's frames reach the switch." : `Learned on ${portName("ge-0/0/24")} means behind R1.`} It says nothing about IP, DHCP or DNS.` }) }
      : { id: "sw-mac", syntax: "show ethernet-switching table", summary: "Which MAC address was learned on which port", run: () => ({ output: columns([["MAC address", "Type", "Interface"], ...table.map(([m, port]) => [junosMac(m), "Learn", `${port}.0`])], [20, 8]), explanation: `Each line says: a frame FROM this MAC arrived on that port. It says nothing about IP, DHCP or DNS.` }) },
    {
      id: "sw-int",
      syntax: "show interfaces <iface>",
      summary: "Port counters",
      args: ifArg,
      run: ({ iface }) => {
        const i = iface as DlIface;
        const c = s.net.counters[i];
        return { output: vendor === "cisco" ? [`${names[i]} is up, line protocol is up (connected)`, `  Description: to ${DL_IFACES[i].faces}`, `     ${c.inPkts} packets input, ${c.inBcast} broadcasts`, `     ${c.outPkts} packets output, ${c.outBcast} broadcasts`].join("\n") : [`Physical interface: ${names[i]}, Enabled, Physical link is Up`, `  Description: to ${DL_IFACES[i].faces}`, `   Input  packets:            ${c.inPkts}`, `   Output packets:            ${c.outPkts}`, `   Input broadcasts:          ${c.inBcast}`, `   Output broadcasts:         ${c.outBcast}`].join("\n"), explanation: "Packets input = frames that arrived from the device on this port; output = frames the switch sent to it. Counters can't tell you what the frames were: for that, capture on a mirror port." };
      },
    },
  ];
  return { vendor, deviceId: node, deviceName: node, prompt: vendor === "cisco" ? `${node}#` : `admin@${node}> `, commands: [...cmds, ...readOnlyBoundaryCommands(vendor)] };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function client(s: DlState, vendor: CliVendor): CliCommandSet {
  const c = s.client;
  const dash = (m: string) => m.replace(/:/g, "-").toLowerCase();
  const cmds: CliCommand[] = [
    {
      id: "c-ipconfig",
      syntax: "ipconfig /all",
      summary: "The laptop's network identity",
      run: () => {
        const head = ["Ethernet adapter Ethernet:", "", `   Physical Address. . . . . . . . . : ${dash(DL_MAC.CLIENT).toUpperCase()}`, "   DHCP Enabled. . . . . . . . . . . : Yes"];
        if (c.phase === "APIPA") return { output: [...head, `   Autoconfiguration IPv4 Address. . : ${DL_APIPA}(Preferred)`, "   Subnet Mask . . . . . . . . . . . : 255.255.0.0", "   Default Gateway . . . . . . . . . :", "   DNS Servers . . . . . . . . . . . :"].join("\n"), explanation: "“Autoconfiguration” 169.254.x.x means no DHCP server answered: the laptop gave itself a link-local address. No gateway, no DNS. The question becomes: where did its DISCOVERs stop?" };
        if (!configured(c)) return { output: [...head, `   (no IPv4 address yet: DHCP ${c.phase})`].join("\n"), explanation: "The client is still in the DHCP exchange: nothing is configured until the ACK arrives." };
        return {
          output: [...head, `   IPv4 Address. . . . . . . . . . . : ${c.ip}(Preferred)`, `   Subnet Mask . . . . . . . . . . . : ${c.mask}`, `   Lease Obtained. . . . . . . . . . : ${fmtT(c.leaseStart ?? 0)}`, `   Lease Expires . . . . . . . . . . : ${fmtT((c.leaseStart ?? 0) + (c.lease ?? 0))}  (${Math.round(leaseLeft(s) / 60)} min left)`, `   Default Gateway . . . . . . . . . : ${c.gw}`, `   DHCP Server . . . . . . . . . . . : ${c.serverId}`, `   DNS Servers . . . . . . . . . . . : ${c.dns}`].join("\n"),
          explanation: "Every value here came from the DHCP server's ACK. If the gateway or DNS server is wrong, the client is only repeating what the server told it: fix the scope, then renew.",
        };
      },
    },
    {
      id: "c-arp",
      syntax: "arp -a",
      summary: "The laptop's ARP cache",
      run: () => {
        const ok = Object.entries(s.net.arp.CLIENT).filter(([, m]) => m !== "incomplete");
        const failed = Object.entries(s.net.arp.CLIENT).filter(([, m]) => m === "incomplete").map(([ip]) => ip);
        if (!c.ip) return { output: "No ARP Entries Found.", explanation: "No address, no ARP." };
        return { output: ok.length ? [`Interface: ${c.ip} --- 0x4`, "  Internet Address      Physical Address      Type", ...ok.map(([ip, m]) => `  ${pad(ip, 22)}${pad(dash(m), 22)}dynamic`)].join("\n") : "No ARP Entries Found.", explanation: failed.length ? `Windows doesn't list addresses it asked for but never resolved. ${failed.join(", ")} is missing although the laptop needed it: its ARP requests got no reply.` : "Before sending anything off its subnet, the laptop needs its gateway's MAC address. Its gateway should appear here once it has talked to anything outside the LAN." };
      },
    },
    {
      id: "c-dns",
      syntax: "ipconfig /displaydns",
      summary: "The laptop's DNS cache",
      run: () => {
        const live = s.cache.filter((e) => e.expires > s.clock);
        if (!live.length) return { output: "Windows IP Configuration\n\n(the DNS resolver cache is empty)", explanation: "Nothing cached: the next lookup will send a query to the DNS server." };
        return { output: ["Windows IP Configuration", "", ...live.flatMap((e) => [`    ${e.name}`, "    ----------------------------------------", `    Record Name . . . . . : ${e.name}`, "    Record Type . . . . . : 1", `    Time To Live  . . . . : ${e.expires - s.clock}`, "    Section . . . . . . . : Answer", `    A (Host) Record . . . : ${e.ip}`, ""])].join("\n"), explanation: `Cached answers are used without asking the server until their TTL (${DNS_RECORD_TTL} s at the start) runs out. A changed record isn't seen until then: flush with ipconfig /flushdns (the lab's “flush DNS cache” button).` };
      },
    },
  ];
  return { vendor, deviceId: "CLIENT", deviceName: "CLIENT", prompt: "C:\\> ", commands: cmds };
}

const svcLine = (name: string, desc: string, up: boolean) => [`● ${name}.service - ${desc}`, `     Loaded: loaded (/lib/systemd/system/${name}.service; enabled)`, `     Active: ${up ? "active (running)" : "inactive (dead)"}`].join("\n");
const ssOut = (port: number, proc: string, up: boolean) => ["State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process", ...(up ? [`UNCONN  0       0       0.0.0.0:${port}            0.0.0.0:*          users:(("${proc}",pid=${port === 67 ? 812 : 903},fd=7))`] : [])].join("\n");

function dhcpSrv(s: DlState, vendor: CliVendor): CliCommandSet {
  const up = dhcpRunning(s.config);
  const failed = s.config.serverUp && !up ? dhcpProblem(s.config) : undefined;
  const cmds: CliCommand[] = [
    { id: "s-status", syntax: "systemctl status isc-dhcp-server", summary: "Is the DHCP service running?", run: () => ({ output: failed ? `${svcLine("isc-dhcp-server", "ISC DHCP IPv4 server", false).replace("inactive (dead)", "failed (Result: exit-code)")}\n     dhcpd: ${failed}\n     dhcpd: Configuration file errors encountered -- exiting` : svcLine("isc-dhcp-server", "ISC DHCP IPv4 server", up), explanation: up ? "The service is running." : failed ? "The service tried to start and exited: its configuration file has an error. Applying a configuration is not the same as the service running it." : "The service is not running (or was never configured). The host is up (it answers pings, its card receives packets), but nothing processes DHCP." }) },
    { id: "s-ss", syntax: "ss -ulnp", summary: "Which UDP ports have a listening program", run: () => ({ output: ssOut(67, "dhcpd", up), explanation: up ? "dhcpd listens on UDP 67: DHCP requests reaching this host are handled." : "Nothing listens on UDP 67. Requests that arrive are answered by the kernel with ICMP port unreachable." }) },
    { id: "s-leases", syntax: "dhcp-lease-list", summary: "The lease database", run: () => ({ output: ["MAC                IP              expires", ...s.net.leases.map((l) => `${pad(l.mac, 19)}${pad(l.ip, 16)}${l.state === "active" ? fmtT(l.ends) : "(released)"}`), s.config.scope ? `(${s.config.poolFree} addresses free in ${s.config.scope.start}-${s.config.scope.end})` : "(no range configured)"].join("\n"), explanation: s.config.poolFree <= 0 ? "No free addresses: the server can't offer anything to a new client, even though it receives its DISCOVER." : "Each active lease is an address given to a client. Free addresses are what new clients can get." }) },
    { id: "s-log", syntax: "journalctl -u isc-dhcp-server", summary: "The DHCP service's log", run: () => ({ output: s.net.logs["DHCP-SRV"].length ? s.net.logs["DHCP-SRV"].map((l) => `${fmtT(l.t)} dhcp-srv dhcpd[812]: ${l.text}`).join("\n") : up ? "-- No entries --" : `${fmtT(0)} dhcp-srv systemd[1]: isc-dhcp-server.service: Deactivated.`, explanation: "The server's own account of what it received and answered. “via 10.10.10.1” means the request came through the relay. No line for a client means the request never reached the service." }) },
    { id: "s-conf", syntax: "cat /etc/dhcp/dhcpd.conf", summary: "The scope configuration", run: () => ({ output: dhcpdConf(s.config), explanation: "option routers becomes the clients' default gateway (option 3) and option domain-name-servers their DNS server (option 6), in every future ACK. Clients that already have a lease keep the old values until they renew." }) },
  ];
  return { vendor, deviceId: "DHCP-SRV", deviceName: "DHCP-SRV", prompt: "admin@dhcp-srv:~$ ", commands: cmds };
}

function dnsSrv(s: DlState, vendor: CliVendor): CliCommandSet {
  const up = s.config.dnsUp;
  const nameArg = { name: { choices: Object.keys(s.records), resolve: (raw: string) => (/^[a-z0-9.-]+$/i.test(raw) ? raw.toLowerCase().replace(/\.$/, "") : undefined) } };
  const cmds: CliCommand[] = [
    { id: "d-status", syntax: "systemctl status named", summary: "Is the DNS service running?", run: () => ({ output: svcLine("named", "BIND Domain Name Server", up), explanation: up ? "The DNS service is running." : "The DNS service is stopped. The host still answers pings: “ping works” does not mean “DNS works”." }) },
    { id: "d-ss", syntax: "ss -ulnp", summary: "Which UDP ports have a listening program", run: () => ({ output: ssOut(53, "named", up), explanation: up ? "named listens on UDP 53." : "Nothing listens on UDP 53: queries are answered with ICMP port unreachable (clients report “connection refused”)." }) },
    { id: "d-log", syntax: "journalctl -u named", summary: "The DNS query log", run: () => ({ output: s.net.logs["DNS-SRV"].length ? s.net.logs["DNS-SRV"].map((l) => `${fmtT(l.t)} dns-srv named[903]: ${l.text}`).join("\n") : "-- No entries --", explanation: "Every query that reached the service, and its answer. If a client's lookups fail and there is no line for them here, the queries never arrived: look at where the client sends them." }) },
    { id: "d-dig", syntax: "dig @127.0.0.1 <name>", summary: "Ask the local DNS service directly (on the server itself)", args: nameArg, run: ({ name }) => {
      if (!up) return { output: `;; communications error to 127.0.0.1#53: connection refused`, explanation: "Even on the server itself, nothing answers: the service is down." };
      const a = s.records[name];
      return { output: [`;; ->>HEADER<<- opcode: QUERY, status: ${a ? "NOERROR" : "NXDOMAIN"}`, ";; QUESTION SECTION:", `;${name}.\t\tIN\tA`, ...(a ? ["", ";; ANSWER SECTION:", `${name}.\t${DNS_RECORD_TTL}\tIN\tA\t${a}`] : [])].join("\n"), explanation: "A local test proves the service and its zone work. If clients still fail, the problem is between them and the server (or in what they were told to use), not in DNS itself." };
    } },
    { id: "d-zone", syntax: "cat /etc/bind/db.packetverse.test", summary: "The zone's records", run: () => ({ output: zoneFile(s.records), explanation: "The authoritative records. A change here is only seen by clients once their cached copy expires." }) },
  ];
  return { vendor, deviceId: "DNS-SRV", deviceName: "DNS-SRV", prompt: "admin@dns-srv:~$ ", commands: cmds };
}

/** Command sets for one device, per vendor (hosts get the same shell for both). */
export function dlCliSets(s: DlState, node: DlNode): Partial<Record<CliVendor, CliCommandSet>> {
  const make = (v: CliVendor) => (node === "R1" ? r1(s, v) : node === "SW1" || node === "SW2" ? sw(s, node, v) : node === "CLIENT" ? client(s, v) : node === "DHCP-SRV" ? dhcpSrv(s, v) : node === "DNS-SRV" ? dnsSrv(s, v) : undefined);
  const c = make("cisco");
  const j = make("juniper");
  return { ...(c ? { cisco: c } : {}), ...(j ? { juniper: j } : {}) };
}
export { MACS as DL_MAC_NAMES };
