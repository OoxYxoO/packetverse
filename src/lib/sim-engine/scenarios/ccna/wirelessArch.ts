import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Wireless Architectures & WLCs (CCNA 2.6–2.9). HQ: lightweight AP1 in local mode, an access switch, a core switch,
 * a WLC on a two-member port-channel trunk. A branch: BR-AP in FlexConnect mode behind a WAN.
 *
 * Modeled:
 * - AP join: DHCP in the AP management VLAN with option 43 (the WLC's address) → CAPWAP discovery and join (UDP 5246,
 *   DTLS) → configuration download (WLANs, each mapped to a VLAN on the controller).
 * - Data path by AP mode: local mode tunnels every client frame inside CAPWAP data (UDP 5247) to the WLC, which
 *   bridges it into the WLAN's VLAN on its own trunk. FlexConnect switches it locally onto the AP's switch port
 *   (an 802.1Q trunk), so branch traffic never crosses the WAN to HQ.
 * - Trunk allowed lists: a tagged frame leaves a trunk only if its VLAN is allowed; otherwise it is dropped there.
 */

export interface WlanCfg {
  ssid: string;
  vlan: number;
  security: string;
  qos: string;
}
export interface WarchState extends KitBase {
  apJoined: boolean;
  apIp?: string;
  wlans: WlanCfg[];
  /** VLANs allowed on CORE's Po1 trunk toward the WLC. */
  po1Allowed: number[];
  /** Addresses clients ended up with. */
  clients: Record<string, string>;
}
export const ADDR = { wlc: "10.30.0.10", apMgmtVlan: 30, ap: "10.30.0.21", brAp: "10.130.0.21", dhcp: "10.99.0.5" } as const;
export const SUBNET: Record<number, string> = { 10: "10.10.10", 50: "10.50.0", 20: "10.120.20" };
export function createWarchState(): WarchState {
  return { ...kitBase(), apJoined: false, wlans: [], po1Allowed: [10, 30], clients: {} };
}
export const wlanFor = (s: WarchState, ssid: string) => s.wlans.find((w) => w.ssid === ssid);
export const allowed = (s: WarchState, vlan: number) => s.po1Allowed.includes(vlan);

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
const C = { eth: "#94a3b8", ip: "#60a5fa", udp: "#34d399", capwap: "#f472b6", w: "#a78bfa", tag: "#facc15" };
const capwapCtl = (id: string, from: string, to: string, what: string): PacketVisual =>
  packet(id, "IP", from, to, "CAPWAP control", `CAPWAP ${what} · ${ADDR.ap} → ${ADDR.wlc}:5246`, [
    layer("IPv4 Header", C.ip, [["Source IP", ADDR.ap], ["Destination IP", ADDR.wlc]]),
    layer("UDP", C.udp, [["Destination Port", "5246 (CAPWAP control)"]]),
    layer("DTLS", C.capwap, [["Protection", "encrypted, certificates on AP and WLC"]]),
    layer("CAPWAP", C.capwap, [["Message", what]]),
  ]);
const capwapData = (id: string, from: string, to: string, client: string, clientIp: string, dst: string, ssid: string): PacketVisual =>
  packet(id, "IP", from, to, "CAPWAP data", `CAPWAP data (${ssid}) · ${client} → ${dst}`, [
    layer("Outer IPv4", C.ip, [["Source IP", ADDR.ap], ["Destination IP", ADDR.wlc]]),
    layer("Outer UDP", C.udp, [["Destination Port", "5247 (CAPWAP data)"]]),
    layer("CAPWAP header", C.capwap, [["WLAN", ssid], ["Radio", "5 GHz"]]),
    layer("Inner 802.11 frame", C.w, [["Source", client], ["Destination", "ff:ff:ff:ff:ff:ff"], ["Payload", clientIp === "0.0.0.0" ? "DHCP Discover" : `IP ${clientIp} → ${dst}`]]),
  ]);
