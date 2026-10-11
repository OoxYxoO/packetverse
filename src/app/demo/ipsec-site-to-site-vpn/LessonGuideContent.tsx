import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CHILD_SPIS, EXCHANGE, IKE_SPI_I, IKE_SPI_R, NOTIFY_TS_UNACCEPTABLE, VPN, spiText } from "@/lib/sim-engine/scenarios/ipsecVpn";
import { Lanes, VpnChain } from "./guideSvg";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_IP, createVpNet, vpApply, vpClone, vpTicket, vpTicketState, type VpGw, type VpNet } from "@/lib/sim-engine/scenarios/vpnNet";
import { vpGwSets, type VpCliApi } from "./vpn-lab/vpCli";

export const VPN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vpl-mission", label: "What this lesson teaches" },
  { id: "vpl-network", label: "The network of this lesson" },
  { id: "vpl-ideas", label: "Three ideas you need" },
  { id: "vpl-walk", label: "What you will watch" },
  { id: "vpl-problem", label: "The internet between the sites" },
  { id: "vpl-init", label: "IKE_SA_INIT: agreeing on keys" },
  { id: "vpl-auth", label: "IKE_AUTH: proving who you are" },
  { id: "vpl-child", label: "The CHILD SA: what to protect" },
  { id: "vpl-esp", label: "Encrypt, cross, decrypt" },
  { id: "vpl-return", label: "The reply's own SA" },
  { id: "vpl-verify", label: "What a healthy tunnel looks like" },
  { id: "vpl-incident", label: "The incident" },
  { id: "vpl-investigate", label: "Find the first layer that failed" },
  { id: "vpl-repair", label: "Repair and prove it" },
  { id: "vpl-other", label: "Other ways tunnels break" },
  { id: "vpl-model", label: "Mental model" },
  { id: "vpl-glossary", label: "Glossary" },
  { id: "vpl-recap", label: "Recap" },
  { id: "vpl-practice", label: "Practice it" },
];

const AB = spiText(CHILD_SPIS.first.ab);
const BA = spiText(CHILD_SPIS.first.ba);
const LANES = [
  { x: 110, label: "GW-A (initiator)", color: D.cyan },
  { x: 530, label: "GW-B (responder)", color: D.violet },
];

export function TopologyDiagram() {
  return (
    <DiagramSvg h={190} label="HOST-A in Site A behind GW-A 198.51.100.10, the Internet, GW-B 203.0.113.10 in front of HOST-B in Site B">
      <VpnChain subs={{ A: VPN.hostA, GA: VPN.gwaPub, NET: "untrusted", GB: VPN.gwbPub, B: VPN.hostB }} labels={{ al: "LAN", aw: "public", bw: "public", bl: "LAN" }} />
      <text x={320} y={40} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Goal: protect ${VPN.siteA} ↔ ${VPN.siteB} across the Internet`}
      </text>
    </DiagramSvg>
  );
}

export function InitDiagram() {
  return (
    <DiagramSvg h={150} label="IKE_SA_INIT: request with SA, KE and Ni, response with SA, KE and Nr, all in cleartext on UDP 500">
      <Lanes
        lanes={LANES}
        msgs={[
          { from: 0, to: 1, label: `IKE_SA_INIT (${EXCHANGE.IKE_SA_INIT}) · MsgID 0 · SA, KE, Ni`, sub: `SPIi ${IKE_SPI_I} · SPIr 0` },
          { from: 1, to: 0, label: `IKE_SA_INIT (${EXCHANGE.IKE_SA_INIT}) response · SA, KE, Nr`, sub: `SPIr ${IKE_SPI_R}`, color: D.violet },
        ]}
      />
      <text x={320} y={140} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        Cleartext on UDP/500 · shared keys afterwards · NOT authenticated yet
      </text>
    </DiagramSvg>
  );
}

export function DhDiagram() {
  return (
    <DiagramSvg h={222} label="Diffie-Hellman: each gateway keeps a private value and sends only a public value; both compute the same shared secret, which an observer cannot">
      <DNode x={110} y={44} label="GW-A" sub="private a (kept)" accent={D.cyan} w={150} />
      <DNode x={530} y={44} label="GW-B" sub="private b (kept)" accent={D.violet} w={150} />
      <DArrow x1={186} y1={36} x2={454} y2={36} color={D.cyan} label="public A (KE in request)" labelDy={-6} />
      <DArrow x1={454} y1={56} x2={186} y2={56} color={D.violet} label="public B (KE in response)" labelDy={18} />
      <DPill x={110} y={118} text="secret = f(a, B)" color={D.success} w={150} />
      <DPill x={530} y={118} text="secret = f(b, A)" color={D.success} w={150} />
      <text x={320} y={122} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        = same value
      </text>
      <DNode x={320} y={166} label="Observer" sub="sees A and B only" accent={D.danger} w={150} />
      <text x={320} y={212} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Secrecy against eavesdroppers — but no proof of who is on the other end.
      </text>
    </DiagramSvg>
  );
}

export function AuthDiagram() {
  return (
    <DiagramSvg h={184} label="IKE_AUTH: IDi, AUTH, SA, TSi, TSr inside the encrypted SK payload, and the response with IDr, AUTH, SA, TSi, TSr">
      <Lanes
        lanes={LANES}
        rowH={48}
        msgs={[
          { from: 0, to: 1, label: `IKE_AUTH (${EXCHANGE.IKE_AUTH}) · MsgID 1 · SK { IDi, AUTH, SA, TSi, TSr }`, sub: `SA offers GW-A's inbound SPI ${BA}`, boxed: true },
          { from: 1, to: 0, label: `IKE_AUTH response · SK { IDr, AUTH, SA, TSi, TSr }`, sub: `SA offers GW-B's inbound SPI ${AB}`, color: D.violet, boxed: true },
        ]}
      />
      <text x={320} y={160} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        Dashed box = the encrypted SK payload. Contents shown are a decrypted teaching view.
      </text>
      <text x={320} y={176} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        AUTH is a proof derived from the pre-shared key — the key is never sent.
      </text>
    </DiagramSvg>
  );
}

