import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";
import { FLOW, INITIAL_TTL, PA, PA_MAC, PA_TIMES as T, REQ_LEN, RESP_LEN, RTO_US, SERVICE_PORT, secs } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { bracket, CAP_PTS, createPaNet, DROP_EVERY, frameLabel, outcomeText, paApply, paTicket, paTicketState, type PaAction, type PaD, type PaState, type PaTicketId } from "@/lib/sim-engine/scenarios/paNet";
import { paSets, paStaticApi } from "./pa-lab/paCli";

export const PA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pl-mission", label: "What this lesson teaches" },
  { id: "pl-network", label: "The network of this lesson" },
  { id: "pl-ideas", label: "Three ideas you need" },
  { id: "pl-watch", label: "What you will watch" },
  { id: "pl-points", label: "Five places to capture" },
  { id: "pl-changes", label: "What changes between captures" },
  { id: "pl-tuple", label: "One conversation = one five-tuple" },
  { id: "pl-handshake", label: "The handshake" },
  { id: "pl-seqack", label: "Sequence and acknowledgment" },
  { id: "pl-close", label: "The orderly close" },
  { id: "pl-working", label: "What working looks like" },
  { id: "pl-incident", label: "The slow-open incident" },
  { id: "pl-bracket", label: "Bracket the loss" },
  { id: "pl-counters", label: "Let the counters confirm" },
  { id: "pl-repair", label: "Repair and proof" },
  { id: "pl-other", label: "Other ways it breaks" },
  { id: "pl-model", label: "Mental model" },
  { id: "pl-glossary", label: "Glossary" },
  { id: "pl-recap", label: "Recap" },
  { id: "pl-practice", label: "Practice it" },
];

