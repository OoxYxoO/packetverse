import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Device Management: SSH, TFTP & FTP (CCNA 4.8, 4.9). An admin workstation manages SW1 and SW2; a TFTP/FTP server
 * holds configuration backups.
 *
 * Modeled:
 * - Whether a remote session is accepted: SSH needs a hostname, a domain name, an RSA key (≥ 768 bits for SSH v2) and
 *   "ssh" in the VTY lines' transport input; Telnet needs "telnet" there. Otherwise the TCP SYN is answered with a RST
 *   (connection refused). With login local, the username/password is checked against local users.
 * - What a capture shows: Telnet carries keystrokes — including the password — in clear text; SSH carries only
 *   encrypted records.
 * - TFTP transfers in 512-byte blocks over UDP 69 with no authentication: blocks = ⌈size / 512⌉; FTP uses TCP 21 for
 *   control (with a login) and a separate data connection.
 */

export interface MgmtCfg {
  hostname: string;
  domain?: string;
  rsaBits?: number;
  vtyTransport: ("ssh" | "telnet")[];
  loginLocal: boolean;
  users: Record<string, string>;
}
export interface MgmtState extends KitBase {
  dev: Record<"SW1" | "SW2", MgmtCfg>;
  sessions: string[];
  backups: string[];
}
export const ADDR = { admin: "10.99.0.50", sw1: "10.99.0.11", sw2: "10.99.0.12", tftp: "10.99.0.5" };
const base = (h: string): MgmtCfg => ({ hostname: h, vtyTransport: ["telnet"], loginLocal: true, users: { netadmin: "S3cure!pass" } });
export function createMgmtState(): MgmtState {
  return { ...kitBase(), dev: { SW1: base("SW1"), SW2: { ...base("SW2"), domain: "corp.example", rsaBits: 2048, vtyTransport: ["ssh"] } }, sessions: [], backups: [] };
}
export function sshStatus(c: MgmtCfg): { enabled: boolean; version?: string; why: string } {
  if (c.hostname === "Switch" || !c.domain) return { enabled: false, why: "no hostname/domain — key can't be generated" };
  if (!c.rsaBits) return { enabled: false, why: "no RSA key" };
  return { enabled: true, version: c.rsaBits >= 768 ? "2.0" : "1.99 (key < 768 bits: v1 only)", why: `RSA ${c.rsaBits}-bit key` };
}
export function connect(c: MgmtCfg, proto: "ssh" | "telnet", user: string, pass: string): { ok: boolean; result: string } {
  if (proto === "ssh" && !sshStatus(c).enabled) return { ok: false, result: "TCP 22 refused (SSH not enabled)" };
  if (!c.vtyTransport.includes(proto)) return { ok: false, result: `TCP ${proto === "ssh" ? 22 : 23} refused (transport input ${c.vtyTransport.join(" ")})` };
  if (c.loginLocal && c.users[user] !== pass) return { ok: false, result: "authentication failed" };
  return { ok: true, result: `${proto.toUpperCase()} session as ${user}` };
}
export const tftpBlocks = (bytes: number) => ({ blocks: Math.floor(bytes / 512) + 1, last: bytes % 512 });

// ---------------------------------------------------------------------------------------------------------------
const C = { ip: "#60a5fa", tcp: "#34d399", app: "#f472b6", danger: "#fb7185" };
const tcpPkt = (id: string, from: string, to: string, dst: string, port: number, payload: [string, string][], badge: string): PacketVisual =>
  packet(id, "TCP", from, to, badge, `${badge} · ${ADDR.admin} → ${dst}:${port}`, [layer("IPv4 Header", C.ip, [["Source IP", ADDR.admin], ["Destination IP", dst]]), layer("TCP Header", C.tcp, [["Destination Port", String(port)]]), layer("Payload", port === 23 ? C.danger : C.app, payload)]);
export const ST = {
  sw: [{ id: "rx", label: "TCP SYN to the management address" }, { id: "vty", label: "VTY: protocol allowed by transport input?" }, { id: "crypto", label: "SSH: RSA key + version" }, { id: "auth", label: "login local: check username/password" }, { id: "session", label: "Session (exec prompt)" }],
  srv: [{ id: "rx", label: "Receive" }, { id: "store", label: "Store file" }],
  pc: [{ id: "tx", label: "Admin client" }],
} satisfies Record<string, ProcessingStage[]>;

export const MGMT_REPAIR_OPTIONS = [
  { id: "transport", label: "Set SW1's VTY lines to transport input ssh" },
  { id: "rsa", label: "Generate a new RSA key on SW1" },
  { id: "telnet", label: "Use Telnet instead and update the security policy" },
  { id: "user", label: "Create another local user" },
];
export const MGMT_REPAIR_CORRECT = "transport";

