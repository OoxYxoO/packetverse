import { Callout, ChecklistCard, CompareCards, DiagramFrame, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { Arrow, C, Device, HeaderField, Svg } from "@/components/connection-network/guideSvg";
import type { CliVendor } from "@/lib/cli/types";
import { applyArp, createArpNet, HOST_AGING, HOSTS, ROUTER_AGING, runAll, type ArpAction, type ArpHost, type ArpNetState } from "@/lib/sim-engine/scenarios/arpNet";
import { ADDR } from "@/lib/sim-engine/scenarios/firstConnection";
import { arpHostSet, arpR1Sets, type ArpCliApi } from "./arp-lab/arpNetCli";

/**
 * ARP LESSON GUIDE — the lesson's story on the ARP Lab's network (Laptop, PC-B, PC-C on SW1; R1; the Server): why an
 * IPv4 packet needs a MAC, the request and the reply, the cache, ARP for the gateway, then the wrong-gateway incident.
 * Every output is printed by the ARP Lab's own terminals, run against the lab's model.
 */
export const ARP_LESSON_GUIDE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "g-mission", label: "What this lesson teaches" },
  { id: "g-network", label: "The network of this lesson" },
  { id: "g-ideas", label: "Three ideas you need" },
  { id: "g-walk", label: "What you will watch" },
  { id: "g-why", label: "An IP packet needs a MAC" },
  { id: "g-local", label: "Local or remote: who to ask for" },
  { id: "g-request", label: "The request: one question to all" },
  { id: "g-reply", label: "The reply: one answer to one" },
  { id: "g-cache", label: "The cache: ask once, reuse" },
  { id: "g-gateway", label: "Leaving the LAN: ARP for the gateway" },
  { id: "g-verify", label: "What working looks like" },
  { id: "g-incident", label: "The incident" },
  { id: "g-investigate", label: "What did the Laptop ask for?" },
  { id: "g-repair", label: "Repair and prove it" },
  { id: "g-other", label: "Other ways ARP breaks" },
  { id: "g-model", label: "Mental model" },
  { id: "g-glossary", label: "Glossary" },
  { id: "g-recap", label: "Recap" },
  { id: "g-practice", label: "Practice it" },
];

const LAPTOP = ADDR.laptop;
const GW = ADDR.gateway;
const SERVER = ADDR.server;
const PCB = { ip: HOSTS.pcb.cfg.ip, mac: HOSTS.pcb.mac };
const PCC = { ip: HOSTS.pcc.cfg.ip, mac: HOSTS.pcc.mac };
const WRONG_GW = "192.168.10.254";

/** The ARP Lab's own terminals, run against a lab state (a ping in the terminal runs on a copy of that state). */
function lessonCli(s: ArpNetState, dev: ArpHost | "r1", vendor: CliVendor, command: string) {
  const api: ArpCliApi = { view: s, act: (a) => (Array.isArray(a) ? runAll(s, a) : applyArp(s, a)), sw: { cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: [], setCand: () => undefined } };
  return runGuideCli(dev === "r1" ? arpR1Sets(api)[vendor] : arpHostSet(api, dev), command);
}
const ping = (src: ArpHost, dst: string): ArpAction => ({ type: "ping", src, dst, count: 1 });
/** The Laptop has pinged the Server once: it resolved its gateway, R1 resolved the Server. */
const HEALTHY = runAll(createArpNet(), [ping("laptop", SERVER.ip)]);
/** The lab's "gateway" ticket, after the Laptop tried the Server. */
const BROKEN = runAll(applyArp(createArpNet(), { type: "ticket", id: "gateway" }), [ping("laptop", SERVER.ip)]);
const FIXED = runAll(BROKEN, [{ type: "host-cfg", host: "laptop", cfg: { ip: LAPTOP.ip, prefix: 24, gw: GW.ip } }, ping("laptop", SERVER.ip)]);

