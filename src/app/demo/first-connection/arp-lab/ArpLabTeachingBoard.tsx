"use client";

import type { ReactNode } from "react";
import {
  BoardSection,
  CommandHelp,
  DeepenUnderstanding,
  EngineerCheck as GenericEngineerCheck,
  KeyLesson,
  NextAction,
  PredictionBlock,
  StateDeltaChips,
  TeachingBoard,
  TeachingEventRows,
  Verdict,
} from "@/components/practice-lab/TeachingBoard";
import type { CliVendor } from "@/lib/cli/types";
import { ADDR, SUBNETS } from "@/lib/sim-engine/scenarios/firstConnection";
import { ARP_LAB_REMOTE_DESTINATION, isInFlight, type ArpLabState, type ArpLabTable } from "@/lib/sim-engine/scenarios/arpLab";
import { interfaceAlias } from "../cliAdapter";

/**
 * TEACHING BOARD — the single explanation surface of the ARP Lab.
 *
 *   topology        = where the event happened
 *   teaching board  = what happened and why        (this file)
 *   live state      = what changed (exact entries)
 *   CLI             = prove it yourself
 *
 * It never repeats the live tables, the event log or terminal output:
 * deltas are summarised as chips, and engineer checks complete
 * themselves when the learner actually queries a device (or opens the
 * Laptop, which has no IOS/Junos CLI). Only the two key predictions
 * (ARP target, first-frame destination MAC) gate the lab's own Send
 * buttons; nothing here touches the guided lesson.
 */

export type LabStage = 0 | 1 | 2 | 3;
type CliDevice = "switch" | "router";
type TableCmd = "mac-table" | "arp-table";

export interface LabChallengeState {
  answers: Record<string, string[]>;
  revealed: string[];
}

export const LAB_TABLE_COMMAND: Record<CliVendor, Record<TableCmd, string>> = {
  cisco: { "mac-table": "show mac address-table", "arp-table": "show ip arp" },
  juniper: { "mac-table": "show ethernet-switching table", "arp-table": "show arp" },
};

interface BoardProps {
  stage: LabStage;
  lab: ArpLabState;
  vendor: CliVendor;
  /** `${stage}:${device}:${commandId}` per table query made after the frame landed; `${stage}:laptop:view` when the Laptop's facts were opened. */
  inspected: Set<string>;
  challenges: LabChallengeState;
  onAnswer: (id: string, value: string[]) => void;
  onPutInTerminal: (device: CliDevice, command: string) => void;
  onShowLaptop: () => void;
}

// ------------------------------------------------------------ ARP adapters over the generic Teaching Board primitives
// The primitives (components/practice-lab/TeachingBoard) are protocol-agnostic; these
// thin wrappers add only ARP knowledge: which tables exist, how inspection keys prove
// a fact, how predictions are stored, and which commands answer which question.

const Mono = ({ children }: { children: ReactNode }) => <span className="pv-mono text-[11.5px] text-pv-text">{children}</span>;

const Section = BoardSection;
const Board = TeachingBoard;
const Next = NextAction;

type RowTone = "device" | "broadcast" | "boundary" | "result";
function EventRows({ rows }: { rows: { who: string; tone?: RowTone; body: ReactNode; short?: ReactNode }[] }) {
  return <TeachingEventRows rows={rows.map((r) => ({ ...r, tone: r.tone === "broadcast" || r.tone === "boundary" ? "attention" : r.tone === "result" ? "result" : "device" }))} />;
}

const TABLE_LABEL: Record<ArpLabTable, string> = { "laptop-arp": "Laptop ARP", "switch-mac": "SW1 MAC", "router-arp": "R1 ARP" };

/** Delta chips computed from what the latest frame actually taught. */
function DeltaChips({ lab }: { lab: ArpLabState }) {
  return <StateDeltaChips deltas={(["laptop-arp", "switch-mac", "router-arp"] as const).map((t) => ({ label: TABLE_LABEL[t], count: lab.learned.filter((l) => l.table === t).length }))} />;
}

interface CheckFact {
  key: string;
  text: ReactNode;
  confirmed: ReactNode;
  /** Laptop facts complete by opening the Laptop — hosts don't run IOS/Junos. */
  laptop?: boolean;
}

