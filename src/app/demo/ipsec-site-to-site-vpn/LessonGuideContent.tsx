import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CHILD_SPIS, EXCHANGE, IKE_SPI_I, IKE_SPI_R, NOTIFY_TS_UNACCEPTABLE, VPN, spiText } from "@/lib/sim-engine/scenarios/ipsecVpn";
import { Lanes, VpnChain } from "./guideSvg";

export const VPN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vpl-mission", label: "The mission" },
  { id: "vpl-topology", label: "Topology" },
  { id: "vpl-init", label: "IKE_SA_INIT" },
  { id: "vpl-dh", label: "Diffie-Hellman" },
  { id: "vpl-auth", label: "IKE_AUTH & SK" },
  { id: "vpl-sas", label: "IKE SA vs CHILD SA" },
  { id: "vpl-ts", label: "Traffic selectors" },
  { id: "vpl-esp", label: "ESP tunnel mode" },
  { id: "vpl-headers", label: "Inner vs outer" },
  { id: "vpl-spi", label: "SPIs & sequence numbers" },
  { id: "vpl-return", label: "Return traffic" },
  { id: "vpl-incident", label: "Selector mismatch" },
  { id: "vpl-repair", label: "Repair & verify" },
  { id: "vpl-model", label: "Mental model" },
  { id: "vpl-glossary", label: "Glossary" },
];