/** Real tcpdump, Junos and Linux output on this page comes from the Packet Analysis Lab. */
const run = (s: PaState, ...a: PaAction[]) => a.reduce((acc, x) => paApply(acc, x), s);
export const paTicketRun = (id: PaTicketId) => paTicket(id).repro.reduce((acc, a) => paApply(acc, a), paTicketState(id, 1));
export const paSet = (text: string, r1?: (c: { shape?: boolean }) => void, host?: (h: PaState["hosts"]) => void): PaAction => ({ type: "set", text, changes: r1 ? [{ dev: "R1", f: r1 }] : [], host });
export const PA_HEALTHY = run(createPaNet(0), { type: "curl" });
export const PA_INC = paTicketRun("retdrop");
export const PA_FIXED = run(PA_INC, paSet("R1: delete the shaper", (c) => void (c.shape = false)), { type: "nc" }, { type: "nc" }, { type: "nc" });
export function paCli(s: PaState, d: PaD, command: string) {
  return runGuideCli(paSets(paStaticApi(s, d), d).juniper, command);
}
export function paOnly(s: PaState, d: PaD, command: string, match: RegExp, keep = 0) {
  const x = paCli(s, d, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Connection tests as the lab reports them (from test `from` on). */
export function PaResult({ s, title, from = 0 }: { s: PaState; title: string; from?: number }) {
  const ts = s.tests.slice(from);
  const ok = ts.every((t) => t.outcome === "ok" && t.synRetx === 0 && t.dataRetx === 0);
  return (
    <Callout tone={ok ? "success" : "danger"} title={title} icon={ok ? "✓" : "!"}>
      {ts.map((t) => `${t.kind === "ping" ? `ping ×${t.pingSent}` : `${t.kind} from port ${t.sport}`}: ${outcomeText(t)}`).join(" · ")}
    </Callout>
  );
}
/** Which capture points saw each frame of one test — the bracket, from the lab. */
export function PaBracket({ s, i, title }: { s: PaState; i: number; title: string }) {
  const rows = bracket(s, s.tests[i]).filter((x) => x.f.kind !== "arp-rep");
  return <FieldTable title={title} accent="ip" columns={["Frame", ...CAP_PTS.map((p) => p.label.replace(/ \(.*\)/, ""))]} rows={rows.map((x) => [`${x.f.dir === "c2s" ? "→" : "←"} ${frameLabel(x.f)}`, ...CAP_PTS.map((p) => (x.seen[p.id] ? "✓" : "—"))])} />;
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Packet Analysis Lab" onPractice={openLab}>
      The network of this lesson with five live capture points: run connection tests, read tcpdump and Junos monitor output, compare captures frame by frame, read R1&apos;s counters, stop services, add firewall rules, break the mirror — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const H = FLOW.healthy;
const I = FLOW.incident;

function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="CLIENT, SW1, R1 and SERVER in a line with three capture points: SW1 mirror of CLIENT's port, R1 ge-0/0/1, SERVER eth0">
      <DNode x={70} y={70} label="CLIENT" sub={`${PA.client}/24`} accent={D.cyan} w={112} />
      <DNode x={235} y={70} label="SW1" sub="access switch" accent={D.eth} w={100} />
      <DNode x={405} y={70} label="R1" sub={`${PA.gw} | ${PA.r1Srv}`} accent={D.violet} w={130} />
      <DNode x={575} y={70} label="SERVER" sub={`${PA.server}:${SERVICE_PORT}`} accent={D.success} w={118} />
      <DLink x1={126} y1={70} x2={185} y2={70} />
      <DLink x1={285} y1={70} x2={340} y2={70} />
      <DLink x1={470} y1={70} x2={516} y2={70} />
      <DPill x={235} y={126} text="① CLIENT side (SPAN of ge-0/0/1)" color={D.warning} w={200} />
      <DPill x={425} y={20} text="② R1 ge-0/0/1" color={D.warning} w={110} />
      <DPill x={575} y={126} text="③ SERVER eth0" color={D.warning} w={110} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Clocks synchronized in this lab. Each capture shows only what passed its own point.
      </text>
    </DiagramSvg>
  );
}

function ChangesDiagram() {
  return (
    <DiagramSvg h={170} label="The same SYN at capture 1 and capture 3: TTL and MAC addresses differ, IPs, ports and sequence do not">
      <DTable
        x={30}
        y={8}
        title={`One SYN (:${H.sport}) seen at two capture points`}
        cols={[
          { label: "FIELD", w: 150 },
          { label: "① CLIENT SIDE", w: 215 },
          { label: "③ SERVER", w: 215 },
        ]}
        rows={[
          ["Ethernet src → dst", `${PA_MAC.CLIENT.slice(-5)} → ${PA_MAC.R1_LAN.slice(-5)} (R1)`, `${PA_MAC.R1_SRV.slice(-5)} (R1) → ${PA_MAC.SERVER.slice(-5)}`],
          ["IPv4 TTL", String(INITIAL_TTL), `${INITIAL_TTL - 1} (R1 routed it)`],
          ["IPv4 src → dst", `${PA.client} → ${PA.server}`, "same"],
          ["TCP ports", `${H.sport} → ${SERVICE_PORT}`, "same"],
          ["TCP seq / flags", `${H.isnC} / SYN`, "same"],
        ]}
        highlight={{ row: 1, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={150} label="Three-way handshake: SYN seq 1000, SYN-ACK seq 5000 ack 1001, ACK seq 1001 ack 5001">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `SYN · seq ${H.isnC} · flags 0x02`, sub: "CLOSED → SYN_SENT · MSS 1460" },
          { from: 1, to: 0, label: `SYN, ACK · seq ${H.isnS} · ack ${H.isnC + 1} · 0x12`, sub: "LISTEN → SYN_RECEIVED — the port is open", color: D.success },
          { from: 0, to: 1, label: `ACK · seq ${H.isnC + 1} · ack ${H.isnS + 1} · 0x10`, sub: "both ESTABLISHED" },
        ]}
      />
    </DiagramSvg>
  );
}

function SeqAckDiagram() {
  return (
    <DiagramSvg h={150} label="Data exchange: request seq 1001 length 120, response ack 1121 length 380, client ack 5381">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `PSH, ACK · seq ${H.isnC + 1} · len ${REQ_LEN}`, sub: `bytes ${H.isnC + 1}–${H.isnC + REQ_LEN}` },
          { from: 1, to: 0, label: `PSH, ACK · seq ${H.isnS + 1} · ack ${H.isnC + 1 + REQ_LEN} · len ${RESP_LEN}`, sub: `ack = next byte expected: ${H.isnC + 1} + ${REQ_LEN}`, color: D.success },
          { from: 0, to: 1, label: `ACK · ack ${H.isnS + 1 + RESP_LEN}`, sub: "cumulative: every response byte received" },
        ]}
      />
    </DiagramSvg>
  );
}