type Step = ScenarioStep<MgmtState>;
function login(id: string, d: "SW1" | "SW2", proto: "ssh" | "telnet"): (s: MgmtState) => MgmtState {
  return (s) => {
    const c = s.dev[d];
    const r = connect(c, proto, "netadmin", "S3cure!pass");
    const port = proto === "ssh" ? 22 : 23;
    const dst = d === "SW1" ? ADDR.sw1 : ADDR.sw2;
    const p = tcpPkt(`${id}-p`, "ADMIN", d, dst, port, proto === "telnet" ? [["Keystrokes (clear text)", "Username: netadmin"], ["Then", "Password: S3cure!pass"]] : [["SSH-2.0 record", "encrypted (aes256-ctr, hmac-sha2-256)"], ["Contents", "unreadable without the session keys"]], proto === "telnet" ? "Telnet" : "SSH");
    const st = sshStatus(c);
    const n = acted(s, hop({ stepId: id, device: d, stages: withDetail(ST.sw, { vty: `transport input ${c.vtyTransport.join(" ")} → ${c.vtyTransport.includes(proto) ? "allowed" : "refused"}`, crypto: proto === "ssh" ? (st.enabled ? `SSH ${st.version} · ${st.why}` : st.why) : "—", auth: r.ok ? "netadmin ✓" : "—", session: r.ok ? `${d}#` : "—" }), activeStageId: r.ok ? "session" : proto === "ssh" && !st.enabled ? "crypto" : "vty", ingressInterfaceId: "Vlan99", lookupType: "VTY access", lookupKey: `${proto} TCP ${port}`, lookupResult: r.result, action: r.ok ? "SESSION" : "REFUSED", reason: proto === "telnet" ? "Telnet works — and sends every keystroke, password included, in clear text." : "SSH encrypts the whole session, after authenticating the device with its key.", input: p.summary, output: r.result, nextHopId: r.ok ? "ADMIN" : undefined, before: stackOf(p) }), p, r.result);
    return { ...n, sessions: [...n.sessions, `${proto} → ${d}: ${r.result}`] };
  };
}