const AB = spiText(CHILD_SPIS.first.ab);
const BA = spiText(CHILD_SPIS.first.ba);
const LANES = [
  { x: 110, label: "GW-A (initiator)", color: D.cyan },
  { x: 530, label: "GW-B (responder)", color: D.violet },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={190} label="HOST-A in Site A behind GW-A 198.51.100.10, the Internet, GW-B 203.0.113.10 in front of HOST-B in Site B">
      <VpnChain subs={{ A: VPN.hostA, GA: VPN.gwaPub, NET: "untrusted", GB: VPN.gwbPub, B: VPN.hostB }} labels={{ al: "LAN", aw: "public", bw: "public", bl: "LAN" }} />
      <text x={320} y={40} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Goal: protect ${VPN.siteA} ↔ ${VPN.siteB} across the Internet`}
      </text>
    </DiagramSvg>
  );
}

function InitDiagram() {
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

function DhDiagram() {
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

function AuthDiagram() {
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

function SasDiagram() {
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

function TsDiagram() {
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

function EspDiagram() {
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

function HeadersDiagram() {
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

function SpiSeqDiagram() {
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

function ReturnDiagram() {
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

function IncidentDiagram() {
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

function RepairDiagram() {
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

export function VpnLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vpl-mission" eyebrow="Mission" title="A private path over a public network" tone="cyan">
        <p>Two sites, one Internet in between. IKEv2 lets the gateways agree keys and prove who they are (control plane); ESP then carries each host packet encrypted inside a new outer header (data plane). The hosts never notice.</p>
        <FlowSteps
          steps={[
            { title: "IKE_SA_INIT", body: "Algorithms + Diffie-Hellman + nonces. Keys, not trust.", tone: "violet" },
            { title: "IKE_AUTH", body: "Identities + AUTH, encrypted. First CHILD SA.", tone: "warning" },
            { title: "ESP", body: "Host packets encrypted in tunnel mode, one SA per direction.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpl-topology" eyebrow="Topology" title="Two sites, two gateways" tone="cyan">
        <DiagramFrame caption="Private sites, public gateway addresses.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-init" eyebrow="Exchange 34" title="IKE_SA_INIT" tone="violet">
        <DiagramFrame caption="Message ID 0, in the clear.">
          <InitDiagram />
        </DiagramFrame>
        <p>No NAT sits between these gateways, so the main flow needs no NAT-detection payloads and stays on UDP/500.</p>
      </GuideSection>

      <GuideSection id="vpl-dh" eyebrow="Keys" title="Diffie-Hellman in one picture" tone="success">
        <DiagramFrame caption="Public values cross the wire; the shared secret never does.">
          <DhDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-auth" eyebrow="Exchange 35" title="IKE_AUTH inside SK" tone="warning">
        <DiagramFrame caption="Everything after the IKE header is ciphertext on the wire.">
          <AuthDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Teaching view, not wire view">
          The lesson&apos;s inspector labels these payloads &quot;decrypted teaching view&quot;. An observer sees only the IKE header and an encrypted SK payload.
        </Callout>
      </GuideSection>

      <GuideSection id="vpl-sas" eyebrow="Security associations" title="IKE SA vs CHILD SA" tone="success">
        <DiagramFrame caption="Control SA on top, a pair of one-way data SAs below.">
          <SasDiagram />
        </DiagramFrame>
        <p>The IKE SA is not &quot;the tunnel&quot;. Host packets travel in ESP under a CHILD SA, which IKE creates, rekeys and deletes.</p>
      </GuideSection>

      <GuideSection id="vpl-ts" eyebrow="Selectors" title="Which traffic is protected" tone="ip">
        <DiagramFrame caption="TSi describes the initiator's side, TSr the responder's.">
          <TsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-esp" eyebrow="ESP" title="Tunnel mode, byte by byte" tone="mpls">
        <DiagramFrame caption="IP protocol 50, AES-GCM, Next Header 4.">
          <EspDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-headers" eyebrow="Headers" title="Inner vs outer" tone="ip">
        <DiagramFrame caption="Two IPv4 headers, two different jobs.">
          <HeadersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-spi" eyebrow="Direction" title="Directional SPIs and sequence numbers" tone="violet">
        <DiagramFrame caption="The receiver chooses the SPI; each SA counts on its own.">
          <SpiSeqDiagram />
        </DiagramFrame>
        <p>
          Packets to GW-B carry <Mono>{AB}</Mono>; packets to GW-A carry <Mono>{BA}</Mono>. Sequence numbers let the receiver reject replays. They do not encrypt anything.
        </p>
      </GuideSection>

      <GuideSection id="vpl-return" eyebrow="Return" title="The reply's own path" tone="tcp">
        <DiagramFrame caption="Encrypt at GW-B, decrypt at GW-A.">
          <ReturnDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpl-incident" eyebrow="Incident" title="IKE up, CHILD SA refused" tone="danger">
        <DiagramFrame caption="TS_UNACCEPTABLE travels inside the encrypted IKE exchange.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>After the CHILD SA was deleted, GW-A asked for a new one for 10.10.10.0/24 ↔ 10.20.20.0/24. GW-B&apos;s policy had been edited to 10.10.20.0/24 on the Site-A side, so it refused with Notify 38. The peer was reachable and authenticated all along — only the data SAs were missing.</p>
      </GuideSection>

      <GuideSection id="vpl-repair" eyebrow="Repair" title="Fix the selector, then verify" tone="success">
        <DiagramFrame caption="A new CHILD SA under the same IKE SA.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["GW-B remote selector 10.10.10.0/24", "CREATE_CHILD_SA accepted; new SPIs installed in both directions", "ESP sequence restarts at 1 on the new SAs", "HOST-A ↔ HOST-B ping succeeds through ESP"]} />
        <p>Changing the peer address or identities, raising TTL, or bypassing IPsec would not make the selectors match — the last one would simply send the traffic unprotected.</p>
      </GuideSection>

      <GuideSection id="vpl-model" eyebrow="Mental model" title="A diplomatic pouch" tone="violet">
        <p>IKE is the two embassies agreeing a lock and checking each other&apos;s credentials by phone. The CHILD SA is the pair of pouches, one for each direction, each with a number the receiving embassy assigned. ESP puts the original letter — sealed — inside the pouch, with the embassies&apos; addresses on the outside. Traffic selectors are the rule about which letters go in the pouch at all: change that rule on one side, and the phone line still works while no letters get sent.</p>
      </GuideSection>

      <GuideSection id="vpl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "IKE SA", def: "The control-plane SA protecting IKE messages between the gateways." },
            { term: "CHILD SA", def: "A pair of one-way ESP (or AH) SAs protecting user traffic." },
            { term: "SPI", def: "Security Parameter Index — chosen by the receiver to find the SA's keys." },
            { term: "SK payload", def: "The encrypted and integrity-protected container for IKE payloads after IKE_SA_INIT." },
            { term: "TSi / TSr", def: "Traffic selectors: which inner addresses/protocols/ports the CHILD SA protects." },
            { term: "TS_UNACCEPTABLE", def: "Notify 38: the responder's policy cannot accept the requested selectors." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