/** ARP engineer check: a fact is proven when its inspection key was recorded (a successful command after the frame landed, or opening the Laptop). */
function EngineerCheck({ intro, facts, inspected, onShowLaptop }: { intro: string; facts: CheckFact[]; inspected: Set<string>; onShowLaptop: () => void }) {
  return (
    <GenericEngineerCheck
      intro={intro}
      footnote="Ticks itself when you query the device in the terminal. Optional — it never blocks the lab."
      facts={facts.map((f) => ({ id: f.key, text: f.text, provenText: f.confirmed, proven: inspected.has(f.key), action: f.laptop ? { label: "open the Laptop", onClick: onShowLaptop } : undefined }))}
    />
  );
}

/** Lab-local single-choice prediction stored in the ARP lab's challenge state. */
function Choice({ id, prompt, options, challenges, onAnswer, verdict }: { id: string; prompt: ReactNode; options: { id: string; label: string }[]; challenges: LabChallengeState; onAnswer: BoardProps["onAnswer"]; verdict?: (picked: string) => ReactNode }) {
  const picked = challenges.answers[id]?.[0];
  return <PredictionBlock prompt={prompt} options={options} value={picked ? [picked] : []} onChange={(v) => onAnswer(id, v)} verdict={picked && verdict ? verdict(picked) : undefined} />;
}

/** ARP's "Deepen understanding": context questions plus MAC → PORT / IP → MAC command help. */
function Deepen({ qa, vendor, onPutInTerminal }: { qa: { q: string; a: ReactNode }[]; vendor: CliVendor; onPutInTerminal: BoardProps["onPutInTerminal"] }) {
  const items: { q: string; device: CliDevice; cmd: TableCmd }[] = [
    { q: "How do I inspect MAC → PORT?", device: "switch", cmd: "mac-table" },
    { q: "How do I inspect IP → MAC?", device: "router", cmd: "arp-table" },
  ];
  return (
    <DeepenUnderstanding qa={qa}>
      <CommandHelp
        items={items.map((it) => ({
          question: it.q,
          commands: [
            { label: "Cisco", command: LAB_TABLE_COMMAND.cisco[it.cmd] },
            { label: "Junos", command: LAB_TABLE_COMMAND.juniper[it.cmd] },
          ],
          onPut: () => onPutInTerminal(it.device, LAB_TABLE_COMMAND[vendor][it.cmd]),
          putLabel: `Put "${LAB_TABLE_COMMAND[vendor][it.cmd]}" in the ${it.device === "switch" ? "SW1" : "R1"} terminal (you still press Enter)`,
        }))}
      />
    </DeepenUnderstanding>
  );
}

// ------------------------------------------------------------ the board