type Flow = "request" | "reply" | "data" | "incident" | "none";
/** The lab network; `flow` draws one exchange on it. */
function LanDiagram({ flow }: { flow: Flow }) {
  const amber = C.arp;
  const link = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.line} strokeWidth={2} />;
  const label = flow === "request" ? `Laptop's ARP request for ${PCB.ip}, flooded by SW1 to PC-B, PC-C and R1` : flow === "reply" ? "PC-B's ARP reply, unicast back to the Laptop" : flow === "data" ? "The Laptop's packet for the Server goes to R1's MAC; R1 forwards it to the Server" : flow === "incident" ? `The Laptop asks for ${WRONG_GW}: the request is flooded and nobody answers` : "The lesson network: Laptop, PC-B and PC-C on SW1, R1 as gateway, the Server behind R1";
  return (
    <Svg h={262} label={label}>
      <rect x={10} y={14} width={500} height={238} rx={14} fill={amber} fillOpacity={0.04} stroke={amber} strokeOpacity={0.45} strokeDasharray="6 5" />
      <text x={22} y={32} fill={amber} fontSize={10.5} fontWeight={700}>
        192.168.10.0/24 · one broadcast domain
      </text>
      <text x={630} y={250} textAnchor="end" fill={C.tcp} fontSize={10.5} fontWeight={700}>
        10.20.20.0/24
      </text>
      {link(132, 74, 268, 104)}
      {link(132, 186, 268, 124)}
      {link(320, 136, 320, 186)}
      {link(372, 114, 478, 114)}
      {link(546, 136, 572, 186)}
      <text x={240} y={88} fill={C.faint} fontSize={9.5}>Fa0/1</text>
      <text x={238} y={146} fill={C.faint} fontSize={9.5}>Fa0/3</text>
      <text x={326} y={168} fill={C.faint} fontSize={9.5}>Fa0/4</text>
      <text x={380} y={106} fill={C.faint} fontSize={9.5}>Fa0/2</text>
      <Device x={80} y={66} label="Laptop" sub={LAPTOP.ip} />
      <Device x={80} y={194} label="PC-B" sub={PCB.ip} />
      <Device x={320} y={208} label="PC-C" sub={PCC.ip} />
      <Device x={320} y={114} label="SW1" sub="switch" accent={C.eth} />
      <Device x={530} y={114} label="R1" sub={GW.ip} accent={C.ip} />
      <Device x={584} y={208} label="Server" w={92} sub={SERVER.ip} accent={C.tcp} />
      {(flow === "request" || flow === "incident") && (
        <>
          <Arrow id={`lan-${flow}-1`} x1={132} y1={74} x2={266} y2={103} color={amber} label="broadcast" labelDy={-10} />
          <Arrow id={`lan-${flow}-2`} x1={268} y1={124} x2={134} y2={185} color={amber} />
          <Arrow id={`lan-${flow}-3`} x1={320} y1={136} x2={320} y2={184} color={amber} />
          <Arrow id={`lan-${flow}-4`} x1={372} y1={114} x2={476} y2={114} color={amber} />
        </>
      )}
      {flow === "request" && (
        <>
          <text x={150} y={238} fill={C.tcp} fontSize={10} fontWeight={700}>PC-B: that&apos;s me</text>
          <text x={380} y={62} fill={C.muted} fontSize={10}>PC-C, R1: not mine, drop it</text>
        </>
      )}
      {flow === "incident" && (
        <>
          <text x={150} y={238} fill={C.danger} fontSize={10} fontWeight={700}>{`who has ${WRONG_GW}? nobody`}</text>
          <text x={380} y={62} fill={C.danger} fontSize={10}>no reply comes back</text>
        </>
      )}
      {flow === "reply" && (
        <>
          <Arrow id="lan-reply-1" x1={132} y1={186} x2={266} y2={125} color={amber} label="unicast" labelDy={14} />
          <Arrow id="lan-reply-2" x1={268} y1={104} x2={134} y2={75} color={amber} />
        </>
      )}
      {flow === "data" && (
        <>
          <Arrow id="lan-data-1" x1={132} y1={74} x2={266} y2={103} color={C.ip} label="to R1's MAC" labelDy={-10} />
          <Arrow id="lan-data-2" x1={372} y1={114} x2={476} y2={114} color={C.ip} />
          <Arrow id="lan-data-3" x1={546} y1={136} x2={571} y2={184} color={C.tcp} />
          <text x={566} y={160} fill={C.tcp} fontSize={10} fontWeight={700}>new frame</text>
        </>
      )}
    </Svg>
  );
}