const tagged = (id: string, from: string, to: string, vlan: number, what: string): PacketVisual =>
  packet(id, "ETHERNET", from, to, `802.1Q ${vlan}`, `Ethernet · VLAN ${vlan} · ${what}`, [layer("Ethernet II", C.eth, [["Destination MAC", "ff:ff:ff:ff:ff:ff"]]), layer("802.1Q Tag", C.tag, [["VLAN ID", String(vlan)]]), layer("Payload", C.ip, [["Content", what]])], true);

export const ST = {
  ap: [{ id: "dhcp", label: "DHCP in the AP VLAN (option 43 → WLC)" }, { id: "join", label: "CAPWAP discover + join (UDP 5246, DTLS)" }, { id: "config", label: "Download WLANs from the WLC" }, { id: "data", label: "Client frames: tunnel (local) or switch (FlexConnect)" }],
  wlc: [{ id: "join", label: "Authenticate AP, accept join" }, { id: "push", label: "Push WLANs, RF settings" }, { id: "decap", label: "Decapsulate CAPWAP data" }, { id: "bridge", label: "Bridge into the WLAN's VLAN (tag on uplink)" }],
  sw: [{ id: "rx", label: "Receive" }, { id: "vlan", label: "VLAN from tag / access port" }, { id: "allowed", label: "VLAN allowed on the egress trunk?" }, { id: "fwd", label: "Forward" }],
  client: [{ id: "assoc", label: "Associate to the SSID" }, { id: "dhcp", label: "DHCP" }],
} satisfies Record<string, ProcessingStage[]>;

export const WARCH_REPAIR_OPTIONS = [
  { id: "allow50", label: "Allow VLAN 50 on CORE's Po1 trunk to the WLC" },
  { id: "flex", label: "Put AP1 in FlexConnect mode" },
  { id: "open", label: "Change GUEST to an open SSID" },
  { id: "reboot", label: "Reboot the WLC" },
];
export const WARCH_REPAIR_CORRECT = "allow50";

type Step = ScenarioStep<WarchState>;
const GUEST: WlanCfg = { ssid: "GUEST", vlan: 50, security: "WPA3-Personal (SAE)", qos: "Bronze" };
const CORP: WlanCfg = { ssid: "CORP", vlan: 10, security: "WPA2/WPA3-Enterprise (802.1X)", qos: "Silver" };

/** A client on `ssid` at HQ asks for an address: AP1 → CAPWAP → WLC → tagged onto Po1 → CORE → DHCP server, if allowed. */
function hqClientDhcp(id: string, client: string, ssid: string): (s: WarchState) => WarchState {
  return (s) => {
    const w = wlanFor(s, ssid)!;
    const ok = allowed(s, w.vlan);
    const p = tagged(`${id}-tag`, "WLC", "CORE", w.vlan, `DHCP Discover from ${client} (${ssid})`);
    const n = acted(s, hop({ stepId: id, device: "CORE", stages: withDetail(ST.sw, { rx: "Po1 from the WLC", vlan: `VLAN ${w.vlan}`, allowed: `Po1 allowed: ${s.po1Allowed.join(",")} → ${ok ? "yes" : "no — dropped"}`, fwd: ok ? `VLAN ${w.vlan} → DHCP relay` : "—" }), activeStageId: ok ? "fwd" : "allowed", ingressInterfaceId: "Po1", egressInterfaceId: ok ? "Vlan" + w.vlan : undefined, lookupType: "Trunk allowed VLANs", lookupKey: `VLAN ${w.vlan}`, lookupResult: ok ? "allowed" : "not allowed", action: ok ? "FORWARD" : "DROP (VLAN not allowed)", reason: "A trunk carries only the VLANs on its allowed list; any other tagged frame is discarded on arrival.", input: p.summary, output: ok ? `relayed to ${ADDR.dhcp}` : "dropped", before: stackOf(p) }), p, ok ? `VLAN ${w.vlan} → DHCP` : `VLAN ${w.vlan} dropped on Po1`);
    return { ...n, clients: { ...n.clients, [client]: ok ? `${SUBNET[w.vlan]}.101` : "169.254.x.x (no DHCP)" } };
  };
}