export function ArpLabTeachingBoard({ stage, lab, vendor, inspected, challenges, onAnswer, onPutInTerminal, onShowLaptop }: BoardProps) {
  const inFlight = isInFlight(lab);
  const fa01 = interfaceAlias(vendor, { kind: "switch", id: "port1" });
  const fa02 = interfaceAlias(vendor, { kind: "switch", id: "port2" });
  const deepen = (qa: { q: string; a: ReactNode }[]) => <Deepen qa={qa} vendor={vendor} onPutInTerminal={onPutInTerminal} />;

  // ---------------------------------------------------------------- T0
  if (stage === 0) {
    const target = challenges.answers["arp-target"]?.[0];
    return (
      <Board phase="T0 · Baseline" title="Before anything moves" summary={<>Laptop {ADDR.laptop.ip} wants to reach Server {ADDR.server.ip}.</>}>
        <Section label="The situation">
          <EventRows
            rows={[
              { who: "Subnets", short: <>Laptop and Server are on different subnets.</>, body: <>The Laptop is on <Mono>{SUBNETS.lan.network}</Mono>; the Server is on <Mono>{SUBNETS.server.network}</Mono> — different subnets.</> },
              { who: "Ethernet", tone: "boundary", short: <>A frame can&apos;t go straight to a remote host.</>, body: <>An Ethernet frame only reaches devices on the local segment, so the Laptop cannot frame a packet straight to the remote Server.</> },
              { who: "Laptop", short: <>Needs its local next hop&apos;s MAC first.</>, body: <>It needs the Layer-2 (MAC) address of its local next hop first.</> },
            ]}
          />
        </Section>
        <Choice
          id="arp-target"
          prompt={<>The final destination is {ADDR.server.ip}. Which IPv4 address should the Laptop ARP for?</>}
          options={[
            { id: "gw", label: `${ADDR.gateway.ip} — the default gateway` },
            { id: "server", label: `${ADDR.server.ip} — the remote Server` },
            { id: "self", label: `${ADDR.laptop.ip} — itself` },
            { id: "bcast", label: "255.255.255.255" },
          ]}
          challenges={challenges}
          onAnswer={onAnswer}
          verdict={(p) => (
            <Verdict correct={p === "gw"}>
              The Server is off-subnet, so the Laptop ARPs for its default gateway {ADDR.gateway.ip}. An ARP for {ADDR.server.ip} could never be answered: the Server is outside the Laptop&apos;s broadcast domain.
            </Verdict>
          )}
        />
        {target && (
          <KeyLesson>
            The <b>IP destination</b> is the remote Server. The first <b>Ethernet destination</b> is the local Router.
          </KeyLesson>
        )}
        <EngineerCheck
          intro="Establish the baseline with the live CLI before sending anything."
          inspected={inspected}
          onShowLaptop={onShowLaptop}
          facts={[
            { key: "0:switch:mac-table", text: "SW1's MAC table", confirmed: "SW1's MAC table is empty — no frame has entered it yet." },
            { key: "0:router:arp-table", text: "R1's ARP table", confirmed: "R1's ARP table is empty — it has heard from no one." },
          ]}
        />
        <Next>{target ? "Send ARP Request, then watch which devices hear it." : "Answer the prediction to unlock Send ARP Request."}</Next>
        {deepen([
          { q: "Why not ARP for the Server directly?", a: <>ARP requests are broadcasts, and broadcasts stay inside one broadcast domain. The Server lives behind R1, so it would never hear the question — and the frame only has to reach the gateway anyway.</> },
        ])}
      </Board>
    );
  }

  // ---------------------------------------------------------------- T1
  if (stage === 1) {
    if (inFlight)
      return (
        <Board phase="T1 · ARP Request" title="ARP Request in flight" summary={<>The Laptop broadcast: &ldquo;Who has {ADDR.gateway.ip}? Tell {ADDR.laptop.ip}.&rdquo;</>}>
          <Next>Watch the broadcast flood {SUBNETS.lan.network} — and what SW1 and R1 learn as it passes.</Next>
        </Board>
      );
    const reply = challenges.answers["predict-reply"]?.[0];
    return (
      <Board phase="T1 · ARP Request" title="ARP Request — What just happened?" summary={<>The Laptop broadcast: &ldquo;Who has {ADDR.gateway.ip}? Tell {ADDR.laptop.ip}.&rdquo;</>}>
        <Section label="What happened">
          <EventRows
            rows={[
              {
                who: "Access Switch",
                short: (
                  <>
                    Learned the frame&apos;s source MAC: <Mono>{ADDR.laptop.mac} → {fa01}</Mono> (not from ARP).
                  </>
                ),
                body: (
                  <>
                    The request entered SW1 on <Mono>{fa01}</Mono>. SW1 learned the Ethernet <b className="text-pv-text">source MAC</b>: <Mono>{ADDR.laptop.mac} → {fa01}</Mono>. Not because it understood ARP — it reads the source MAC of every frame.
                  </>
                ),
              },
              {
                who: "Broadcast",
                tone: "broadcast",
                short: <>Dst <Mono>FF:FF:FF:FF:FF:FF</Mono>: flooded the LAN, stopped at R1.</>,
                body: (
                  <>
                    The destination MAC was <Mono>FF:FF:FF:FF:FF:FF</Mono>, so SW1 flooded it through the local broadcast domain. It stopped at R1 and never entered <Mono>{SUBNETS.server.network}</Mono>.
                  </>
                ),
              },
              {
                who: "Router",
                short: (
                  <>
                    Owns {ADDR.gateway.ip}; cached <Mono>{ADDR.laptop.ip} → {ADDR.laptop.mac}</Mono>.
                  </>
                ),
                body: (
                  <>
                    R1 owns <Mono>{ADDR.gateway.ip}</Mono>, so the question is about its own interface. While processing it, R1 learned the sender: <Mono>{ADDR.laptop.ip} → {ADDR.laptop.mac}</Mono>.
                  </>
                ),
              },
              { who: "Laptop", short: <>ARP cache still empty — no answer yet.</>, body: <>ARP cache still <b className="text-pv-text">empty</b>: it asked the question but has no answer yet.</> },
            ]}
          />
        </Section>
        <Section label="What changed">
          <DeltaChips lab={lab} />
        </Section>
        <KeyLesson>
          <p>
            SW1 learned <Mono>MAC → PORT</Mono> &nbsp;·&nbsp; R1 learned <Mono>IP → MAC</Mono>
          </p>
          <p className="mt-1 text-[12px] text-pv-text-muted">
            Different tables solving different problems — switch: &ldquo;Where is this MAC?&rdquo; · ARP: &ldquo;Which MAC owns this IPv4 address?&rdquo;
          </p>
        </KeyLesson>
        <EngineerCheck
          intro="Can you prove these three facts on the live network?"
          inspected={inspected}
          onShowLaptop={onShowLaptop}
          facts={[
            { key: "1:switch:mac-table", text: "SW1 learned the Laptop MAC", confirmed: `SW1 learned the Laptop MAC on ${fa01}.` },
            { key: "1:router:arp-table", text: "R1 learned the Laptop IP/MAC mapping", confirmed: `R1 maps ${ADDR.laptop.ip} → ${ADDR.laptop.mac}.` },
            { key: "1:laptop:view", text: "Laptop still has no gateway ARP entry", confirmed: "The Laptop's ARP cache is still empty.", laptop: true },
          ]}
        />
        <Choice
          id="predict-reply"
          prompt="Before you send the reply: which new entry should SW1 learn from it?"
          options={[
            { id: "bb-fa02", label: `${ADDR.gateway.mac} → ${fa02}` },
            { id: "bb-fa01", label: `${ADDR.gateway.mac} → ${fa01}` },
            { id: "aa-fa02", label: `${ADDR.laptop.mac} → ${fa02}` },
            { id: "none", label: "Nothing new" },
          ]}
          challenges={challenges}
          onAnswer={onAnswer}
        />
        <Next>{reply ? "Send ARP Reply to test your prediction." : "Predict, then Send ARP Reply."}</Next>
        {deepen([
          { q: "Why didn't the ARP broadcast reach the Server?", a: <>Switches flood broadcasts inside the VLAN; routers don&apos;t forward ordinary Layer-2 broadcasts into another IP subnet. So the gateway ARP stays inside {SUBNETS.lan.network} — the shaded area in the topology.</> },
          { q: "Why can R1 learn the sender from an ARP Request?", a: <>The request carries the sender&apos;s IP and MAC. R1 is about to reply to exactly that device, so caching the mapping now saves an ARP of its own later.</> },
          { q: "Does SW1 need to understand ARP?", a: <>No. SW1 only reads Ethernet headers: source MAC to learn, destination MAC to forward. The ARP payload inside is invisible to it.</> },
        ])}
      </Board>
    );
  }

  // ---------------------------------------------------------------- T2
  if (stage === 2) {
    if (inFlight || lab.phase === "reply")
      return (
        <Board phase="T2 · ARP Reply" title="ARP Reply in flight" summary={<>R1 answers unicast, straight to {ADDR.laptop.mac}.</>}>
          <Next>Watch SW1 learn from the reply on its way to the Laptop.</Next>
        </Board>
      );
    const reply = challenges.answers["predict-reply"]?.[0];
    const dst = challenges.answers["t3-dst-mac"]?.[0];
    return (
      <Board phase="T2 · ARP Reply" title="ARP Reply — The answer comes back" summary={<>&ldquo;{ADDR.gateway.ip} is at {ADDR.gateway.mac}.&rdquo;</>}>
        <Section label="What happened">
          <EventRows
            rows={[
              { who: "Router", short: <>Replied unicast to the Laptop.</>, body: <>R1 replied <b className="text-pv-text">unicast</b> to the Laptop&apos;s MAC — no broadcast needed, it knows who asked.</> },
              {
                who: "Access Switch",
                short: (
                  <>
                    Learned the source MAC: <Mono>{ADDR.gateway.mac} → {fa02}</Mono>.
                  </>
                ),
                body: (
                  <>
                    The reply entered SW1 on <Mono>{fa02}</Mono>. SW1 read the source MAC and learned <Mono>{ADDR.gateway.mac} → {fa02}</Mono>.
                  </>
                ),
              },
              {
                who: "Forwarding",
                tone: "result",
                short: <>Laptop already known on <Mono>{fa01}</Mono>: known unicast, no flood.</>,
                body: (
                  <>
                    SW1 already knew the Laptop on <Mono>{fa01}</Mono> (from the request), so it forwarded the reply as <b className="text-pv-text">known unicast</b> — no flooding.
                  </>
                ),
              },
              {
                who: "Laptop",
                short: (
                  <>
                    Cached <Mono>{ADDR.gateway.ip} → {ADDR.gateway.mac}</Mono>.
                  </>
                ),
                body: (
                  <>
                    Received &ldquo;{ADDR.gateway.ip} is at {ADDR.gateway.mac}&rdquo; and stored the gateway in its ARP cache.
                  </>
                ),
              },
            ]}
          />
        </Section>
        <Section label="What changed">
          <DeltaChips lab={lab} />
        </Section>
        {reply && <Verdict correct={reply === "bb-fa02"}>Your reply prediction: SW1 learned {ADDR.gateway.mac} → {fa02}, from the reply&apos;s source MAC.</Verdict>}
        <KeyLesson>
          The switch learned R1 from the <b>Ethernet source address</b>. The Laptop learned R1&apos;s IP-to-MAC mapping from the <b>ARP payload</b>. Different learning mechanisms.
        </KeyLesson>
        <EngineerCheck
          intro="Prove the result on the live network:"
          inspected={inspected}
          onShowLaptop={onShowLaptop}
          facts={[
            { key: "2:switch:mac-table", text: "SW1 now knows both MAC addresses", confirmed: `SW1 knows the Laptop on ${fa01} and R1 on ${fa02}.` },
            { key: "2:laptop:view", text: "Laptop now knows the gateway MAC", confirmed: `The Laptop maps ${ADDR.gateway.ip} → ${ADDR.gateway.mac}.`, laptop: true },
            { key: "2:router:arp-table", text: "R1 still knows the Laptop mapping", confirmed: `R1 still maps ${ADDR.laptop.ip} → ${ADDR.laptop.mac}.` },
          ]}
        />
        <Choice
          id="t3-dst-mac"
          prompt={`The Laptop now sends to ${ARP_LAB_REMOTE_DESTINATION}. Which Ethernet destination MAC should the frame use?`}
          options={[
            { id: "gw", label: `${ADDR.gateway.mac} — R1, the default gateway` },
            { id: "server", label: "The Server's own MAC" },
            { id: "bcast", label: "FF:FF:FF:FF:FF:FF" },
            { id: "self", label: `${ADDR.laptop.mac} — the Laptop` },
          ]}
          challenges={challenges}
          onAnswer={onAnswer}
        />
        <Next>{dst ? "Build and send the real frame." : "Answer the prediction to unlock Send IP Frame."}</Next>
        {deepen([
          { q: "Why is the ARP Reply unicast?", a: <>Only one device asked, and the request already told R1 the asker&apos;s MAC. Broadcasting the answer would disturb every host for nothing.</> },
          { q: "Why could SW1 forward it without flooding?", a: <>The request taught SW1 that {ADDR.laptop.mac} lives behind {fa01}. A known destination MAC means one egress port.</> },
        ])}
      </Board>
    );
  }

  // ---------------------------------------------------------------- T3
  const dst = challenges.answers["t3-dst-mac"]?.[0];
  const frameRows = (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-pv-border bg-black/25 p-2.5 text-[12px]">
      <dt className="text-pv-text-faint">IPv4 destination</dt>
      <dd>
        <Mono>{ARP_LAB_REMOTE_DESTINATION}</Mono> <span className="text-pv-text-muted">— Server</span>
      </dd>
      <dt className="text-pv-text-faint">Ethernet destination</dt>
      <dd>
        <Mono>{ADDR.gateway.mac}</Mono> <span className="text-pv-text-muted">— R1 / default gateway</span>
      </dd>
    </dl>
  );

  if (!lab.ipFrameDelivered)
    return (
      <Board phase="T3 · Resolved" title="ARP resolved — now build the real frame" summary="The Laptop finally has everything it needs at Layer 2.">
        {dst && <Verdict correct={dst === "gw"}>The Ethernet destination is the gateway {ADDR.gateway.mac}, not the Server&apos;s MAC.</Verdict>}
        <Section label="The frame">{frameRows}</Section>
        <KeyLesson>
          The <b>destination IP</b> identifies the final endpoint. The <b>destination MAC</b> identifies the next hop on the current Ethernet segment.
        </KeyLesson>
        <Next>{inFlight ? "Watch SW1's lookup." : "Send IP Frame and watch how SW1 forwards it."}</Next>
        {deepen([
          { q: "Why is the Server IP paired with the Router MAC?", a: <>IP addresses are end to end; MAC addresses are hop by hop. The frame only has to reach R1 on this segment — R1 then builds a new frame for the next one.</> },
          { q: "What would R1 do if it didn't know the Server's MAC?", a: <>ARP on its own directly connected segment ({SUBNETS.server.network}) before forwarding — the same process, one hop further.</> },
        ])}
      </Board>
    );

  return (
    <Board phase="Lab complete" title="What each device learned" summary="The first IP frame reached R1 through SW1 — no broadcast needed.">
      <Section label="What happened">
        <EventRows
          rows={[
            {
              who: "SW1 lookup",
              tone: "result",
              body: (
                <>
                  <Mono>{ADDR.gateway.mac} → {fa02}</Mono> — <b className="text-pv-text">KNOWN UNICAST</b>, out one port only.
                </>
              ),
            },
            { who: "R1", body: <>Accepted the frame. Gateway ARP goal complete: R1 now owns the next forwarding decision on <Mono>{SUBNETS.server.network}</Mono> (ARPing there itself if it doesn&apos;t know the Server&apos;s MAC).</> },
          ]}
        />
      </Section>
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { who: "Laptop", fact: `${ADDR.gateway.ip} → Router MAC`, kind: "IP → MAC" },
          { who: "Router", fact: `${ADDR.laptop.ip} → Laptop MAC`, kind: "IP → MAC" },
          { who: "Switch", fact: `Laptop MAC → ${fa01} · Router MAC → ${fa02}`, kind: "MAC → PORT" },
        ].map((d) => (
          <div key={d.who} className="rounded-xl border border-pv-success/35 bg-pv-success/[0.05] p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text">{d.who}</p>
            <p className="mt-0.5 pv-mono text-[11px] text-pv-text-muted">{d.fact}</p>
            <p className="mt-1 pv-mono text-[10px] font-bold text-pv-success">{d.kind}</p>
          </div>
        ))}
      </div>
      <KeyLesson>
        <p>
          ARP answers: <i>which MAC owns this local IPv4 address?</i> The switch MAC table answers: <i>which switch port leads to this MAC?</i>
        </p>
        <p className="mt-1 text-[12px] text-pv-text-muted">The remote Server IP remained the packet&apos;s final Layer-3 destination the whole time.</p>
      </KeyLesson>
      <EngineerCheck
        intro="One last proof:"
        inspected={inspected}
        onShowLaptop={onShowLaptop}
        facts={[{ key: "3:switch:mac-table", text: "Find the entry that let SW1 use a single port", confirmed: `SW1's MAC table maps ${ADDR.gateway.mac} → ${fa02} — that's why it didn't flood.` }]}
      />
      <Next>Reset Lab to run it again, or return to the lesson.</Next>
      {deepen([
        { q: "Why is the Server IP paired with the Router MAC?", a: <>IP addresses are end to end; MAC addresses are hop by hop. R1 now builds a fresh Ethernet header for the next segment.</> },
        { q: "What would R1 do if it didn't know the Server's MAC?", a: <>ARP on {SUBNETS.server.network} first — this lab stops at R1 rather than pretending R1 already knew it.</> },
      ])}
    </Board>
  );
}
