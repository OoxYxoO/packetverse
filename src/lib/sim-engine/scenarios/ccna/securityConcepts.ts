import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Security Concepts & Threats (CCNA 5.1, 5.2). A small company: a firewall with IPS, a public web server, a VPN
 * gateway, an access switch with users — and attackers outside and, later, inside.
 *
 * Modeled (computed, not stated):
 * - Reconnaissance: a port scan's rate (ports / seconds) against the IPS threshold.
 * - SYN flood: time to fill a server's half-open backlog = backlog / SYN rate, and why spoofed sources defeat address
 *   blocking (number of distinct sources).
 * - Phishing yield: users × click rate × submit rate = expected stolen credentials, before and after training.
 * - Authentication: a stolen password alone logs in unless the account requires a second factor.
 * - Physical/edge access: a device on a live access port gets an address; an administratively down port gives no link.
 */

export interface SecState extends KitBase {
  mfa: boolean;
  /** Meeting-room jack Gi1/0/30: live in the user VLAN, or shut down. */
  jackLive: boolean;
  rogue: boolean;
  alerts: string[];
  stolen: number;
}
export function createSecState(): SecState {
  return { ...kitBase(), mfa: false, jackLive: true, rogue: false, alerts: [], stolen: 0 };
}
export const SCAN = { ports: 1024, seconds: 2, ipsThreshold: 100 };
export const scanRate = () => SCAN.ports / SCAN.seconds;
export const FLOOD = { synPerSec: 50_000, backlog: 1024, distinctSources: 48_211 };
export const backlogFillMs = () => (FLOOD.backlog / FLOOD.synPerSec) * 1000;
export const PHISH = { users: 400, clickBefore: 0.18, clickAfter: 0.04, submit: 0.5 };
export const phishYield = (click: number) => Math.round(PHISH.users * click * PHISH.submit);

const C = { ip: "#60a5fa", tcp: "#34d399", app: "#f472b6", warn: "#fb7185" };
export const ST = {
  fw: [{ id: "rx", label: "Receive from the internet" }, { id: "ips", label: "IPS: compare with signatures and rates" }, { id: "policy", label: "Policy: permit or deny" }, { id: "log", label: "Alert and log" }],
  srv: [{ id: "rx", label: "Receive SYN" }, { id: "backlog", label: "Half-open backlog" }, { id: "serve", label: "Serve users" }],
  vpn: [{ id: "rx", label: "Login request" }, { id: "pw", label: "Password check" }, { id: "mfa", label: "Second factor (if required)" }, { id: "session", label: "VPN session" }],
  sw: [{ id: "link", label: "Port link state" }, { id: "vlan", label: "Access VLAN" }, { id: "fwd", label: "Forward" }],
  user: [{ id: "mail", label: "Read e-mail" }, { id: "click", label: "Click / type credentials?" }],
} satisfies Record<string, ProcessingStage[]>;

export const SEC_REPAIR_OPTIONS = [
  { id: "ports", label: "Shut down unused wall ports (and enforce badge-only access to meeting rooms)" },
  { id: "mac", label: "Block the rogue laptop's MAC address" },
  { id: "wifi", label: "Change the Wi-Fi password" },
  { id: "av", label: "Update antivirus signatures on the servers" },
];
export const SEC_REPAIR_CORRECT = "ports";

type Step = ScenarioStep<SecState>;
const synPkt = (id: string, src: string): PacketVisual => packet(id, "TCP", "ATTACKER", "FW", "TCP SYN", `TCP SYN · ${src} → 203.0.113.80:443`, [layer("IPv4 Header", C.ip, [["Source IP", src], ["Destination IP", "203.0.113.80"]]), layer("TCP Header", C.tcp, [["Flags", "SYN"], ["Destination Port", "443"]])]);