export function SasDiagram() {
  return (
    <DiagramSvg h={200} label="One IKE SA for control between the gateways, and a CHILD SA made of two one-way ESP SAs for user data">
      <DNode x={80} y={100} label="GW-A" accent={D.cyan} w={90} h={120} />
      <DNode x={560} y={100} label="GW-B" accent={D.violet} w={90} h={120} />
      <rect x={130} y={34} width={380} height={34} rx={17} fill={D.violet} fillOpacity={0.12} stroke={D.violet} />
      <text x={320} y={50} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        IKE SA · control · UDP/500
      </text>
      <text x={320} y={63} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
        {`${IKE_SPI_I} / ${IKE_SPI_R}`}
      </text>
      <text x={320} y={92} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        CHILD SA · data · ESP (protocol 50) = two one-way SAs
      </text>
      <DArrow x1={132} y1={112} x2={506} y2={112} color={D.success} label={`GW-A → GW-B · SPI ${AB} (GW-B chose it)`} labelDy={-6} />
      <DArrow x1={506} y1={142} x2={132} y2={142} color={D.tcp} label={`GW-B → GW-A · SPI ${BA} (GW-A chose it)`} labelDy={16} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        The first CHILD SA is created inside IKE_AUTH; later ones with CREATE_CHILD_SA.
      </text>
    </DiagramSvg>
  );
}

export function TsDiagram() {
  return (
    <DiagramSvg h={190} label="Traffic selectors TSi 10.10.10.0/24 and TSr 10.20.20.0/24 decide which inner traffic is protected">
      <rect x={30} y={30} width={200} height={70} rx={12} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} />
      <text x={130} y={58} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        TSi · Site A
      </text>
      <text x={130} y={78} textAnchor="middle" fill={D.cyan} fontSize={10} fontFamily="monospace">
        {VPN.siteA}
      </text>
      <rect x={410} y={30} width={200} height={70} rx={12} fill={D.violet} fillOpacity={0.08} stroke={D.violet} />
      <text x={510} y={58} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        TSr · Site B
      </text>
      <text x={510} y={78} textAnchor="middle" fill={D.violet} fontSize={10} fontFamily="monospace">
        {VPN.siteB}
      </text>
      <DArrow x1={236} y1={65} x2={404} y2={65} color={D.success} both label="protected by the CHILD SA" />
      <text x={40} y={130} fill={D.success} fontSize={10} fontFamily="monospace">
        ✓ 10.10.10.10 → 10.20.20.20 matches: encrypt
      </text>
      <text x={40} y={150} fill={D.muted} fontSize={10} fontFamily="monospace">
        · 10.10.10.10 → 192.0.2.50 not covered by this CHILD SA
      </text>
      <text x={40} y={174} fill={D.muted} fontSize={9.5}>
        Selectors describe INNER addresses. The gateways&apos; public addresses are never in them.
      </text>
    </DiagramSvg>
  );
}