/** The first frame to the Server: Ethernet addresses for this link, IPv4 addresses end to end. */
function FrameDiagram() {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: "#94a3b80d" }}>
          <HeaderField label="Ethernet dst MAC" value={GW.mac} note="R1, the gateway (learned by ARP)" color={C.arp} strong />
          <HeaderField label="Ethernet src MAC" value={LAPTOP.mac} note="the Laptop" color={C.eth} />
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: "#60a5fa0d" }}>
          <HeaderField label="IPv4 src" value={LAPTOP.ip} note="the Laptop" color={C.ip} />
          <HeaderField label="IPv4 dst" value={SERVER.ip} note="still the Server" color={C.ip} strong />
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide">
        <span style={{ color: C.arp }}>Layer 2: the next hop on this link</span>
        <span style={{ color: C.ip }}>Layer 3: the final destination</span>
      </div>
    </div>
  );
}

function LessonLabBridge({ onOpenLab }: { onOpenLab?: () => void }) {
  if (!onOpenLab) return null;
  return (
    <PracticeBridge label="Open the ARP Lab" onPractice={onOpenLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function ArpLessonGuideContent({ onOpenLab }: { onOpenLab?: () => void }) {
  const arpOk = lessonCli(HEALTHY, "laptop", "cisco", "arp -a");
  const r1Ok = lessonCli(HEALTHY, "r1", "cisco", "show ip arp");
  const pingBad = lessonCli(BROKEN, "laptop", "cisco", `ping -n 2 ${SERVER.ip}`);
  const neighBad = lessonCli(BROKEN, "laptop", "cisco", "netsh interface ipv4 show neighbors");
  const ipcfgBad = lessonCli(BROKEN, "laptop", "cisco", "ipconfig");
  const pingLocal = lessonCli(BROKEN, "laptop", "cisco", `ping -n 2 ${PCB.ip}`);
  const arpFixed = lessonCli(FIXED, "laptop", "cisco", "arp -a");
  const pingFixed = lessonCli(FIXED, "laptop", "cisco", `ping -n 2 ${SERVER.ip}`);
  return (
    <div className="space-y-12">
      <GuideSection id="g-mission" eyebrow="This lesson" title="What this lesson teaches" tone="arp">
        <p>
          The Laptop wants to talk to PC-B, on the same switch, and to the Server, behind the router. It knows both IP addresses. But on Ethernet nothing leaves without a destination <strong>MAC</strong> address, and the Laptop knows nobody&apos;s MAC.
        </p>
        <p>
          This lesson shows how <strong>ARP</strong> fills that gap: you watch the Laptop decide whom to ask, ask the whole LAN, get one answer, remember it, and ask for the gateway instead when the destination is elsewhere. Then the Laptop can reach PC-B but not the Server, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="arp"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "explain why an IPv4 packet can't leave a host until ARP has found a MAC",
            "say, for any destination, which IP address the Laptop puts in its ARP request",
            "predict who receives an ARP request, who answers, and who learns what",
            "read an ARP cache and say when the Laptop will ask again",
            "find and repair the incident of this lesson from the Laptop's own evidence, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="g-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Laptop, PC-B and PC-C share one switch and one subnet. R1 is their gateway and leads to the Server's subnet.">
          <LanDiagram flow="none" />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          columns={["Device", "IPv4 address", "MAC address", "Where"]}
          rows={[
            ["Laptop (Windows)", `${LAPTOP.ip}/24`, <Mono key="l">{LAPTOP.mac}</Mono>, "SW1 Fa0/1"],
            ["PC-B (Linux)", `${PCB.ip}/24`, <Mono key="b">{PCB.mac}</Mono>, "SW1 Fa0/3"],
            ["PC-C (Windows)", `${PCC.ip}/24`, <Mono key="c">{PCC.mac}</Mono>, "SW1 Fa0/4"],
            ["R1 LAN side (gateway)", `${GW.ip}/24`, <Mono key="r">{GW.mac}</Mono>, "SW1 Fa0/2, R1 Gi0/0"],
            ["Server (Linux)", `${SERVER.ip}/24`, <Mono key="s">{SERVER.mac}</Mono>, "R1 Gi0/1 (10.20.20.1)"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">
          Every host on the LAN has <Mono>{GW.ip}</Mono> as its default gateway. The guided lesson follows the Laptop&apos;s first packet to the Server; the ARP Lab adds PC-B and PC-C on the same switch, so you can see who receives what. R1&apos;s ports are Gi0/0 and Gi0/1 on Cisco, ge-0/0/0 and ge-0/0/1 on Junos.
        </p>
      </GuideSection>

      <GuideSection id="g-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "ARP is for the next hop", body: "Local destination: the Laptop asks for that host's MAC. Remote destination: it asks for its gateway's MAC. It never asks for an address outside its subnet.", tone: "cyan" },
            { title: "One question to all, one answer to one", body: "The request is an Ethernet broadcast, so every host on the LAN receives it. Only the owner of the address answers, by unicast.", tone: "arp" },
            { title: "Answers are cached, for a while", body: "The Laptop remembers each answer and reuses it, so it doesn't ask before every packet. Entries expire, and then it asks again.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Local or remote", body: `The Laptop compares PC-B's and the Server's addresses with its own /24.`, tone: "cyan" },
            { title: "The request", body: `"Who has ${PCB.ip}?" goes to every host on the LAN.`, tone: "arp" },
            { title: "The reply", body: "PC-B answers the Laptop alone, and both now know each other.", tone: "success" },
            { title: "The cache", body: "The second ping needs no ARP at all.", tone: "violet" },
            { title: "The gateway", body: "For the Server, the Laptop asks for R1's MAC, and R1 asks for the Server's on its own side.", tone: "ip" },
            { title: "The incident", body: "The Laptop reaches PC-B but not the Server. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="g-why" eyebrow="The problem" title="An IP packet can't leave without a MAC" tone="arp">
        <p>
          The Laptop pings PC-B. Its IP layer builds a packet from <Mono>{LAPTOP.ip}</Mono> to <Mono>{PCB.ip}</Mono>, and hands it to the network card to send in an Ethernet frame. The frame needs a destination MAC, the one PC-B&apos;s card will accept. The Laptop knows PC-B&apos;s IP address, from the user, but nothing has told it PC-B&apos;s MAC.
        </p>
        <p>The packet waits while the Laptop finds out. That is the only job of ARP (Address Resolution Protocol): turn an IPv4 address on this LAN into the MAC address that owns it.</p>
      </GuideSection>

      <GuideSection id="g-local" eyebrow="The decision" title="Local or remote: who to ask for" tone="cyan">
        <p>Before asking anything, the Laptop decides whose MAC it needs. It compares the destination with its own address under its mask (/24: the first three numbers):</p>
        <FieldTable
          title="The Laptop's decision"
          columns={["Destination", "Same 192.168.10 network?", "Next hop", "ARP for"]}
          rows={[
            [`PC-B ${PCB.ip}`, "yes: local", "PC-B itself", <Mono key="1">{PCB.ip}</Mono>],
            [`Server ${SERVER.ip}`, "no: remote", "the default gateway", <Mono key="2">{GW.ip}</Mono>],
          ]}
        />
        <Callout tone="cyan" title="The Laptop never ARPs for the Server" icon="→">
          The Server isn&apos;t on this LAN, so no broadcast from the Laptop could ever reach it. For a remote destination the Laptop only needs the MAC of the next hop on its own link: R1.
        </Callout>
      </GuideSection>

      <GuideSection id="g-request" eyebrow="The request" title="The request: one question to everyone" tone="arp">
        <p>
          The Laptop sends an ARP request: &quot;Who has <Mono>{PCB.ip}</Mono>? Tell <Mono>{LAPTOP.ip}</Mono>.&quot; It doesn&apos;t know where PC-B is, so it addresses the frame to the broadcast MAC <Mono>FF:FF:FF:FF:FF:FF</Mono>. The request carries the Laptop&apos;s own IP and MAC, and the target IP; the target MAC is left as zeros, because that is the question.
        </p>
        <DiagramFrame caption="SW1 floods the broadcast to every other port: PC-B, PC-C and R1 all receive the question.">
          <LanDiagram flow="request" />
        </DiagramFrame>
        <p>SW1 doesn&apos;t read ARP at all: it learns the Laptop&apos;s MAC on Fa0/1, as with any frame, and floods the broadcast. PC-C and R1 read the target IP, see it isn&apos;t theirs, and drop the request. PC-B sees its own address.</p>
      </GuideSection>

      <GuideSection id="g-reply" eyebrow="The reply" title="The reply: one answer, to one host" tone="success">
        <p>
          PC-B already knows everything it needs: the request told it the Laptop&apos;s IP and MAC. So PC-B first stores <Mono>{LAPTOP.ip} → {LAPTOP.mac}</Mono>, then answers &quot;<Mono>{PCB.ip}</Mono> is at <Mono>{PCB.mac}</Mono>&quot; in a unicast frame, straight to the Laptop.
        </p>
        <DiagramFrame caption="The reply is unicast: SW1 has just learned the Laptop on Fa0/1, so only Fa0/1 gets it.">
          <LanDiagram flow="reply" />
        </DiagramFrame>
        <p>The Laptop caches <Mono>{PCB.ip} → {PCB.mac}</Mono>, builds the frame its packet has been waiting for, and sends it. One question, one answer, and three devices learned something: the Laptop and PC-B each other&apos;s address, SW1 the two MACs&apos; ports. PC-C learned nothing.</p>
      </GuideSection>

      <GuideSection id="g-cache" eyebrow="The cache" title="The cache: ask once, then reuse" tone="violet">
        <p>
          The Laptop pings PC-B again. This time the answer is already in its ARP cache, so the frame leaves at once: no request, no broadcast. Every packet to PC-B reuses the entry while it lasts.
        </p>
        <p>
          Entries don&apos;t last for ever. In the lab a host forgets an entry after {HOST_AGING} s and R1 after {ROUTER_AGING} s; real systems use their own timers (a Cisco router keeps entries four hours). The next packet after that triggers a new request, which also catches a neighbor that changed its network card in the meantime.
        </p>
        <CompareCards
          items={[
            { title: "A complete entry", tone: "success", tag: "reachable", points: ["IP → MAC, learned from a reply", "Reused for every packet", "Refreshed or forgotten when it ages"] },
            { title: "An incomplete entry", tone: "danger", tag: "no answer", points: ["A request went out, nothing came back", "The packet waiting for it is dropped", "Windows lists it as Unreachable, Linux as FAILED"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-gateway" eyebrow="The gateway" title="Leaving the LAN: ARP for the gateway" tone="ip">
        <p>
          Now the Laptop pings the Server. Remote, so the next hop is the gateway <Mono>{GW.ip}</Mono>. The Laptop ARPs for <em>that</em> address, R1 answers with <Mono>{GW.mac}</Mono>, and the Laptop sends the packet to R1&apos;s MAC with the Server&apos;s IP inside:
        </p>
        <FrameDiagram />
        <DiagramFrame caption="On each link, a new frame: the Laptop → R1 frame ends at R1, and R1 builds its own frame to the Server.">
          <LanDiagram flow="data" />
        </DiagramFrame>
        <p>
          R1 routes the packet to its Gi0/1 side, where it needs the Server&apos;s MAC, so R1 runs its own ARP on <em>that</em> link. ARP is hop by hop: each device resolves only its next hop, on its own wire. The Laptop never learns the Server&apos;s MAC; it doesn&apos;t need to.
        </p>
        <p>
          Notice what the Laptop takes on trust: it ARPs for whatever gateway address it was configured with. It never checks that someone actually owns that address. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="g-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one place that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the devices"
          columns={["Question", "Windows (Laptop)", "R1 Cisco / Junos", "What the answer proves"]}
          rows={[
            ["Which next hop will be used?", <Mono key="1">ipconfig</Mono>, <Mono key="2">show ip route / show route</Mono>, "Address, mask and gateway decide whom the host ARPs for"],
            ["What has this device resolved?", <Mono key="3">arp -a</Mono>, <Mono key="4">show ip arp / show arp</Mono>, "Complete entries: questions that got an answer"],
            ["Which questions failed?", <Mono key="5">netsh interface ipv4 show neighbors</Mono>, <Mono key="6">show ip arp / show arp</Mono>, "An Unreachable (incomplete) entry is a question nobody answered"],
            ["Does traffic flow?", <Mono key="7">ping</Mono>, <Mono key="8">ping</Mono>, "TTL 63 from the Server: one router crossed"],
          ]}
        />
        <p>After one ping to the Server, the Laptop has resolved its gateway, and only its gateway:</p>
        <CliPanel run={arpOk} caption="Laptop · Windows · healthy" />
        <p>And R1 holds both halves of the trip: the Laptop on Gi0/0, and the Server it resolved itself on Gi0/1 (the rows with no age are R1&apos;s own addresses):</p>
        <CliPanel run={r1Ok} caption="R1 · Cisco IOS · healthy" />
      </GuideSection>

      <GuideSection id="g-incident" eyebrow="Incident" title="The incident: the Server is unreachable from the Laptop" tone="danger">
        <p>The Laptop&apos;s user says: &quot;I can reach PC-B and PC-C, but nothing outside our LAN. The Server is up: others reach it.&quot; The cable is fine, and SW1 and R1 report no problem.</p>
        <DiagramFrame caption={`The Laptop asks for ${WRONG_GW}. The request reaches everyone on the LAN, and nobody owns that address.`}>
          <LanDiagram flow="incident" />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: [`The Laptop ARPs for its gateway ${GW.ip}`, "R1 answers with its MAC", "The packet goes to R1, and on to the Server"] },
            { title: "What happens", tone: "danger", tag: "incident", points: [`The Laptop ARPs for ${WRONG_GW}`, "The request is flooded and nobody answers", "The packet is dropped on the Laptop: it never leaves"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`The Laptop's default gateway is set to ${WRONG_GW}`, "No device owns that address, so no reply ever comes", "Without a MAC for the next hop, nothing remote can leave"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["The cable or SW1: PC-B and PC-C answer", "R1: it isn't even being asked for its own address", "The Server: the packet never gets as far as R1"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-investigate" eyebrow="Investigation" title="Ask what the Laptop asked for" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does local traffic work?", look: "Ping PC-B: replies. The Laptop's card, the cable, SW1 and ARP itself all work." },
            { question: "What did the Laptop ARP for, to reach the Server?", look: `netsh … show neighbors: ${WRONG_GW}, Unreachable. A question nobody answered.` },
            { question: "Why that address?", look: `ipconfig: Default Gateway ${WRONG_GW}. R1 is ${GW.ip}.` },
          ]}
        />
        <CliPanel run={{ ...pingLocal, output: pickLines(pingLocal.output, /Pinging|Reply/) }} caption="Laptop · local traffic works" />
        <CliPanel run={{ ...pingBad, output: pickLines(pingBad.output, /Pinging|Reply/) }} caption="Laptop · the Server fails" note="The error comes from the Laptop's own address: the packet never left it." />
        <CliPanel run={neighBad} caption="Laptop · the unanswered question" />
        <CliPanel run={{ ...ipcfgBad, output: pickLines(ipcfgBad.output, /IPv4|Subnet|Gateway/) }} caption="Laptop · why it asked for that address" />
      </GuideSection>

      <GuideSection id="g-repair" eyebrow="Repair" title="Repair, and prove it with a fresh test" tone="success">
        <p>
          In the Laptop&apos;s network settings, set the default gateway to <Mono>{GW.ip}</Mono>. Nothing on SW1 or R1 changes: they were never at fault. The next packet to the Server makes the Laptop ARP for the right address:
        </p>
        <CliPanel run={{ ...pingFixed, output: pickLines(pingFixed.output, /Pinging|Reply/) }} caption="Laptop · after the repair" />
        <CliPanel run={arpFixed} caption="Laptop · after the repair" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `ipconfig shows Default Gateway ${GW.ip}`,
            `arp -a shows ${GW.ip} → ${GW.mac.toLowerCase().replace(/:/g, "-")}, dynamic`,
            "A fresh ping to the Server answers with TTL 63: one router crossed",
            "PC-B and PC-C were never interrupted",
          ]}
        />
      </GuideSection>

      <GuideSection id="g-other" eyebrow="Troubleshooting" title="Other ways ARP breaks" tone="warning">
        <p>The wrong gateway is one way to send ARP after the wrong address. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real output from the Laptop, the switch and R1.</p>
        <CompareCards
          items={[
            { title: "A wrong mask", tone: "warning", tag: "works, but via the router", points: ["With /28, PC-B looks remote to the Laptop", "So it ARPs for the gateway, and R1 relays the traffic", "Nothing fails: R1's counters give it away"] },
            { title: "A wrong static entry", tone: "danger", tag: "one host, one neighbor", points: ["arp -a shows a static entry with an old MAC", "The Laptop never asks, so it never learns the new card", "Delete the entry; the next packet ARPs"] },
            { title: "A duplicate IP", tone: "danger", tag: "the wrong host answers", points: ["Two hosts answer the same request", "The cache holds whichever answered last", "The ping works, to the wrong machine"] },
            { title: "A switch port down", tone: "violet", tag: "nobody reaches the host", points: ["The request never reaches the target", "Every sender's entry stays incomplete", "Show interfaces status: disabled"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-model" eyebrow="Mental model" title="Asking the room" tone="cyan">
        <p>
          ARP is a question shouted into one room: &quot;Whoever has 192.168.10.20, tell me your MAC.&quot; Everyone in the room hears it; only the owner answers, quietly, to the one who asked; and the asker writes the answer in a notebook so it doesn&apos;t have to shout again for a while. The room ends at the router: for anyone outside, you shout for the router instead and let it ask in its own room. If you shout a name nobody has, the room stays silent, and that silence is the evidence.
        </p>
      </GuideSection>

      <GuideSection id="g-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "ARP", def: "Address Resolution Protocol: finds the MAC address that owns an IPv4 address on the local link." },
            { term: "ARP request", def: "Who has this IP? Sent to the broadcast MAC, so every host on the LAN receives it." },
            { term: "ARP reply", def: "This IP is at this MAC. Sent unicast, only by the owner, to the asker." },
            { term: "ARP cache", def: "A host's or router's table of IP → MAC answers, each kept for a limited time." },
            { term: "Next hop", def: "The device on this link that gets the frame: the destination itself if local, the gateway if remote." },
            { term: "Default gateway", def: "The router address a host uses for every destination outside its subnet." },
            { term: "Incomplete entry", def: "A request that got no reply. Windows shows it as Unreachable, Linux as FAILED." },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="ARP in this lesson"
          mark="→"
          items={[
            "A packet waits on the host until ARP has found the next hop's MAC",
            "Local destination: ARP for it. Remote destination: ARP for the gateway",
            "The request is broadcast to the LAN; only the owner answers, by unicast",
            "The answer is cached and reused until it ages out",
            "Each router resolves its own next hop: ARP never crosses a router",
            "A question nobody answers leaves an incomplete entry: check which address was asked for",
          ]}
        />
      </GuideSection>

      <GuideSection id="g-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what every device should ask, answer and remember, and how to prove it. The ARP Lab gives you this network with Windows, Linux, Cisco and Junos terminals:</p>
        <FlowSteps
          steps={[
            { title: "Learn (5 levels)", body: "Why ARP, request and reply, the cache, leaving the LAN, when it fails.", tone: "violet" },
            { title: "Challenges (7)", body: "Ping twice and ARP once, get the gateway's MAC without pinging it, make R1 resolve the Server, leave an incomplete entry.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch the request, the reply and the cache animated on this network in the ARP presentation.</PresentationBridge>
        <LessonLabBridge onOpenLab={onOpenLab} />
        <p className="text-sm text-pv-text-muted">For the full course (the ARP packet field by field, ARP table vs MAC table, gratuitous and proxy ARP, security, real output for every fault, a knowledge check), open the ARP Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