function vpnLogin(id: string): (s: SecState) => SecState {
  return (s) => {
    const ok = !s.mfa;
    const p = packet(`${id}-p`, "HTTPS", "ATTACKER", "VPN", "TLS", "VPN login · user jdoe · stolen password", [layer("TLS", C.app, [["SNI", "vpn.example.com"], ["Credentials", "jdoe / (phished password)"], ["Second factor", s.mfa ? "push sent to jdoe's phone — denied" : "not required"]])]);
    const n = acted(s, hop({ stepId: id, device: "VPN", stages: withDetail(ST.vpn, { pw: "password correct (stolen)", mfa: s.mfa ? "push to the real user's phone → denied" : "not required", session: ok ? "attacker connected" : "—" }), activeStageId: s.mfa ? "mfa" : "session", ingressInterfaceId: "outside", lookupType: "Authentication", lookupKey: "jdoe", lookupResult: ok ? "password only → allowed" : "password ✓ · MFA ✕ → denied", action: ok ? "LOGIN" : "DENY", reason: s.mfa ? "A second factor is something the attacker doesn't have — the stolen password alone is useless." : "With only a password, whoever knows it is the user.", input: p.summary, output: ok ? "attacker inside the network" : "login denied", nextHopId: ok ? "ATTACKER" : undefined, before: stackOf(p) }), p, ok ? "attacker logged in" : "MFA denied");
    return { ...n, alerts: [...n.alerts, ok ? "VPN login jdoe from an unusual country" : "MFA push denied for jdoe"] };
  };
}