export function EspDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={180} label="ESP tunnel mode packet: outer IPv4 between the gateways, ESP header with SPI and sequence, IV, the encrypted inner packet and trailer, and the ICV">
      <DFieldRow x={10} y={30} fields={[f("Outer IPv4", "GW-A→GW-B · p50", 128, D.ip, true), f("ESP", `SPI · seq 1`, 106, D.mpls, true), f("IV", "8 B", 44, D.faint), f("Inner IPv4", "HOST-A→HOST-B", 136, D.warning), f("ICMP", "Echo", 60, D.warning), f("Trailer", "NH 4", 60, D.warning), f("ICV", "16 B", 86, D.mpls)]} />
      <rect x={286} y={24} width={260} height={58} rx={6} fill="none" stroke={D.warning} strokeDasharray="5 4" />
      <text x={420} y={98} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        encrypted with AES-GCM (unreadable on the wire)
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.text} fontSize={10}>
        AES-GCM is AEAD: the ICV gives integrity. There is no separate HMAC transform.
      </text>
      <text x={320} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        Next Header 4 = the protected payload is a whole IPv4 packet (tunnel mode).
      </text>
      <text x={320} y={166} textAnchor="middle" fill={D.muted} fontSize={10}>
        No UDP around ESP here — UDP/4500 appears only with NAT traversal.
      </text>
    </DiagramSvg>
  );
}

export function HeadersDiagram() {
  return (
    <DiagramSvg h={200} label="On the LANs the plain inner packet 10.10.10.10 to 10.20.20.20 travels; across the Internet only the outer header between the gateways is visible">
      <VpnChain segs={{ al: "right", aw: "right", bw: "right", bl: "right" }} colors={{ al: D.cyan, aw: D.mpls, bw: D.mpls, bl: D.cyan }} labels={{ al: "plain", aw: "ESP", bw: "ESP", bl: "plain" }} />
      <text x={320} y={34} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        {`Inner (end to end): ${VPN.hostA} → ${VPN.hostB}`}
      </text>
      <text x={320} y={52} textAnchor="middle" fill={D.mpls} fontSize={10.5} fontWeight={700}>
        {`Outer (Internet only): ${VPN.gwaPub} → ${VPN.gwbPub} · protocol 50`}
      </text>
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        The Internet routes on the outer header and can&apos;t see the inner one.
      </text>
    </DiagramSvg>
  );
}

export function SpiSeqDiagram() {
  return (
    <DiagramSvg h={180} label="Directional SPIs and per-SA sequence numbers: A to B packets carry SPI A1B2C3D4 with sequence 1, 2, 3; replies carry SPI B1C2D3E4 with their own sequence">
      <Lanes
        lanes={LANES}
        rowH={26}
        msgs={[
          { from: 0, to: 1, label: `ESP SPI ${AB} · seq 1` },
          { from: 1, to: 0, label: `ESP SPI ${BA} · seq 1`, color: D.tcp },
          { from: 0, to: 1, label: `ESP SPI ${AB} · seq 2` },
          { from: 0, to: 1, label: `ESP SPI ${AB} · seq 3` },
        ]}
      />
      <text x={320} y={164} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Each SA counts its own packets. A receiver rejects a sequence number it has already accepted (anti-replay).
      </text>
    </DiagramSvg>
  );
}

export function ReturnDiagram() {
  return (
    <DiagramSvg h={190} label="Return traffic: HOST-B's reply is encrypted by GW-B with SPI B1C2D3E4, crosses the Internet as 203.0.113.10 to 198.51.100.10 and is decrypted by GW-A">
      <VpnChain segs={{ al: "left", aw: "left", bw: "left", bl: "left" }} colors={{ al: D.cyan, aw: D.tcp, bw: D.tcp, bl: D.cyan }} labels={{ al: "plain", aw: `SPI ${BA}`, bw: "ESP", bl: "plain" }} />
      <text x={320} y={40} textAnchor="middle" fill={D.tcp} fontSize={10.5} fontWeight={700}>
        {`Reply: inner ${VPN.hostB} → ${VPN.hostA} · outer ${VPN.gwbPub} → ${VPN.gwaPub}`}
      </text>
      <text x={320} y={58} textAnchor="middle" fill={D.muted} fontSize={10}>
        GW-B encrypts on the B→A SA · GW-A decrypts and forwards to HOST-A
      </text>
    </DiagramSvg>
  );
}