export const warchSteps: Step[] = [
  say("intro", "Hundreds of APs, one brain", "A campus can have hundreds of access points. Configuring each one by hand doesn't scale, so enterprise APs are usually lightweight: they boot knowing almost nothing and get everything from a wireless LAN controller."),
  say("architectures", "Three ways to run Wi-Fi", "Autonomous APs are configured one by one. Lightweight APs are managed by a WLC (on-premises or embedded in a switch). Cloud-managed APs are configured from a vendor's cloud dashboard, with user traffic staying local.", {
    question: q("A retail chain has 400 small stores, no IT staff on site and no controllers. Which architecture fits best?", [["cloud", "Cloud-managed APs"], ["auto", "Autonomous APs configured in each store"], ["wlc", "A WLC in every store"]], "cloud", "Cloud management gives one dashboard for every site with no controller hardware to deploy; clients' traffic stays in the store. Autonomous APs would mean 400 separate configurations; a WLC per store is costly hardware to run."),
  }),
  act("ap-dhcp", "AP1 boots and finds its controller", `AP1 gets an address in AP management VLAN ${ADDR.apMgmtVlan} by DHCP. Option 43 in the offer carries the WLC's address, ${ADDR.wlc}. (DNS — CISCO-CAPWAP-CONTROLLER.<domain> — and a broadcast on the local subnet are the other ways to find it.)`, (s) => {
    const p = packet("ap-dhcp", "IP", "AP1", "ACC", "DHCP", `DHCP Offer → AP1 · ${ADDR.ap} · option 43 ${ADDR.wlc}`, [layer("DHCP", C.udp, [["Your IP", ADDR.ap], ["Option 43 (vendor)", `WLC ${ADDR.wlc}`], ["Router", "10.30.0.1"]])]);
    return acted({ ...s, apIp: ADDR.ap }, hop({ stepId: "ap-dhcp", device: "AP1", stages: withDetail(ST.ap, { dhcp: `${ADDR.ap} · option 43 → ${ADDR.wlc}` }), activeStageId: "dhcp", ingressInterfaceId: "Gi0", lookupType: "DHCP option 43", lookupKey: "WLC address", lookupResult: ADDR.wlc, action: "ADDRESS + WLC", reason: "A lightweight AP's first job is to find a controller. It is an ordinary DHCP client in an access VLAN.", input: "boot", output: p.summary, before: stackOf(p) }), p, `WLC = ${ADDR.wlc}`);
  }, "PACKET_RECEIVED"),
  act("capwap-join", "CAPWAP join", "AP1 sends a CAPWAP discovery and join request to UDP 5246. AP and WLC authenticate each other with certificates and protect the control channel with DTLS. The WLC accepts the join.", (s) => {
    const p = capwapCtl("join", "AP1", "WLC", "Join Request");
    return acted({ ...s, apJoined: true }, hop({ stepId: "capwap-join", device: "WLC", stages: withDetail(ST.wlc, { join: "AP1 certificate valid · DTLS up" }), activeStageId: "join", ingressInterfaceId: "Po1", lookupType: "AP join", lookupKey: "AP1", lookupResult: "joined", action: "JOIN", reason: "CAPWAP (RFC 5415) is the control and data tunnel between lightweight APs and their controller.", input: p.summary, output: "Join Response · success", nextHopId: "AP1", before: stackOf(p) }), p, "AP1 joined");
  }, "PACKET_SENT"),
  act("config", "The WLC configures the AP", `The WLC pushes its WLANs: CORP (${CORP.security}) mapped to VLAN ${CORP.vlan}, QoS profile ${CORP.qos}, plus channels and power from radio resource management. AP1 starts beaconing CORP.`, (s) => {
    const p = capwapCtl("cfg", "WLC", "AP1", "Configuration Update (WLAN CORP)");
    return acted({ ...s, wlans: [CORP] }, hop({ stepId: "config", device: "WLC", stages: withDetail(ST.wlc, { push: `WLAN CORP → VLAN ${CORP.vlan} · ${CORP.security} · QoS ${CORP.qos}` }), activeStageId: "push", egressInterfaceId: "Po1", lookupType: "WLAN table", lookupKey: "AP group default", lookupResult: "CORP", action: "CONFIGURE", reason: "A WLAN binds an SSID to security, a QoS profile and the VLAN (controller interface) its clients belong to.", input: "joined AP", output: p.summary, nextHopId: "AP1", before: stackOf(p) }), p, "WLAN CORP pushed");
  }, "PACKET_SENT"),
  say("predict-client", "Predict: where a client's frame meets the wire", "LAPTOP is about to associate to CORP on AP1, which runs in local mode, and send a DHCP Discover. CORP is mapped to VLAN 10 on the WLC.", {
    question: q("In local mode, where does the laptop's traffic first enter VLAN 10?", [["wlc", "At the WLC, which bridges it onto its trunk tagged VLAN 10"], ["ap", "At AP1's switch port"], ["acc", "At the access switch"]], "wlc", "AP1's switch port carries only the AP's management VLAN 30 and the CAPWAP tunnel. The WLC decapsulates the frame and puts it into the WLAN's VLAN on its own uplink."),
  }),
  act("client", "A client's frame rides the tunnel", "LAPTOP associates to CORP on AP1 and sends a DHCP Discover. AP1 is in local mode — open the packet to see exactly what it puts on its cable.", (s) => {
    const p = capwapData("cw-corp", "AP1", "WLC", "LAPTOP", "0.0.0.0", "broadcast", "CORP");
    return acted(s, hop({ stepId: "client", device: "AP1", stages: withDetail(ST.ap, { data: "local mode → CAPWAP data to the WLC" }), activeStageId: "data", ingressInterfaceId: "radio1", egressInterfaceId: "Gi0", lookupType: "AP mode", lookupKey: "local", lookupResult: "tunnel to WLC", action: "ENCAPSULATE", reason: "In local mode every client frame is tunnelled to the controller, which is where it meets the wired VLAN.", input: "DHCP Discover from LAPTOP", output: p.summary, nextHopId: "WLC", before: stackOf(p), mutations: [{ type: "ENCAPSULATE", detail: "802.11 frame → CAPWAP/UDP 5247/IP" }] }), p, "tunnelled to the WLC");
  }, "PACKET_SENT"),
  act("wlc-bridges", "The WLC bridges it into VLAN 10", "The WLC removes the CAPWAP and 802.11 headers and sends the client's frame out its port-channel Po1 to CORE, tagged VLAN 10. CORE relays the DHCP request; LAPTOP gets an address in 10.10.10.0/24.", hqClientDhcp("wlc-bridges", "LAPTOP", "CORP"), "PACKET_SENT"),
  say("flexconnect", "FlexConnect at the branch", "BR-AP, at a branch across the WAN, joins the same WLC — but in FlexConnect mode. Its WLAN traffic is switched locally onto its own switch port, an 802.1Q trunk on BR-SW, instead of being tunnelled to HQ.", {
    question: q("Why use FlexConnect at a branch rather than local mode?", [["wan", "Branch traffic stays local and keeps working if the WAN to the WLC fails"], ["faster", "FlexConnect radios transmit faster"], ["security", "It encrypts better"]], "wan", "Local mode would hairpin every branch frame over the WAN to HQ and back. FlexConnect switches it at the branch and keeps serving clients if the controller is unreachable."),
  }),
  say("ap-modes", "Other AP modes", "Besides local and FlexConnect: monitor (scans for rogues and interference, serves no clients), sniffer (captures frames to an analyzer), bridge/mesh (wireless backhaul between APs), and SE-Connect (spectrum analysis). The mode is set on the controller."),
  say("management", "Managing it all", "Admins reach the WLC by console, SSH or HTTPS, authenticated against TACACS+ or RADIUS rather than local accounts. Cloud-managed APs are run from the vendor dashboard over HTTPS. Telnet and HTTP should be off."),
  // incident
  act("fault-injected", "A new guest network", `Marketing wants guest Wi-Fi. On the WLC an engineer creates WLAN GUEST (${GUEST.security}, QoS ${GUEST.qos}) mapped to a new interface in VLAN ${GUEST.vlan}, and the DHCP team adds a scope for 10.50.0.0/24. AP1 starts beaconing GUEST.`, (s) => ({ ...s, wlans: [CORP, GUEST], faultActive: true, packet: undefined, flood: [], decision: { device: "WLC", text: "WLAN GUEST → VLAN 50" } }), "STEP_ENTERED"),
  act("inc-guest", "Guests connect — and get nothing", "A visitor's phone joins GUEST: the password works and it associates. Then it sits at 'obtaining IP address' and gives up with a 169.254 address. CORP users are fine.", (s) => {
    const t = capwapData("cw-guest", "AP1", "WLC", "GUEST-PHONE", "0.0.0.0", "broadcast", "GUEST");
    const n = hqClientDhcp("inc-guest", "GUEST-PHONE", "GUEST")(s);
    return { ...n, hops: [...n.hops.slice(0, -1), hop({ stepId: "inc-guest", device: "WLC", stages: withDetail(ST.wlc, { decap: "CAPWAP data from AP1 (GUEST)", bridge: `VLAN ${GUEST.vlan} → Po1` }), activeStageId: "bridge", egressInterfaceId: "Po1", lookupType: "WLAN → interface", lookupKey: "GUEST", lookupResult: `VLAN ${GUEST.vlan}`, action: "BRIDGE", reason: "The controller puts each WLAN's clients into its mapped VLAN on the uplink.", input: t.summary, output: `tagged VLAN ${GUEST.vlan} on Po1`, before: stackOf(t) }), n.hops[n.hops.length - 1]] };
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "GUEST clients associate and authenticate. The WLC shows them in VLAN 50. The DHCP server never sees a single Discover from 10.50.0.0/24.", {
    question: q("What is the most likely cause?", [["trunk", "VLAN 50 isn't allowed on the trunk between CORE and the WLC, so tagged guest frames are dropped"], ["scope", "The DHCP scope is wrong"], ["psk", "Guests are using the wrong password"], ["ap", "AP1 can't support two SSIDs"]], "trunk", "Association and authentication worked, so the radio side is fine; the DHCP server sees nothing, so the frames die before reaching it. In local mode guest frames leave the WLC tagged VLAN 50 — and CORE's Po1 only allows 10 and 30. Every new WLAN VLAN must be added to the controller's trunk.", ["Did association work?", "Where does a local-mode client frame first enter its VLAN?", "Which links must carry VLAN 50?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Follow the frame: radio and association, CAPWAP tunnel to the WLC, WLAN-to-VLAN mapping, the WLC's trunk, then DHCP."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", WARCH_REPAIR_CORRECT, (s) => ({ ...s, po1Allowed: [10, 30, 50], decision: { device: "CORE", text: "Po1 allowed VLANs 10,30,50" } })),
  act("verify", "Guests get addresses", `The visitor's phone retries: the WLC tags its Discover VLAN ${GUEST.vlan}, Po1 now allows it, CORE relays it, and the phone gets 10.50.0.101.`, hqClientDhcp("verify", "GUEST-PHONE", "GUEST"), "PACKET_RECEIVED"),
  say("complete", "Wireless architectures", "Autonomous, controller-based and cloud-managed Wi-Fi; APs that find their WLC by DHCP option 43 and join over CAPWAP; local mode tunnelling to the controller, FlexConnect switching at the branch — and every WLAN's VLAN carried on the trunk that serves it."),
];