export const secSteps: Step[] = [
  say("intro", "The words of security", "An asset is what you protect. A vulnerability is a weakness in it. A threat is someone or something that could use the weakness; an exploit is the actual technique. Mitigation reduces the chance or the impact.", {
    question: q("The VPN gateway runs firmware with a published, unpatched flaw. What is that flaw?", [["vuln", "A vulnerability"], ["threat", "A threat"], ["exploit", "An exploit"], ["mitig", "A mitigation"]], "vuln", "The flaw is a weakness — a vulnerability. Criminals scanning for it are the threat; the code that uses it is the exploit; patching is the mitigation."),
  }),
  act("recon", "Reconnaissance: a port scan", `An attacker scans the company's public address: ${SCAN.ports} TCP ports in ${SCAN.seconds} seconds. The firewall's IPS counts ${scanRate()} new connections per second from one source — far above its ${SCAN.ipsThreshold}/s threshold.`, (s) => {
    const p = synPkt("scan", "198.51.100.66");
    const n = acted(s, hop({ stepId: "recon", device: "FW", stages: withDetail(ST.fw, { ips: `${scanRate()} SYN/s to different ports > ${SCAN.ipsThreshold}/s → scan`, policy: "only 443 permitted to the web server", log: "alert: TCP port sweep" }), activeStageId: "ips", ingressInterfaceId: "outside", lookupType: "IPS", lookupKey: "198.51.100.66", lookupResult: `${scanRate()} ports/s — scan`, action: "ALERT + BLOCK SOURCE", reason: "Reconnaissance comes first: attackers map what's open before they attack it. Rate-based detection catches noisy scans.", input: p.summary, output: "source blocked for 1 hour", before: stackOf(p) }), p, "port scan detected");
    return { ...n, alerts: [...n.alerts, `IPS: port sweep from 198.51.100.66 (${scanRate()}/s)`] };
  }, "PACKET_DROPPED"),
  say("predict-dos", "Predict: a SYN flood", `Next comes a flood: ${FLOOD.synPerSec.toLocaleString()} SYNs per second at the web server, from ${FLOOD.distinctSources.toLocaleString()} different source addresses.`, {
    question: q("Why can't the firewall simply block the attacking address, as it did with the scanner?", [["spoof", "The source addresses are spoofed and change constantly — there's no single address to block"], ["https", "The traffic is encrypted"], ["port", "It uses port 443, which must stay open"], ["fast", "The firewall is too slow to block anything"]], "spoof", "Each SYN carries a forged source. Blocking addresses is whack-a-mole; defences are SYN cookies, rate limits and upstream scrubbing by the ISP or a DDoS service."),
  }),
  act("dos", "Denial of service", `The server keeps a backlog of ${FLOOD.backlog} half-open connections. At ${FLOOD.synPerSec.toLocaleString()} SYN/s it fills in ${backlogFillMs()} ms; real customers' SYNs find no room and time out.`, (s) => {
    const p = synPkt("flood", "random (spoofed)");
    const n = acted(s, hop({ stepId: "dos", device: "WEB", stages: withDetail(ST.srv, { backlog: `${FLOOD.backlog} / ${FLOOD.synPerSec.toLocaleString()} per s = full in ${backlogFillMs()} ms`, serve: "legitimate SYNs dropped" }), activeStageId: "backlog", ingressInterfaceId: "eth0", lookupType: "Backlog", lookupKey: "half-open", lookupResult: `full after ${backlogFillMs()} ms`, action: "OVERLOADED", reason: "A DoS exhausts a resource — here, the half-open table; a DDoS does it from thousands of machines at once.", input: p.summary, output: "customers refused" }), p, `backlog full in ${backlogFillMs()} ms`);
    return { ...n, alerts: [...n.alerts, "WEB: SYN backlog full"] };
  }, "PACKET_DROPPED"),
  say("mitm", "Man-in-the-middle and spoofing", "Other attacks sit between victims: a rogue Wi-Fi access point, or ARP spoofing that convinces hosts the attacker is their gateway. Encryption (TLS, IPsec, WPA3) and switch features (DHCP snooping, dynamic ARP inspection — see Layer 2 Security) defeat them."),
  act("phish", "Phishing", `A convincing e-mail asks staff to ‘re-validate’ their VPN password on a lookalike site. Of ${PHISH.users} users, ${PHISH.clickBefore * 100}% click and half of those type their password: about ${phishYield(PHISH.clickBefore)} stolen credentials. One belongs to jdoe.`, (s) => {
    const p = packet("mail", "HTTPS", "ATTACKER", "USER", "E-mail", "Phishing e-mail · 'VPN password expires today'", [layer("Message", C.warn, [["From", "it-support@examp1e.com (lookalike)"], ["Link", "https://vpn-examp1e.com/login"], ["Hook", "urgency + authority"]])]);
    const n = acted({ ...s, stolen: phishYield(PHISH.clickBefore) }, hop({ stepId: "phish", device: "USER", stages: withDetail(ST.user, { click: `${PHISH.users} × ${PHISH.clickBefore} × ${PHISH.submit} ≈ ${phishYield(PHISH.clickBefore)} passwords` }), activeStageId: "click", lookupType: "Social engineering", lookupKey: "phishing", lookupResult: `${phishYield(PHISH.clickBefore)} credentials`, action: "CREDENTIALS STOLEN", reason: "Social engineering attacks people, not packets. No firewall rule sees a password typed into the wrong website.", input: p.summary, output: "jdoe's password stolen", before: stackOf(p) }), p, `${phishYield(PHISH.clickBefore)} passwords phished`);
    return n;
  }, "PACKET_SENT"),
  act("vpn-stolen", "The attacker logs in", "The attacker uses jdoe's real password on the real VPN gateway.", vpnLogin("vpn-stolen"), "PACKET_SENT", q("What single control would have stopped this login?", [["mfa", "Multi-factor authentication on the VPN"], ["complex", "A more complex password"], ["fw", "A firewall rule for port 443"], ["av", "Antivirus on jdoe's laptop"]], "mfa", "The attacker has the correct password, however complex. A second factor (an app push, a token) is something they don't have.")),
  act("mfa", "MFA on the VPN", "The VPN now requires a second factor. When the attacker tries jdoe's password again, a push goes to jdoe's phone — and jdoe denies it, then reports it.", (s) => vpnLogin("mfa")({ ...s, mfa: true }), "PACKET_DROPPED"),
  say("program", "A security program, not just devices", `Technology is one layer. User awareness and training (phishing drills cut this company's click rate from ${PHISH.clickBefore * 100}% to ${PHISH.clickAfter * 100}% — about ${phishYield(PHISH.clickAfter)} passwords instead of ${phishYield(PHISH.clickBefore)}), and physical access control (badges, locked wiring closets, escorted visitors) are the others.`),
  // incident
  act("fault-injected", "A visitor", "A visitor follows an employee through a badge door without badging (tailgating) and settles into an empty meeting room. Its wall jack is patched to ACC-SW Gi1/0/30, live in the user VLAN.", (s) => ({ ...s, rogue: true, faultActive: true, packet: undefined, flood: [], decision: { device: "ACC-SW", text: "Gi1/0/30 link up" } }), "STEP_ENTERED"),
  act("inc-scan", "An internal scan", "The visitor's laptop gets a DHCP address and starts sweeping the internal subnets. The firewall never sees it — the traffic stays inside. An internal sensor raises an alert.", (s) => {
    const p = packet("iscan", "TCP", "ROGUE", "ACC-SW", "TCP SYN", "TCP SYN · 10.1.1.199 → 10.1.0.0/16 (sweep)", [layer("IPv4 Header", C.ip, [["Source IP", "10.1.1.199 (DHCP lease)"], ["Destination", "every host, ports 22/445/3389"]])]);
    const n = acted(s, hop({ stepId: "inc-scan", device: "ACC-SW", stages: withDetail(ST.sw, { link: s.jackLive ? "Gi1/0/30 up" : "Gi1/0/30 administratively down", vlan: "user VLAN 10", fwd: "forwarded inside" }), activeStageId: "fwd", ingressInterfaceId: "Gi1/0/30", lookupType: "Access port", lookupKey: "Gi1/0/30", lookupResult: "live · VLAN 10", action: "FORWARD", reason: "An unused but live access port is an open door for anyone who can reach it physically.", input: "rogue laptop", output: p.summary, before: stackOf(p) }), p, "internal sweep from Gi1/0/30");
    return { ...n, alerts: [...n.alerts, "Internal sensor: sweep from 10.1.1.199 on ACC-SW Gi1/0/30"] };
  }, "PACKET_SENT"),
  say("trouble-question", "Diagnose", "The firewall, VPN and servers are patched and saw nothing. The scanning laptop belongs to no employee.", {
    question: q("Which controls failed and let this happen?", [["phys", "Physical access control (tailgating) and an unused wall port left live"], ["fw", "The firewall's internet policy"], ["mfa", "MFA on the VPN"], ["av", "Server antivirus"]], "phys", "The attacker never crossed the firewall or the VPN: they walked in and plugged into a live port. Badge discipline and disabling unused ports close that path; MFA and the firewall protect other doors.", ["Did the traffic cross the firewall?", "How did the laptop get onto the network?", "Which two layers of the program does this test?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Layer the defences: physical access, the access port, network admission, internal monitoring, then the systems themselves."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", SEC_REPAIR_CORRECT, (s) => ({ ...s, jackLive: false, decision: { device: "ACC-SW", text: "interface range of unused ports · shutdown" } })),
  act("verify", "The door is closed", "Gi1/0/30 and every other unused port are shut down (and placed in an unused VLAN); reception now escorts visitors. Plugging in again gets no link at all.", (s) => {
    const n = acted(s, hop({ stepId: "verify", device: "ACC-SW", stages: withDetail(ST.sw, { link: "Gi1/0/30 administratively down" }), activeStageId: "link", ingressInterfaceId: "Gi1/0/30", lookupType: "Access port", lookupKey: "Gi1/0/30", lookupResult: "shutdown", action: "NO LINK", reason: "Defence in depth: physical control, then disabled ports, then (next lessons) port security and 802.1X.", input: "rogue laptop plugged in", output: "no link" }), undefined, "no link on Gi1/0/30");
    return { ...n, rogue: false };
  }, "PACKET_DROPPED"),
  say("complete", "Security concepts", "Assets, vulnerabilities, threats, exploits and mitigations; reconnaissance, DoS, spoofing, man-in-the-middle and social engineering; MFA against stolen passwords — and a program of awareness, training and physical control around the technology."),
];