export function IncidentDiagram() {
  return (
    <DiagramSvg h={212} label="CREATE_CHILD_SA requests 10.10.10.0/24 to 10.20.20.0/24; GW-B's policy expects 10.10.20.0/24 and answers TS_UNACCEPTABLE; the IKE SA stays up">
      <Lanes
        lanes={LANES}
        rowH={48}
        msgs={[
          { from: 0, to: 1, label: `CREATE_CHILD_SA (${EXCHANGE.CREATE_CHILD_SA}) · MsgID 3 · SK { SA, Ni, TSi, TSr }`, sub: `TSi ${VPN.siteA} · TSr ${VPN.siteB}`, boxed: true },
          { from: 1, to: 0, label: `response · SK { Notify ${NOTIFY_TS_UNACCEPTABLE} TS_UNACCEPTABLE }`, color: D.danger, boxed: true },
        ]}
      />
      <DPill x={530} y={160} text={`GW-B remote: ${VPN.badSiteA}`} color={D.danger} w={190} />
      <DPill x={140} y={160} text="IKE SA: ESTABLISHED" color={D.success} w={170} />
      <DPill x={140} y={192} text="CHILD SA: none" color={D.danger} w={170} />
      <DPill x={530} y={192} text="HOST traffic: dropped at GW-A" color={D.danger} w={210} />
    </DiagramSvg>
  );
}