export const mgmtSteps: Step[] = [
  say("intro", "Managing a device you can't touch", "The first configuration is done on the console cable. After that, every change happens over the network — and the management session carries the most valuable thing on it: an administrator's password."),
  say("predict-telnet", "Predict: a Telnet session", "SW1 still has its factory-style setup: VTY lines accept Telnet, login local.", {
    question: q("Someone captures the traffic between the admin PC and SW1 during a Telnet login. What can they read?", [["all", "Everything — the username, the password and every command"], ["cmds", "Only the commands, not the password"], ["none", "Nothing — Telnet is encrypted"], ["user", "Only the username"]], "all", "Telnet (TCP 23) sends each keystroke as plain data. A capture shows the password exactly as typed."),
  }),
  act("telnet", "Telnet: readable by anyone on the path", "The admin telnets to SW1. Open the packet: the password is right there.", login("telnet", "SW1", "telnet"), "PACKET_SENT"),
  say("ssh-prereq", "What SSH needs", "SSH needs the device to have an identity and a key: a hostname other than the default, a domain name, and an RSA key pair — at least 768 bits for SSH version 2 (2048 is normal). The VTY lines must allow ssh, and login local checks usernames.", {
    question: q("Why does the router need a hostname and a domain name before it can generate its RSA key?", [["name", "The key pair is named hostname.domain"], ["dns", "SSH needs DNS to work"], ["cert", "A certificate authority requires them"]], "name", "IOS labels the key pair with the device's fully qualified name. With the default hostname or no domain, crypto key generate rsa refuses."),
  }),
  act("ssh-config", "Turning SSH on", "On SW1: hostname is set, ip domain name corp.example, crypto key generate rsa modulus 2048, ip ssh version 2, and line vty 0 15 · transport input ssh · login local. show ip ssh reports SSH enabled, version 2.0.", (s) => ({ ...s, dev: { ...s.dev, SW1: { ...s.dev.SW1, domain: "corp.example", rsaBits: 2048, vtyTransport: ["ssh"] } }, packet: undefined, flood: [], decision: { device: "SW1", text: `SSH ${sshStatus({ ...s.dev.SW1, domain: "corp.example", rsaBits: 2048 }).version}` } }), "STEP_ENTERED"),
  act("ssh-login", "An encrypted session", "The admin connects with SSH to TCP 22. SW1 proves its identity with its key, the session is encrypted, then netadmin logs in against the local user database. A capture shows only ciphertext.", login("ssh-login", "SW1", "ssh"), "PACKET_SENT"),
  act("tftp", "Back up the configuration", `The admin copies SW1's running configuration (6,840 bytes) to the TFTP server ${ADDR.tftp}. TFTP uses UDP 69, sends 512-byte blocks, each acknowledged, and asks for no username at all.`, (s) => {
    const b = tftpBlocks(6840);
    const p = packet("tftp", "IP", "SW1", "TFTP", "TFTP", `TFTP · ${ADDR.sw1} → ${ADDR.tftp}:69 · write SW1-confg`, [layer("UDP", C.tcp, [["Destination Port", "69 (then a random port)"]]), layer("TFTP", C.app, [["Opcode", "2 (write request)"], ["File", "SW1-confg"], ["Blocks", `${b.blocks} (${b.blocks - 1} × 512 + ${b.last} bytes)`], ["Authentication", "none"]])]);
    const n = acted(s, hop({ stepId: "tftp", device: "TFTP", stages: withDetail(ST.srv, { store: `SW1-confg · ${b.blocks} blocks` }), activeStageId: "store", ingressInterfaceId: "eth0", lookupType: "TFTP", lookupKey: "SW1-confg", lookupResult: `${b.blocks} blocks, last ${b.last} bytes`, action: "STORED", reason: "A block shorter than 512 bytes ends the transfer. Simple and fast — and anyone who can reach the server can read or overwrite files.", input: p.summary, output: "transfer complete", before: stackOf(p) }), p, `${b.blocks} blocks`);
    return { ...n, backups: [...n.backups, `SW1-confg (6,840 B, TFTP, ${b.blocks} blocks)`] };
  }, "PACKET_SENT"),
  say("ftp-scp", "TFTP, FTP or SCP?", "FTP (TCP 21 control, plus a data connection) adds a username and password — sent in clear text. SCP and SFTP run inside SSH and encrypt everything.", {
    question: q("Which is the best choice for copying configurations that contain password hashes and SNMP keys?", [["scp", "SCP or SFTP"], ["tftp", "TFTP"], ["ftp", "FTP"], ["telnet", "Copy and paste over Telnet"]], "scp", "Only SCP/SFTP protect the file in transit and authenticate the user. TFTP has no authentication; FTP's credentials and data are clear text."),
  }),
  // incident
  act("fault-injected", "SW1 is replaced", "SW1's hardware fails and the replacement is staged from an old template: hostname, domain, RSA key, users — and the template's VTY section.", (s) => ({ ...s, dev: { ...s.dev, SW1: { ...s.dev.SW1, vtyTransport: ["telnet"] } }, faultActive: true, packet: undefined, flood: [], decision: { device: "SW1", text: "template applied" } }), "STEP_ENTERED"),
  act("inc-refused", "SSH is refused", "The admin's SSH client says ‘connection refused’ the instant it connects. SSH to SW2 works fine.", login("inc-refused", "SW1", "ssh"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "On SW1's console: show ip ssh says SSH Enabled — version 2.0. The admin can ping SW1. Telnet to SW1 succeeds.", {
    question: q("What is the most likely cause?", [["transport", "SW1's VTY lines only allow Telnet (transport input telnet)"], ["rsa", "SW1 has no RSA key"], ["acl", "An ACL blocks the admin PC"], ["pass", "The password is wrong"]], "transport", "SSH is enabled, so the key and version are fine; ping and Telnet work, so reachability and VTY access are fine — for Telnet. A refused SSH with Telnet accepted points to the lines' transport input. A wrong password would fail after the connection, not refuse it.", ["Is SSH itself enabled?", "Which protocols do the VTY lines accept?", "Refused immediately, or rejected at login?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up for remote access: reachability, SSH enabled (key, version), VTY transport input, access-class, then login."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", MGMT_REPAIR_CORRECT, (s) => ({ ...s, dev: { ...s.dev, SW1: { ...s.dev.SW1, vtyTransport: ["ssh"] } }, decision: { device: "SW1", text: "line vty 0 15 · transport input ssh" } })),
  act("verify", "SSH works — Telnet doesn't", "The admin's SSH session to SW1 opens, encrypted. A Telnet attempt is now refused, which is exactly what the security policy wants.", (s) => login("verify", "SW1", "ssh")(login("verify", "SW1", "telnet")(s)), "PACKET_RECEIVED"),
  say("complete", "Device management", "Console first, then SSH — with a hostname, a domain, an RSA key of 2048 bits, ip ssh version 2, transport input ssh and login local. TFTP and FTP move files simply but in the clear; SCP and SFTP protect them."),
];