function CloseDiagram() {
  return (
    <DiagramSvg h={150} label="Orderly close: client FIN-ACK, server FIN-ACK acknowledging the FIN, client final ACK">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `FIN, ACK · seq ${H.isnC + 1 + REQ_LEN} · 0x11`, sub: "a FIN uses one sequence number" },
          { from: 1, to: 0, label: `FIN, ACK · seq ${H.isnS + 1 + RESP_LEN} · ack ${H.isnC + 2 + REQ_LEN}`, color: D.success },
          { from: 0, to: 1, label: `ACK · ack ${H.isnS + 2 + RESP_LEN}`, sub: "no RST, no retransmission: a clean baseline" },
        ]}
      />
    </DiagramSvg>
  );
}

function TupleDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={130} label="Five-tuple: protocol TCP, source 10.10.10.10 port 51000, destination 10.20.20.20 port 443">
      <DFieldRow x={30} y={16} fields={[f("Protocol", "6 (TCP)", 90, D.tcp, true), f("Source IP", PA.client, 130, D.ip), f("Src port", String(H.sport), 90, D.tcp), f("Destination IP", PA.server, 140, D.ip), f("Dst port", String(SERVICE_PORT), 90, D.tcp)]} />
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        Replies swap source and destination but belong to the same flow. A new connection gets a new source port.
      </text>
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        MACs and TTL are NOT part of the identity — they change hop by hop.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={210} label="Slow open: SYN at 10.000050, the first SYN-ACK leaves SERVER and passes R1 but never reaches CLIENT, SYN retransmitted at 11.000050, second SYN-ACK arrives">
      <SeqLanes
        timeX={70}
        lanes={[
          { x: 130, label: "CLIENT", color: D.cyan },
          { x: 360, label: "R1", color: D.violet },
          { x: 560, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 2, label: `SYN · seq ${I.isnC}`, time: secs(I.t0 + 50) },
          { from: 2, to: 1, label: `SYN, ACK · ack ${I.isnC + 1}`, time: secs(T.iSynAck), color: D.success },
          { from: 1, to: 0, label: "(not seen at ①)", time: "", drop: true },
          { from: 0, to: 2, label: `SYN · seq ${I.isnC} · retransmission`, time: secs(I.t0 + RTO_US + 50), color: D.warning },
          { from: 2, to: 0, label: `SYN, ACK · same seq/ack`, time: secs(T.iSynAck2), color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

function CorrelateDiagram() {
  return (
    <DiagramSvg h={150} label="Flow 51001 at three captures: SERVER and R1 see both SYN-ACKs, the CLIENT side sees only the second">
      <DTable
        x={20}
        y={8}
        title={`Flow :${I.sport} — what each capture recorded (handshake only)`}
        cols={[
          { label: "CAPTURE", w: 160 },
          { label: "SEGMENTS, IN ORDER", w: 440 },
        ]}
        rows={[
          ["③ SERVER eth0", "SYN · SYN, ACK · SYN [Retransmission] · SYN, ACK [Retransmission]"],
          ["② R1 ge-0/0/1", "SYN · SYN, ACK · SYN [Retransmission] · SYN, ACK [Retransmission]"],
          ["① CLIENT side", "SYN · SYN [Retransmission] · SYN, ACK   ← first SYN-ACK absent"],
        ]}
        highlight={{ row: 2, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function SignatureDiagram() {
  return (
    <DiagramSvg h={200} label="Signatures: loss is silence and a timer; a closed port answers at once with RST, ACK">
      <text x={160} y={18} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        Loss (this incident)
      </text>
      <text x={480} y={18} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        Closed port (not this incident)
      </text>
      <line x1={320} y1={10} x2={320} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <SeqLanes
        top={44}
        rowH={30}
        lanes={[
          { x: 50, label: "C", color: D.cyan },
          { x: 270, label: "S", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 0, label: "SYN, ACK", drop: true },
          { from: 0, to: 1, label: "SYN (+1 s)", color: D.warning },
          { from: 1, to: 0, label: "SYN, ACK", color: D.success },
        ]}
      />
      <SeqLanes
        top={44}
        rowH={30}
        lanes={[
          { x: 370, label: "C", color: D.cyan },
          { x: 590, label: "S", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 0, label: "RST, ACK · immediately", color: D.danger },
        ]}
      />
    </DiagramSvg>
  );
}

function CounterDiagram() {
  return (
    <DiagramSvg h={140} label="R1 ge-0/0/0 output drops 0 before the incident, 1 after the first SYN-ACK, still 1 after verification">
      <DTable
        x={60}
        y={8}
        title="R1 ge-0/0/0 (client-facing) — output drops"
        cols={[
          { label: "WHEN", w: 280 },
          { label: "VALUE", w: 110 },
          { label: "DELTA", w: 130 },
        ]}
        rows={[
          ["Before flow :51001", "0", "—"],
          ["After flow :51001's first SYN-ACK", "1", "+1"],
          ["After the verification connection", "1", "0 (no new drops)"],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function LadderView() {
  return (
    <DiagramSvg h={150} label="Evidence ladder for this incident: the interface-level egress drop at R1 is the lowest failing dependency">
      <LadderDiagram
        rows={[
          { rung: "Physical / interface", evidence: "R1 ge-0/0/0 output drops +1 in the window", status: "fail" },
          { rung: "Ethernet / ARP", evidence: `${PA.gw} resolved · SW1 forwards unchanged`, status: "ok" },
          { rung: "IP / routing", evidence: "every SYN reaches SERVER", status: "ok" },
          { rung: "Transport", evidence: "1 SYN retransmission (a symptom)", status: "suspect" },
          { rung: "Application", evidence: "SYN-ACK sent · no RST", status: "ok" },
        ]}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  const bar = (y: number, label: string, ms: number, color: string, text: string) => (
    <g>
      <text x={30} y={y + 13} fill={D.text} fontSize={10} fontWeight={700}>
        {label}
      </text>
      <rect x={170} y={y} width={Math.max(4, Math.min(420, ms * 0.4))} height={18} rx={4} fill={color} fillOpacity={0.35} stroke={color} />
      <text x={Math.max(180, Math.min(600, 178 + ms * 0.4)) + 6} y={y + 13} fill={color} fontSize={9.5} fontFamily="monospace" textAnchor={ms * 0.4 > 330 ? "end" : "start"}>
        {text}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={130} label="SYN to established: healthy 0.85 ms, incident 1000.85 ms with one retransmission, repaired 0.85 ms">
      {bar(14, `:${H.sport} baseline`, 0.85, D.success, "0.85 ms · 0 retransmissions")}
      {bar(46, `:${I.sport} incident`, 1000.85, D.danger, "1000.85 ms · 1 retransmission")}
      {bar(78, `:${FLOW.verify.sport} after repair`, 0.85, D.success, "0.85 ms · 0 retransmissions")}
      <text x={320} y={122} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        SYN → ACK at the CLIENT-side capture (bar length to scale).
      </text>
    </DiagramSvg>
  );
}

const CLOSED = paTicketRun("closed");
const HOSTFW = paTicketRun("hostfw");
const GW = paTicketRun("gateway");
const SPAN = paTicketRun("spanrx");
const SYN_S = PA_INC.tests[0];

export function PaLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          Every troubleshooting lesson after this one leans on one skill: <b className="text-pv-text">reading packets as evidence</b>. Users report symptoms — “slow”, “refused”, “spins” — and people guess. A capture replaces the guess with a record of what actually crossed the wire, when, and in which direction. This lesson answers: <b className="text-pv-text">how do you turn captures from several places into proof of where a conversation breaks?</b>
        </p>
        <p>You will follow one TCP connection to a web service on port {SERVICE_PORT} through five capture points, read every field tcpdump prints, then use the same captures — and the router&apos;s own counters — to locate a fault that makes some connections take a second longer to open. Nothing is guessed: each claim is backed by a line of output.</p>
        <ChecklistCard tone="cyan" title="By the end of this lesson you can" mark="→" items={["say what a capture point can and cannot prove", "read a tcpdump line: time, addresses, ports, flags, seq/ack, length", "follow a handshake, data exchange and close by their numbers", "match the same packet across captures by its five-tuple and sequence number", "bracket a loss between the last capture that saw a frame and the first that didn't", "confirm it with interface counters, repair it, and prove the repair with fresh traffic"]} />
      </GuideSection>

      <GuideSection id="pl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The guided lesson's topology: CLIENT, SW1, R1, SERVER and three capture points.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          CLIENT (<Mono>{PA.client}/24</Mono>) uses R1 (<Mono>{PA.gw}</Mono>) as its gateway; SW1 is the access switch between them. R1 routes to the server LAN, where SERVER (<Mono>{PA.server}</Mono>) runs nginx on TCP/{SERVICE_PORT}. One conversation, two subnets, one router hop.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson uses three capture points: SW1&apos;s mirror of CLIENT&apos;s port, R1 ge-0/0/1 and SERVER eth0. The lab adds two — a capture on CLIENT itself and R1&apos;s client-facing ge-0/0/0 — so you can bracket a loss on <i>both</i> sides of R1. SW1 (Junos) mirrors ge-0/0/1 to a CAPTURE laptop on ge-0/0/23; R1 (Junos) captures with <Mono>monitor traffic</Mono>; the hosts run Linux and keep a rolling tcpdump file. One simplification: on hardware-forwarding Junos routers <Mono>monitor traffic</Mono> shows only traffic the Routing Engine itself sends or receives — transit captures need port mirroring or a filter-based packet capture; the lab&apos;s R1 shows transit frames so you can bracket it from both sides. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Capture point", tone: "cyan", tag: "where you look", points: ["each capture sees one place", "absence there ≠ never sent"] },
            { title: "Five-tuple + seq", tone: "violet", tag: "identity", points: ["protocol, IPs, ports", "match one packet everywhere"] },
            { title: "Bracket", tone: "success", tag: "location", points: ["last capture that saw it", "first capture that didn't"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "A healthy fetch", look: `curl https://${PA.server}/ — ${outcomeText(PA_HEALTHY.tests[0])}` },
            { question: "The same packets at five points", look: "addresses stay, MACs and TTL change at R1" },
            { question: "The incident", look: `three connections; the first ${outcomeText(SYN_S)}` },
            { question: "Bracketing", look: "SERVER and R1 ge-0/0/1 see the first SYN-ACK — R1 ge-0/0/0 and CLIENT never do" },
            { question: "Counters, repair, proof", look: "R1 ge-0/0/0 output drops; remove the shaper; three clean connections" },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-points" eyebrow="Healthy" title="Five places to capture" tone="cyan">
        <p>Each capture point is a window onto one place in the path. Together they are the evidence; alone, each has blind spots.</p>
        <FieldTable
          title="The lab's capture points"
          accent="cyan"
          columns={["Point", "How", "Sees"]}
          rows={[
            ["CLIENT eth0", <Mono key="c">tcpdump -r /var/tmp/eth0.pcap</Mono>, "what the client sent and actually received"],
            ["SPAN", <Mono key="s">SW1 analyzer CAP → CAPTURE</Mono>, "copies of ge-0/0/1 traffic — in the directions configured"],
            ["R1 ge-0/0/0", <Mono key="r0">monitor traffic interface ge-0/0/0</Mono>, "frames R1 received from and transmitted to the client LAN"],
            ["R1 ge-0/0/1", <Mono key="r1">monitor traffic interface ge-0/0/1</Mono>, "frames R1 received from and transmitted to the server LAN"],
            ["SERVER eth0", <Mono key="sv">tcpdump -r /var/tmp/eth0.pcap</Mono>, "what the server received and sent"],
          ]}
        />
        <CliPanel run={paCli(PA_HEALTHY, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap")} caption="Linux · CLIENT — one curl: ARP for the gateway, handshake, request, response, close" />
        <Callout tone="warning" title="A capture is a witness, not the truth" icon="!">
          A frame missing from one capture was <i>not observed there</i>. Before calling it lost, look for it at the next point upstream and downstream, and for a counter that explains it.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-changes" eyebrow="Healthy" title="What changes between captures" tone="violet">
        <DiagramFrame caption="The guided lesson's SYN at two captures.">
          <ChangesDiagram />
        </DiagramFrame>
        <p>
          R1 is a router: it rewrites the Ethernet header (new source and destination MAC) and decrements TTL ({INITIAL_TTL} → {INITIAL_TTL - 1}). The IP addresses, ports, sequence numbers and length do not change. That split tells you which fields identify a packet across captures and which tell you where it was captured.
        </p>
        <CliPanel run={paOnly(PA_HEALTHY, "CLIENT", "tcpdump -nne -r /var/tmp/eth0.pcap tcp", /Flags \[S\]/, 1)} caption="Linux · CLIENT — the SYN leaves with CLIENT's MAC toward R1 ge-0/0/0" />
        <CliPanel run={paOnly(PA_HEALTHY, "SERVER", "tcpdump -nne -r /var/tmp/eth0.pcap tcp", /Flags \[S\]/, 1)} caption="Linux · SERVER — the same SYN arrives from R1 ge-0/0/1's MAC" />
        <CliPanel run={paOnly(PA_HEALTHY, "SERVER", "tcpdump -nnv -r /var/tmp/eth0.pcap tcp", /^$/, 5)} caption="Linux · SERVER — TTL 63 for what crossed R1, TTL 64 for what SERVER itself sends" />
      </GuideSection>

      <GuideSection id="pl-tuple" eyebrow="Healthy" title="One conversation = one five-tuple" tone="ip">
        <DiagramFrame caption="The guided lesson's five-tuple.">
          <TupleDiagram />
        </DiagramFrame>
        <p>
          Protocol, source IP, source port, destination IP, destination port. Every segment of one TCP connection carries the same five values (reversed in the reply direction). The client picks a new ephemeral source port for each connection — {PA_INC.tests.map((t) => t.sport).join(", ")} for the incident&apos;s three tests — so <Mono>port 51000</Mono> is a precise filter for one conversation.
        </p>
      </GuideSection>

      <GuideSection id="pl-handshake" eyebrow="Healthy" title="The handshake" tone="success">
        <DiagramFrame caption="The guided lesson's handshake numbers.">
          <HandshakeDiagram />
        </DiagramFrame>
        <p>
          <b className="text-pv-text">SYN</b>: “I want to talk; my numbering starts at 1000.” <b className="text-pv-text">SYN-ACK</b> (<Mono>[S.]</Mono>): “Agreed; mine starts at 5000, and I expect your byte 1001 next.” <b className="text-pv-text">ACK</b>: “I expect your byte 5001.” The SYN and the FIN each consume one sequence number, so the acknowledgment is always ISN + 1. Until the client sees the SYN-ACK, its connection is <i>opening</i>; the time from SYN to SYN-ACK at the client is the connect time.
        </p>
      </GuideSection>

      <GuideSection id="pl-seqack" eyebrow="Healthy" title="Sequence and acknowledgment" tone="violet">
        <DiagramFrame caption="The guided lesson's data exchange.">
          <SeqAckDiagram />
        </DiagramFrame>
        <p>
          After the handshake, tcpdump prints <b className="text-pv-text">relative</b> numbers by default — counted from each side&apos;s ISN — so the {REQ_LEN}-byte request is <Mono>seq 1:{REQ_LEN + 1}</Mono> and the {RESP_LEN}-byte response <Mono>seq 1:{RESP_LEN + 1}, ack {REQ_LEN + 1}</Mono>. Add <Mono>-S</Mono> for the absolute numbers the packets really carry; use them when you compare captures taken by different tools.
        </p>
        <CliPanel run={paOnly(PA_HEALTHY, "CLIENT", "tcpdump -nnS -r /var/tmp/eth0.pcap tcp", /length (120|380)/, 1)} caption="Linux · CLIENT — the request and response with absolute numbers (-S)" />
      </GuideSection>

      <GuideSection id="pl-close" eyebrow="Healthy" title="The orderly close" tone="cyan">
        <DiagramFrame caption="The guided lesson's close.">
          <CloseDiagram />
        </DiagramFrame>
        <p>Each side sends a FIN and acknowledges the other&apos;s. The side that closes first (here CLIENT) holds the socket in TIME-WAIT for a while, so late duplicates of this conversation can&apos;t be mistaken for a new one. A RST instead of a FIN is an abort, not a close.</p>
      </GuideSection>

      <GuideSection id="pl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "Where", "Healthy answer"]}
          rows={[
            ["Does the service answer?", <Mono key="1">curl -skv / nc -vz on CLIENT</Mono>, "200 OK / succeeded, under a millisecond"],
            ["Is every frame in every capture?", "the five captures", "each frame at every point on its path"],
            ["Does R1 forward everything?", <Mono key="3">show interfaces ge-0/0/0 extensive</Mono>, "output drops 0"],
            ["Is the server listening?", <Mono key="4">ss -tln on SERVER</Mono>, "LISTEN 0.0.0.0:443"],
            ["Is the mirror complete?", <Mono key="5">show forwarding-options analyzer</Mono>, "ingress and egress of ge-0/0/1"],
          ]}
        />
        <PaResult s={PA_HEALTHY} title="The lab: one healthy fetch" />
        <PaBracket s={PA_HEALTHY} i={0} title="The healthy fetch at the five capture points (from the lab)" />
      </GuideSection>

      <GuideSection id="pl-incident" eyebrow="Incident" title="The slow-open incident" tone="danger">
        <Callout tone="danger" title="The report" icon="!">
          {paTicket("retdrop").report}
        </Callout>
        <DiagramFrame caption="The guided lesson's slow open: the first SYN-ACK never reaches CLIENT.">
          <IncidentDiagram />
        </DiagramFrame>
        <PaResult s={PA_INC} title="The lab: three connection tests (the ticket)" />
        <p>
          “Nothing is refused” matters: a refusal would be an immediate RST. Here the client simply sends its SYN again after one second — TCP&apos;s retransmission timer — and that time it works. Something lost a frame of the handshake. CLIENT&apos;s capture shows the symptom, not the place:
        </p>
        <CliPanel run={paCli(PA_INC, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap port 51000")} caption="Linux · CLIENT — two identical SYNs one second apart; one SYN-ACK" />
        <CliPanel run={paCli(PA_INC, "SERVER", "tcpdump -nn -r /var/tmp/eth0.pcap port 51000")} caption="Linux · SERVER — it saw both SYNs and answered both" />
        <p className="text-sm text-pv-text-muted">SERVER answered the first SYN within 50 µs. So the server is innocent, and the SYN-ACK was lost somewhere between SERVER eth0 and CLIENT eth0.</p>
      </GuideSection>

      <GuideSection id="pl-bracket" eyebrow="Investigation" title="Bracket the loss" tone="ip">
        <DiagramFrame caption="The guided lesson's correlation of flow 51001 at three captures.">
          <CorrelateDiagram />
        </DiagramFrame>
        <p>Follow the lost frame — <Mono>51000 Flags [S.], seq 5000</Mono> at 10:00:10 — outward from SERVER. The last capture that has it and the first that doesn&apos;t enclose the fault.</p>
        <CliPanel run={paOnly(PA_INC, "R1", "monitor traffic interface ge-0/0/1 no-resolve", /51000.*Flags \[S/)} caption="Junos · R1 ge-0/0/1 — both SYN-ACKs arrive from SERVER (In)" />
        <CliPanel run={paOnly(PA_INC, "R1", "monitor traffic interface ge-0/0/0 no-resolve", /51000.*Flags \[S/)} caption="Junos · R1 ge-0/0/0 — only the second SYN-ACK is transmitted (Out)" />
        <PaBracket s={PA_INC} i={0} title="Connection 51000, frame by frame (from the lab)" />
        <ChecklistCard tone="ip" title="The bracket" mark="→" items={["seen arriving on R1 ge-0/0/1 — R1 received it", "never transmitted on R1 ge-0/0/0 — R1 did not send it", "so the loss is inside R1, between ingress and the ge-0/0/0 egress"]} />
      </GuideSection>

      <GuideSection id="pl-counters" eyebrow="Investigation" title="Let the counters confirm" tone="violet">
        <DiagramFrame caption="The guided lesson's counter test.">
          <CounterDiagram />
        </DiagramFrame>
        <p>
          A capture can&apos;t show what was never transmitted; a counter can. If R1 discarded the frame, the egress interface must say so. Two missing frames in the captures (the SYN-ACK of 51000 and a FIN of 51002) should mean exactly two drops.
        </p>
        <CliPanel run={paOnly(PA_INC, "R1", "show interfaces ge-0/0/0 extensive", /Output packets|Drops: \d|Queue counters|^\s+0\s+\d/)} caption="Junos · R1 — output drops 2, all in queue 0" />
        <CliPanel run={paOnly(PA_INC, "R1", "show class-of-service interface ge-0/0/0", /Physical|Shaping rate/)} caption="Junos · R1 — a 64 kbit/s shaper on a gigabit port" />
        <Callout tone="cyan" title="Why only some frames?" icon="i">
          A shaper queues what exceeds its rate and tail-drops what doesn&apos;t fit. Here it drops one in {DROP_EVERY} frames offered to ge-0/0/0. Small handshakes mostly squeeze through — which is exactly why the symptom is “sometimes, about a second”.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-repair" eyebrow="Repair" title="Repair and proof" tone="success">
        <p>The shaper was left over from a test. Remove it — then don&apos;t trust the commit; trust fresh traffic.</p>
        <CliPanel run={{ prompt: "admin@R1# ", command: "delete class-of-service interfaces ge-0/0/0 shaping-rate", output: "\n[edit]\nadmin@R1# commit\ncommit complete" }} caption="Junos · R1 — remove the shaping rate" />
        <PaResult s={PA_FIXED} from={3} title="The lab: three fresh connections" />
        <CliPanel run={paOnly(PA_FIXED, "R1", "show interfaces ge-0/0/0 extensive", /Output packets|Drops: \d/)} caption="Junos · R1 — output drops still 2: no new drops since the fix" />
        <DiagramFrame caption="The guided lesson's verification timing.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["no shaping-rate on ge-0/0/0", "three fresh connections, each opened in about 0.2 ms with no retransmission", "the drop counter did not move during the fresh tests", "lesson: the capture located the loss; the counter explained it; fresh traffic proved the fix"]} />
      </GuideSection>

      <GuideSection id="pl-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <DiagramFrame caption="The guided lesson's two signatures: silence vs refusal.">
          <SignatureDiagram />
        </DiagramFrame>
        <FailureSignatures
          items={[
            { tag: "RST", title: "Closed port", tone: "danger", points: ["RST,ACK within a millisecond", "nothing listens on 443"] },
            { tag: "FW", title: "Host firewall drop", tone: "danger", points: ["SYN in SERVER's capture, no answer", "iptables DROP counter rises"] },
            { tag: "GW", title: "Wrong server gateway", tone: "warning", points: ["SERVER ARPs for an unknown address", "SYN-RECV, ping fails too"] },
            { tag: "SPAN", title: "One-way mirror", tone: "violet", points: ["SPAN shows no replies", "CLIENT's own capture does"] },
          ]}
        />
        <CliPanel run={paOnly(CLOSED, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap tcp", /./, 1)} caption="Linux · CLIENT — refusal: SYN, then RST,ACK 0.2 ms later" />
        <CliPanel run={paOnly(HOSTFW, "SERVER", "tcpdump -nn -r /var/tmp/eth0.pcap tcp", /./, 1)} caption="Linux · SERVER — silence: three SYNs arrive, nothing leaves" />
        <CliPanel run={paOnly(GW, "SERVER", "tcpdump -nn -r /var/tmp/eth0.pcap", /10:00:1[0-5]/, 1)} caption="Linux · SERVER — it wants to answer, but ARPs for a gateway nobody owns" />
        <CliPanel run={paCli(SPAN, "CAPTURE", "tcpdump -nn -r /var/tmp/span.pcap")} caption="Linux · CAPTURE — the SPAN copy holds only what CLIENT sent" />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Packet Analysis Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="pl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <DiagramFrame caption="The guided lesson's evidence ladder.">
          <LadderView />
        </DiagramFrame>
        <p>
          Think of a parcel with scan points. Every depot it passes scans it: the label (five-tuple and sequence) never changes, only the depot&apos;s stamp (MAC, TTL). When a parcel goes missing you don&apos;t search the whole country — you find the last scan and the first missing scan, and the loss is in between. Then you check that depot&apos;s ledger (its counters): a depot that lost a parcel has a line for it. And a scanner that only reads outgoing parcels will swear nothing ever came back.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What does the user see — refused, silent, slow? Did the request reach SERVER? Did SERVER answer? Where does the answer disappear? What do the counters there say? Is every capture you rely on complete?
        </Callout>
      </GuideSection>

      <GuideSection id="pl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Capture point", def: "The one place a capture observes: a host NIC, a mirrored switch port, a router interface." },
            { term: "SPAN / analyzer", def: "A switch session copying a port's frames (ingress, egress or both) to a capture port." },
            { term: "Five-tuple", def: "Protocol, source and destination IP and port: the identity of one connection." },
            { term: "ISN", def: "Initial sequence number chosen by each side in its SYN." },
            { term: "Relative sequence number", def: "tcpdump's default: seq/ack counted from each side's ISN (-S shows absolute)." },
            { term: "Retransmission", def: "A segment sent again because no acknowledgment arrived in time (SYN: after 1 s, then 2 s…)." },
            { term: "Bracketing", def: "Locating a loss between the last capture that saw a frame and the first that didn't." },
            { term: "Tail drop", def: "A queue discarding new frames because it is full — counted as output drops." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["choose capture points and know their blind spots", "read tcpdump lines and TCP numbers", "match one packet across captures", "bracket a loss and confirm it with counters", "tell refusal from silence", "prove a repair with fresh traffic"]} />
      </GuideSection>

      <GuideSection id="pl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers packet analysis in full: capture methods and their limits, files and clocks, tcpdump lines and filters, TCP flags, states and retransmission, RST versus silence, bracketing and counters, capture pitfalls, and every failure signature with real evidence. The lab lets you capture and break it yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the Packet Analysis presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