export function RepairDiagram() {
  return (
    <DiagramSvg h={226} label="After fixing GW-B's selector, CREATE_CHILD_SA succeeds with new SPIs and ESP flows again">
      <Lanes
        lanes={LANES}
        rowH={40}
        msgs={[
          { from: 0, to: 1, label: `CREATE_CHILD_SA · MsgID 4 · SPI ${spiText(CHILD_SPIS.repaired.ba)}`, boxed: true },
          { from: 1, to: 0, label: `response · SA SPI ${spiText(CHILD_SPIS.repaired.ab)}`, color: D.violet, boxed: true },
          { from: 0, to: 1, label: `ESP SPI ${spiText(CHILD_SPIS.repaired.ab)} · seq 1`, color: D.success },
          { from: 1, to: 0, label: `ESP SPI ${spiText(CHILD_SPIS.repaired.ba)} · seq 1`, color: D.tcp },
        ]}
      />
      <text x={320} y={218} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        Same IKE SA · new CHILD SA · sequence numbers start again at 1
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VPN Lab" onPractice={openLab}>
      Same sites and addresses, both gateways yours. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the VPN Lab prints. */
function lessonCli(s: VpNet, g: VpGw, vendor: CliVendor, command: string) {
  const api: VpCliApi = { view: s, act: () => s, ios: { "GW-A": { kind: "exec" }, "GW-B": { kind: "exec" } }, setIos: () => undefined, junosEdit: { "GW-A": false, "GW-B": false }, setJunosEdit: () => undefined, cand: vpClone(s.cfg.gw), setCand: () => undefined };
  return runGuideCli(vpGwSets(api, g)[vendor]!, command);
}
const HEALTHY = [{ type: "ike" } as const, { type: "traffic" as const, sends: [{ from: "HOST-A" as const, to: HOST_IP["HOST-B"] }] }].reduce((acc, a) => vpApply(acc, a), createVpNet());
const BROKEN = vpTicket("ts").repro.reduce((acc, a) => vpApply(acc, a), vpTicketState("ts", 1));

export function VpnLessonGuideContent() {
  const sa = /ident|pkts|current outbound/;
  const ok = lessonCli(HEALTHY, "GW-A", "cisco", "show crypto ipsec sa");
  const bad = lessonCli(BROKEN, "GW-A", "cisco", "show crypto ipsec sa");
  const log = lessonCli(BROKEN, "GW-A", "cisco", "show logging");
  return (
    <div className="space-y-12">
      <GuideSection id="vpl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          A company has two sites, with only the public internet between them. HOST-A in Site A must reach HOST-B in Site B as if the sites shared one private network, with nobody on the internet able to read or change the traffic. Each site&apos;s gateway, GW-A and GW-B, builds an <strong>IPsec</strong> tunnel to the other, and the hosts change nothing.
        </p>
        <p>You will watch IKEv2 agree keys and prove identities, a CHILD SA get installed, and HOST-A&apos;s ping cross the internet inside ESP, then come back on its own SA. Then Site A can&apos;t reach Site B although the peer shows up, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="cyan"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "say what IKE_SA_INIT and IKE_AUTH each achieve",
            "tell the IKE SA from the CHILD SA in this tunnel",
            "explain what a capture on the internet shows of HOST-A's ping",
            "say which SPI each direction uses, and who chose it",
            "find why no host packet passes while the IKE SA is up, fix it and prove ESP flows again",
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Private sites, public gateway addresses.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Two sites, two gateways"
          columns={["", "Site A", "Site B"]}
          rows={[
            ["Subnet", "10.10.10.0/24", "10.20.20.0/24"],
            ["Host", "HOST-A 10.10.10.10", "HOST-B 10.20.20.20"],
            ["Gateway (public address)", "GW-A 198.51.100.10", "GW-B 203.0.113.10"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The VPN Lab uses the same sites and addresses, adds WEB (192.0.2.80) on the internet to show split tunneling, and lets you configure the gateways as Cisco IOS (crypto map) or Junos (route-based, st0.0).</p>
      </GuideSection>

      <GuideSection id="vpl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "IKE builds the tunnel", body: "IKE_SA_INIT agrees keys in the clear; IKE_AUTH proves identities, encrypted, and creates the first CHILD SA.", tone: "violet" },
            { title: "The CHILD SA is two one-way SAs", body: "One per direction, each with an SPI chosen by its receiver, protecting 10.10.10.0/24 ↔ 10.20.20.0/24.", tone: "success" },
            { title: "ESP wraps each packet", body: "The whole original packet is encrypted inside ESP, with the gateways' public addresses outside.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "IKE_SA_INIT", body: "Algorithms and Diffie-Hellman in the clear: both gateways derive the same keys.", tone: "violet" },
            { title: "Authenticate", body: "Identities and AUTH inside the encrypted SK payload.", tone: "warning" },
            { title: "Build the CHILD SA", body: "Selectors agreed, two one-way ESP SAs installed.", tone: "success" },
            { title: "Encrypt and decrypt", body: "HOST-A's ping is wrapped in ESP at GW-A and unwrapped at GW-B.", tone: "mpls" },
            { title: "Return", body: "The reply goes back on the other one-way SA.", tone: "tcp" },
            { title: "The incident", body: "The peer shows up, but nothing passes. You find the cause and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on GW-A and GW-B, in the same order.</p>
      </GuideSection>

      <GuideSection id="vpl-problem" eyebrow="The problem" title="The internet between the sites" tone="danger">
        <p>HOST-A sends a packet to 10.20.20.20. Without a tunnel, GW-A sends it toward the internet, where no router has a route to a private network, and where anyone on the path could read it anyway. The tunnel must carry Site A ↔ Site B traffic between the two public addresses, 198.51.100.10 and 203.0.113.10, secret, unchanged and from the right peer.</p>
      </GuideSection>

      <GuideSection id="vpl-init" eyebrow="IKE_SA_INIT" title="IKE_SA_INIT: agreeing on keys" tone="violet">
        <p>GW-A, the initiator, sends its proposal (AES-GCM-256, DH group 19), its Diffie-Hellman public value and a nonce to its configured peer on UDP 500. GW-B picks the proposal it shares and answers with its own values. From the two public values each gateway computes the same secret, which never crosses the wire. Nobody is authenticated yet: this exchange gives keys, not trust.</p>
        <DiagramFrame caption="Message ID 0, in the clear.">
          <InitDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Public values cross the wire; the shared secret never does.">
          <DhDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-auth" eyebrow="IKE_AUTH" title="IKE_AUTH: proving who you are" tone="warning">
        <p>Now everything is encrypted inside the SK payload. Each gateway sends its identity and an AUTH value made with the pre-shared key, and checks the other&apos;s. Only now does GW-A know it is talking to GW-B. The IKE SA, the control channel, is established.</p>
        <DiagramFrame caption="Everything after the IKE header is ciphertext on the wire.">
          <AuthDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-child" eyebrow="CHILD SA" title="The CHILD SA: what to protect" tone="success">
        <p>In the same IKE_AUTH exchange GW-A proposes <strong>traffic selectors</strong>: its own side, 10.10.10.0/24 (TSi), and GW-B&apos;s side, 10.20.20.0/24 (TSr). GW-B accepts only if they fit its own policy, the mirror image: local 10.20.20.0/24, remote 10.10.10.0/24. Then two one-way ESP SAs are installed. Keep that in mind: the mirror is the key to the incident.</p>
        <DiagramFrame caption="TSi describes the initiator's side, TSr the responder's.">
          <TsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Control SA on top, a pair of one-way data SAs below.">
          <SasDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-esp" eyebrow="ESP" title="Encrypt, cross the internet, decrypt" tone="mpls">
        <p>HOST-A&apos;s ping reaches GW-A, which matches it against the selectors and wraps the whole original packet in ESP: encrypted and authenticated, behind a new outer header from 198.51.100.10 to 203.0.113.10 (IP protocol 50), with GW-B&apos;s SPI and a sequence number. The internet routes only the outer header. GW-B decrypts and forwards the original packet to HOST-B.</p>
        <DiagramFrame caption="Two IPv4 headers: the internet routes the outer one; only GW-B sees the inner one.">
          <HeadersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-return" eyebrow="Return" title="The reply's own SA" tone="tcp">
        <p>HOST-B&apos;s reply takes the other one-way SA: GW-B encrypts it with the SPI that GW-A chose for its inbound direction, and GW-A decrypts it. Each SPI is chosen by its receiver, and each SA counts its own sequence numbers.</p>
        <DiagramFrame caption="The receiver chooses the SPI; each SA counts on its own.">
          <SpiSeqDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-verify" eyebrow="Verification" title="What a healthy tunnel looks like on the gateways" tone="success">
        <p>Check the layers in the order they are built:</p>
        <FieldTable
          title="Read the lesson on the gateway"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Is the IKE SA up?", <Mono key="1">show crypto ikev2 sa</Mono>, <Mono key="2">show security ike security-associations</Mono>, "Keys agreed, peer authenticated"],
            ["Is a CHILD SA installed, and used?", <Mono key="3">show crypto ipsec sa</Mono>, <Mono key="4">show security ipsec security-associations</Mono>, "The right subnets, both SPIs, counters moving"],
            ["Why did something fail?", <Mono key="5">show logging</Mono>, <Mono key="6">show log messages</Mono>, "The negotiation result, by name"],
          ]}
        />
        <p>On a healthy GW-A the CHILD SA protects 10.10.10.0/24 ↔ 10.20.20.0/24, has an outbound SPI, and the encaps and decaps counters moved with the ping:</p>
        <CliPanel run={{ ...ok, output: pickLines(ok.output, sa) }} caption="GW-A · Cisco IOS · healthy" />
        <p className="text-sm text-pv-text-muted">The lab negotiates its own SPI values; every negotiation picks new ones. And traffic confirms it: HOST-A&apos;s ping comes back, and a capture on the internet shows only ESP between the two public addresses.</p>
      </GuideSection>

      <GuideSection id="vpl-incident" eyebrow="Incident" title="The incident: the peer is up, nothing passes" tone="danger">
        <p>Monitoring says the VPN peer is up, but Site A can&apos;t reach a single host in Site B. GW-B&apos;s configuration was edited during a migration.</p>
        <DiagramFrame caption="The IKE SA is up, but the CHILD SA's selectors don't match.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["GW-B's remote subnet was changed to 10.10.20.0/24", "GW-A still proposes 10.10.10.0/24, which no longer fits GW-B's policy", "GW-B refuses the CHILD SA (TS_UNACCEPTABLE): no ESP SAs, nothing passes"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["The peer address or the internet: the IKE SA is up", "The pre-shared key: IKE_AUTH succeeded", "A proposal mismatch: that fails at the very first message"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-investigate" eyebrow="Investigation" title="Find the first layer that failed" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does IKE_SA_INIT get an answer, with a common proposal?", look: "Yes: the IKE SA is up." },
            { question: "Does IKE_AUTH succeed?", look: "Yes: the peer is authenticated." },
            { question: "Is a CHILD SA installed?", look: "show crypto ipsec sa on GW-A: no SPI, counters at zero; the log names TS_UNACCEPTABLE." },
          ]}
        />
        <CliPanel run={{ ...bad, output: pickLines(bad.output, sa) }} caption="GW-A · Cisco IOS · during the incident" />
        <CliPanel run={log} caption="GW-A · Cisco IOS · the reason" />
      </GuideSection>

      <GuideSection id="vpl-repair" eyebrow="Repair" title="Repair, and prove ESP flows again" tone="success">
        <CompareCards
          items={[
            { title: "Junos · GW-B", tone: "violet", tag: "the mirror again", points: ["set security ipsec vpn site-vpn traffic-selector ts1 remote-ip 10.10.10.0/24", "commit"] },
            { title: "Cisco IOS · GW-B", tone: "cyan", tag: "the mirror again", points: ["ip access-list extended VPN-TRAFFIC", "permit ip 10.20.20.0 0.0.0.255 10.10.10.0 0.0.0.255", "(in the lab the new permit replaces the single entry; on a real router also remove the old line)"] },
          ]}
        />
        <DiagramFrame caption="Selectors mirrored: a new CHILD SA is installed and ESP flows.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show crypto ipsec sa: an SPI in each direction, for 10.10.10.0/24 ↔ 10.20.20.0/24",
            "A fresh ping from HOST-A to HOST-B comes back",
            "Encaps and decaps climb on both gateways",
            "The new CHILD SA has new SPIs, and its sequence numbers start at 1",
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-other" eyebrow="Troubleshooting" title="Other ways tunnels break" tone="warning">
        <p>Mismatched selectors are one layer that can fail. The lab&apos;s tickets add four more, each stopping at a different layer. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "Wrong peer address", tone: "danger", tag: "no answer", points: ["IKE_SA_INIT retransmitted, never answered", "Check the peer address in both directions"] },
            { title: "No common proposal", tone: "warning", tag: "first message refused", points: ["NO_PROPOSAL_CHOSEN", "Compare the IKE proposals"] },
            { title: "Different pre-shared keys", tone: "violet", tag: "IKE starts, then stops", points: ["AUTHENTICATION_FAILED", "Compare the key on both gateways"] },
            { title: "Traffic not steered in", tone: "ip", tag: "SAs up, counters at 0", points: ["The packet leaves in the clear", "Crypto map on the WAN · route via st0.0"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-model" eyebrow="Mental model" title="A diplomatic pouch" tone="violet">
        <p>IKE is the two embassies agreeing a lock and checking each other&apos;s credentials by phone. The CHILD SA is the pair of pouches, one for each direction, each with a number the receiving embassy assigned. ESP puts the original letter, sealed, inside the pouch, with the embassies&apos; addresses on the outside. Traffic selectors are the rule about which letters go in the pouch at all: change that rule on one side, and the phone line still works while no letters get sent.</p>
      </GuideSection>

      <GuideSection id="vpl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "IKE SA", def: "The control-plane SA protecting IKE messages between the gateways." },
            { term: "CHILD SA", def: "A pair of one-way ESP SAs protecting user traffic." },
            { term: "SPI", def: "Security Parameter Index: chosen by the receiver to find the SA's keys." },
            { term: "TSi / TSr", def: "Traffic selectors: which inner addresses the CHILD SA protects." },
            { term: "ESP", def: "IP protocol 50: carries the encrypted original packet." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="Site-to-site IPsec in this lesson" mark="→" items={["IKE_SA_INIT agrees keys; IKE_AUTH proves identity and creates the first CHILD SA", "The CHILD SA protects 10.10.10.0/24 ↔ 10.20.20.0/24, one SA per direction", "On the internet only ESP between 198.51.100.10 and 203.0.113.10 is visible", "Each SPI is chosen by its receiver", "The IKE SA can be up while no host packet passes: look at the CHILD SA"]} />
      </GuideSection>

      <GuideSection id="vpl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each layer of the tunnel should show and how to prove it. The VPN Lab gives you both gateways, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one exchange at a time, plus getting traffic into the tunnel.", tone: "violet" },
            { title: "Challenges", body: "Find both SPIs on the wire, read an IKE_AUTH exchange, prove split tunneling, survive a peer outage.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>See IKE_SA_INIT, IKE_AUTH, the CHILD SA and ESP with its SPIs in the VPN presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the IKEv2 header, authentication methods, ESP and anti-replay, steering, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
