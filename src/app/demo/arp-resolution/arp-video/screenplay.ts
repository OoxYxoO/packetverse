import { createArpNet, planArp, HOSTS, R1_IFS, type ArpFrame, type ArpPlan, type CacheOwner } from "@/lib/sim-engine/scenarios/arpNet";
import type { CamKey, Spot } from "./world";

/**
 * THE ARP INTERACTIVE VIDEO — the screenplay (pure data, no React).
 *
 * The video is a list of narrated LINES. Each line is one sentence or two of narration (one audio clip) and the
 * SHOT the viewer sees while it's spoken. A shot carries over from line to line and only changes where a line says
 * so; changes can also be timed INSIDE a line with [[cue]] markers placed at the words they belong to (the marker's
 * position in the sentence sets when it fires while the voice reads it).
 *
 * After some lines the video stops on a QUESTION. Every option has its own narrated feedback lines with their own
 * shots (a short visual correction for wrong answers), then the main story resumes.
 *
 * Source of truth: every frame, MAC, cache entry and switch decision shown comes from the ARP Lab's model
 * (arpNet.planArp) — the screenplay only chooses which wave/state to show and what to say about it.
 */

// ---------------------------------------------------------------------------------------------------------------
// The network story, simulated by the lab's own model
// ---------------------------------------------------------------------------------------------------------------
export type PlanId = "start" | "local" | "again" | "mid" | "remote";
const s0 = createArpNet();
const local = planArp(s0, { type: "ping", src: "laptop", dst: HOSTS.pcb.cfg.ip });
const again = planArp(local.snaps[local.snaps.length - 1], { type: "ping", src: "laptop", dst: HOSTS.pcb.cfg.ip });
const remote = planArp(again.snaps[again.snaps.length - 1], { type: "ping", src: "laptop", dst: HOSTS.server.cfg.ip });
const still = (s: ArpPlan["snaps"][number], label: string): ArpPlan => ({ run: s.run, label, waves: [], snaps: [s] });
export const PLANS: Record<PlanId, ArpPlan> = {
  start: still(s0, "fresh network"),
  local,
  again,
  mid: still(again.snaps[again.snaps.length - 1], "before the Server ping"),
  remote,
};
export const waveFrame = (plan: PlanId, wave: number): ArpFrame => PLANS[plan].waves[wave].copies[0].frame;
export const LAPTOP = HOSTS.laptop;
export const PCB = HOSTS.pcb;
export const SERVER = HOSTS.server;
export const GW = R1_IFS.gi0;

/** What each receiver of a request did, from the model's own captures. */
export function requestVerdicts(plan: PlanId, wave: number): Mark[] {
  const p = PLANS[plan];
  const f = waveFrame(plan, wave);
  const last = p.snaps[p.snaps.length - 1];
  return last.captures
    .filter((c) => c.dir === "in" && c.dev !== "sw1" && c.frame.id === f.id && c.run === p.run)
    .map((c): Mark => (/that's me/.test(c.note ?? "") ? { at: c.dev as Spot, text: "That's me!", tone: "ok" } : { at: c.dev as Spot, text: "Not my IP", tone: "no" }));
}

// ---------------------------------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------------------------------
export interface Mark {
  at: Spot;
  text: string;
  tone: "ok" | "no" | "ask" | "say" | "info";
}
/** Frames travelling, taken from a plan's waves (one after another). */
export interface Flow {
  plan: PlanId;
  waves: number[];
  /** Freeze the last wave at its arrival (a frame waiting at a device). */
  hold?: boolean;
  /** ms per wave. */
  ms?: number;
}
export type Fx =
  | "ripple" // the broadcast spreading across the LAN from the switch
  | "ripple-wall" // a broadcast that hits the walls of the LAN and stops there
  | "shout" // the newcomer's question spreading through the office
  | "reply-beam" // one-to-one line from the replier to the asker
  | "names" // office name tags visible
  | "faces" // office: question marks over the strangers' heads
  | "desks" // office: desk-number plates (desk = MAC address)
  | "look" // office: everyone turns to look at the person asking
  | "hand" // office: Sam raises a hand
  | "shrug" // office: the others shrug — not their name
  | "note" // the newcomer holds the note "for Sam"
  | "write" // the newcomer writes the sticky note (animated)
  | "sticky" // the sticky note "Sam → desk 20"
  | "messenger" // office: a messenger carries a letter from the front desk to another building
  | "far-letter" // office: a letter for another building, taken to the front desk
  | "macs" // network: MAC chips under the devices (the desk numbers, transformed)
  | "lan-glow" // network: the local network's boundary lights up (the room)
  | "dim-others" // everything but the highlighted elements dims
  | "ports" // switch port numbers visible
  | "server-x"; // the Server marked unreachable for ARP
export interface Arrow {
  from: Spot;
  to: Spot;
  label: string;
  tone: "ip" | "mac" | "intent";
}
export type Card =
  | { k: "id"; dev: "laptop" | "pcb" }
  | { k: "frame"; plan: PlanId; wave: number; stage?: "ip" | "eth" | "full"; mask?: boolean; glow?: ("dstMac" | "dstIp" | "srcMac" | "srcIp" | "question" | "target")[]; check?: ("dstIp" | "srcMac")[] }
  | { k: "memory"; owner: CacheOwner; plan: PlanId; snap: number; ask?: string; table?: boolean; sticky?: boolean }
  | { k: "swmem"; plan: PlanId; snap: number }
  | { k: "map"; n: number }
  | { k: "bvu" }
  | { k: "race"; second: boolean }
  | { k: "compare" }
  | { k: "rebuild"; phase: 0 | 1 | 2 | 3 }
  | { k: "recap"; n: number }
  | { k: "note" };
export interface Shot {
  skin: "office" | "net";
  cam: CamKey;
  /** The Server's network is visible. */
  far: boolean;
  hi: Spot[];
  ips: Spot[];
  marks: Mark[];
  flow: Flow | null;
  fx: Fx[];
  arrows: Arrow[];
  cards: Card[];
}
export type ShotPatch = Partial<Shot>;

export const BASE_SHOT: Shot = { skin: "office", cam: "lan", far: false, hi: [], ips: [], marks: [], flow: null, fx: [], arrows: [], cards: [] };

// ---------------------------------------------------------------------------------------------------------------
// Lines and questions
// ---------------------------------------------------------------------------------------------------------------
export interface Line {
  id: string;
  /** Caption text. [[cue]] markers time shot changes to the words that follow them. */
  text: string;
  /** What the voice says, when it differs from the caption (numbers, abbreviations). Same [[cue]] markers. */
  say?: string;
  shot?: ShotPatch;
  cues?: Record<string, ShotPatch>;
  /** Extra time after the voice ends (lets an animation finish). */
  hold?: number;
  question?: Question;
  chapter?: string;
}
export interface Option {
  id: string;
  label: string;
  lines: Line[];
}
export interface Question {
  id: string;
  prompt: string;
  say?: string;
  kind: "choice" | "device";
  options: Option[];
  answer: string;
  /** Short label for the recap. */
  topic: string;
  /** On a phone, what stays visible above the question: the card, or the picture. */
  needs: "card" | "scene";
}

// ---------------------------------------------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------------------------------------------
const F = (wave: number, x: Omit<Extract<Card, { k: "frame" }>, "k" | "plan" | "wave"> = {}, plan: PlanId = "local"): Card => ({ k: "frame", plan, wave, ...x });
const fb = (id: string, text: string, shot?: ShotPatch, extra: Partial<Line> = {}): Line => ({ id, text, shot, ...extra });

export const LINES: Line[] = [
  // ================================================================ the office: a problem first
  {
    id: "o1",
    chapter: "A question for the whole room",
    text: "Imagine it's your first day in a new office.",
    shot: { skin: "office", cam: "lan", hi: ["laptop"], fx: ["faces", "desks"] },
    hold: 300,
  },
  {
    id: "o2",
    text: "Your manager walks over and hands you [[note]]a note. It says: please give this to Sam.",
    say: "Your manager walks over and hands you [[note]]a note. It says: please give this to Sam.",
    cues: { note: { fx: ["faces", "desks", "note"], cam: "laptop" } },
  },
  {
    id: "o3",
    text: "Easy, right? Except [[faces]]you've never met Sam. You know the name. But which of these people is Sam? And which desk?",
    say: "Easy, right? Except [[faces]]you've never met Sam. You know the name. But which of these people is Sam? And which desk?",
    cues: { faces: { cam: "lan", hi: ["pcb", "pcc", "r1"] } },
    hold: 400,
  },
  {
    id: "o4",
    text: "So what would you do? [[shout]]You could walk desk to desk. Or you could just stand up and ask: “Who's Sam?”",
    say: "So, what would you do? You could walk desk to desk. Or [[shout]]you could just stand up and ask: Who's Sam?",
    shot: { hi: ["laptop"] },
    cues: { shout: { fx: ["faces", "desks", "note", "shout"], marks: [{ at: "laptop", text: "Who's Sam?", tone: "say" }] } },
    hold: 700,
    question: {
      id: "room",
      kind: "choice",
      needs: "scene",
      topic: "Who answers a question to the whole room",
      prompt: "Everyone in the room heard you. Who should answer?",
      say: "Everyone in the room heard you. Who should answer?",
      answer: "sam",
      options: [
        { id: "sam", label: "Only Sam", lines: [fb("room.sam", "Right. Just Sam. Everyone else hears the question, realises it isn't their name, and gets back to work.")] },
        {
          id: "all",
          label: "Everyone",
          lines: [
            fb("room.all.1", "Picture that for a second. [[chaos]]Everyone answering at once? You'd be no closer to finding Sam!", undefined, {
              say: "Picture that for a second. [[chaos]]Everyone answering at once? You'd be no closer to finding Sam.",
              cues: { chaos: { fx: ["faces", "desks", "note", "look"], marks: [{ at: "pcb", text: "Me?", tone: "ask" }, { at: "pcc", text: "Me?", tone: "ask" }, { at: "r1", text: "Me?", tone: "ask" }] } },
            }),
            fb("room.all.2", "Everyone hears the question. [[only]]But only the person with that name answers.", undefined, { cues: { only: { marks: [], hi: ["pcb"] } } }),
          ],
        },
        {
          id: "near",
          label: "Whoever is closest",
          lines: [fb("room.near", "I see the logic: the closest person is easy to reach. [[only]]But they're not Sam, and your note would land on the wrong desk. Only Sam answers.", undefined, { cues: { only: { hi: ["pcb"] } } })],
        },
      ],
    },
  },
  {
    id: "o5",
    text: "[[look]]Heads turn. [[shrug]]Priya shakes her head: not her name. The front desk shrugs too. [[hand]]And Sam raises a hand: “That's me. Desk twenty.”",
    say: "[[look]]Heads turn. [[shrug]]Priya shakes her head, not her name. The front desk shrugs too. [[hand]]And Sam raises a hand. That's me. Desk twenty.",
    shot: { fx: ["faces", "desks", "note"], marks: [], hi: [] },
    cues: {
      look: { fx: ["faces", "desks", "note", "look"] },
      shrug: { fx: ["faces", "desks", "note", "look", "shrug"], marks: [{ at: "pcc", text: "Not me", tone: "no" }, { at: "r1", text: "Not me", tone: "no" }] },
      hand: { fx: ["names", "desks", "note", "look", "shrug", "hand"], hi: ["pcb"], marks: [{ at: "pcc", text: "Not me", tone: "no" }, { at: "r1", text: "Not me", tone: "no" }, { at: "pcb", text: "That's me! Desk 20", tone: "ok" }] },
    },
  },
  {
    id: "o6",
    text: "Notice something nice: Sam doesn't shout back. [[beam]]Sam saw exactly who asked, so the answer comes straight to you.",
    say: "Notice something nice here. Sam doesn't shout back. [[beam]]Sam saw exactly who asked, so the answer comes straight to you.",
    shot: { fx: ["names", "desks", "note", "hand"], marks: [{ at: "pcb", text: "Desk 20", tone: "ok" }], hi: ["pcb", "laptop"] },
    cues: { beam: { fx: ["names", "desks", "note", "hand", "reply-beam", "dim-others"] } },
  },
  {
    id: "o7",
    text: "And because you're smart, [[write]]you write it down. Sam, desk twenty. Next time, no shouting: you'll walk straight there.",
    say: "And because you're smart, [[write]]you write it down. Sam, desk twenty. Next time, no shouting. You'll walk straight there.",
    shot: { fx: ["names", "desks"], marks: [], hi: ["laptop"], cam: "laptop" },
    cues: { write: { fx: ["names", "desks", "write", "sticky"] } },
    hold: 300,
  },

  // ================================================================ the same problem, inside a computer
  {
    id: "o8",
    chapter: "From the office to the network",
    text: "Hold on to that little story. Your computer runs into almost exactly the same problem, many times a day. [[morph]]Watch.",
    say: "Hold on to that little story. Because your computer runs into almost exactly the same problem, many times a day. [[morph]]Watch.",
    shot: { cam: "lan", hi: [], fx: ["names", "desks", "sticky"] },
    cues: { morph: { skin: "net", fx: ["macs"], ips: ["laptop", "pcb", "pcc", "r1"], cards: [] } },
    hold: 900,
  },
  {
    id: "o9",
    text: "[[tags]]The name tags turn into IP addresses. [[desks]]The desk numbers turn into MAC addresses. [[room]]And the room becomes your local network.",
    say: "[[tags]]The name tags turn into IP addresses. [[desks]]The desk numbers turn into MAC addresses. [[room]]And the room becomes your local network.",
    cues: {
      tags: { cards: [{ k: "map", n: 1 }], fx: [], hi: ["laptop", "pcb", "pcc", "r1"] },
      desks: { cards: [{ k: "map", n: 2 }], fx: ["macs"], hi: ["laptop", "pcb", "pcc", "r1"] },
      room: { cards: [{ k: "map", n: 2 }], fx: ["macs", "lan-glow"], hi: [] },
    },
  },
  {
    id: "o10",
    text: "The trick your computer uses to find the right desk is called [[arp]]ARP. And it works just like you did: [[m3]]ask everyone, [[m4]]only the owner answers, [[m5]]and write it down.",
    say: "The trick your computer uses to find the right desk is called [[arp]]ARP. And it works just like you did. [[m3]]Ask everyone. [[m4]]Only the owner answers. [[m5]]And write it down.",
    shot: { fx: ["macs"], ips: ["laptop", "pcb", "pcc", "r1"] },
    cues: { arp: { cards: [{ k: "map", n: 2 }] }, m3: { cards: [{ k: "map", n: 3 }] }, m4: { cards: [{ k: "map", n: 4 }] }, m5: { cards: [{ k: "map", n: 5 }] } },
  },
  {
    id: "o11",
    text: "One more thing to keep in your head. [[wall]]A question asked in this room stays in this room. We'll need that later.",
    say: "One more thing to keep in your head. [[wall]]A question asked in this room stays in this room. We'll need that later.",
    shot: { fx: [], ips: [] },
    cues: { wall: { fx: ["ripple-wall"], cards: [{ k: "map", n: 5 }] } },
    hold: 700,
  },

  // ================================================================ the missing address
  {
    id: "n1",
    chapter: "The missing address",
    text: "Okay. Let's make it real. [[ping]]The Laptop wants to send a ping to PC-B, at 192.168.10.20.",
    say: "Okay. Let's make it real. [[ping]]The laptop wants to send a ping to PC-B, at one ninety-two dot one sixty-eight dot ten dot twenty.",
    shot: { skin: "net", cam: "laptop-pcb", cards: [], fx: [], hi: ["laptop", "pcb"], ips: [] },
    cues: { ping: { ips: ["laptop", "pcb"], arrows: [{ from: "laptop", to: "pcb", label: "ping", tone: "intent" }] } },
  },
  {
    id: "n2",
    text: "Look at what the Laptop knows right now. [[ip]]It knows PC-B's IP address. So it starts building the packet: from me, to dot twenty.",
    say: "Look at what the laptop knows right now. [[ip]]It knows PC-B's IP address. So it starts building the packet. From me, to dot twenty.",
    shot: { cam: "laptop", hi: ["laptop"], arrows: [] },
    cues: { ip: { cards: [F(4, { stage: "ip", glow: ["dstIp"] })] } },
  },
  {
    id: "n3",
    text: "But here's the catch. On a local network, that packet travels inside [[eth]]an Ethernet frame. And Ethernet doesn't deliver to IP addresses. [[mac]]It delivers to MAC addresses.",
    say: "But here's the catch. On a local network, that packet travels inside [[eth]]an Ethernet frame. And Ethernet doesn't deliver to IP addresses, [[mac]]it delivers to MAC addresses.",
    cues: { eth: { cards: [F(4, { stage: "eth", mask: true })] }, mac: { cards: [F(4, { stage: "eth", mask: true, glow: ["dstMac"] })] } },
  },
  {
    id: "n4",
    text: "So the Laptop already knows where this is going. [[stuck]]Why can't it just send it?",
    say: "So, the laptop already knows where this is going. [[stuck]]Why can't it just send it?",
    cues: { stuck: { cards: [F(4, { stage: "eth", mask: true, glow: ["dstMac", "dstIp"] })] } },
    hold: 300,
    question: {
      id: "missing",
      kind: "choice",
      needs: "card",
      topic: "What the Laptop is missing",
      prompt: "What is the Laptop missing?",
      say: "What is the laptop missing?",
      answer: "mac",
      options: [
        {
          id: "mac",
          label: "PC-B's MAC address",
          lines: [fb("missing.mac", "You've got it. [[ip]]The IP is there, [[mac]]but the destination MAC is empty. That's the desk number we still need.", undefined, {
            say: "You've got it. [[ip]]The IP is there, [[mac]]but the destination MAC is empty. That's the desk number we still need.",
            cues: { ip: { cards: [F(4, { stage: "eth", mask: true, check: ["dstIp"] })] }, mac: { cards: [F(4, { stage: "eth", mask: true, check: ["dstIp"], glow: ["dstMac"] })] } },
          })],
        },
        {
          id: "ip",
          label: "PC-B's IP address",
          lines: [
            fb("missing.ip.1", "Not quite, but I see why you picked that. Look here: [[ip]]the destination IP is already filled in. 192.168.10.20.", undefined, {
              say: "Not quite, but I see why you picked that. Look here. [[ip]]The destination IP is already filled in. Dot twenty.",
              cues: { ip: { cards: [F(4, { stage: "eth", mask: true, check: ["dstIp"] })] } },
            }),
            fb("missing.ip.2", "What's missing is [[mac]]this field: the MAC address Ethernet needs. The name is known. The desk isn't.", undefined, {
              say: "What's missing is [[mac]]this field. The MAC address Ethernet needs. The name is known. The desk isn't.",
              cues: { mac: { cards: [F(4, { stage: "eth", mask: true, check: ["dstIp"], glow: ["dstMac"] })] } },
            }),
          ],
        },
        {
          id: "own",
          label: "Its own MAC address",
          lines: [fb("missing.own", "Close, but look at the source field: [[src]]the Laptop's own MAC is already there. It's burned into its network card. [[dst]]What's missing is the other end: PC-B's MAC.", undefined, {
            say: "Close, but look at the source field. [[src]]The laptop's own MAC is already there. It's burned into its network card. [[dst]]What's missing is the other end. PC-B's MAC.",
            cues: { src: { cards: [F(4, { stage: "eth", mask: true, check: ["srcMac"] })] }, dst: { cards: [F(4, { stage: "eth", mask: true, check: ["srcMac"], glow: ["dstMac"] })] } },
          })],
        },
        {
          id: "none",
          label: "Nothing: the IP address is enough",
          lines: [
            fb("missing.none.1", "That's a really common assumption. [[sw]]But the switch only reads MAC addresses. An IP address alone means nothing to it.", { cam: "lan", hi: ["sw1"] }, {
              cues: { sw: { marks: [{ at: "sw1", text: "I only read MACs", tone: "info" }] } },
            }),
            fb("missing.none.2", "So without PC-B's MAC, [[mac]]this frame simply can't leave.", { cam: "laptop", marks: [], hi: ["laptop"] }, {
              cues: { mac: { cards: [F(4, { stage: "eth", mask: true, glow: ["dstMac"] })] } },
            }),
          ],
        },
      ],
    },
  },

  // ================================================================ asking everyone
  {
    id: "n5",
    chapter: "Asking everyone",
    text: "So we're right back in the office: name known, desk unknown. First, [[mem]]the Laptop checks its own notes. Its ARP cache.",
    say: "So we're right back in the office. Name known, desk unknown. First, [[mem]]the laptop checks its own notes. Its ARP cache.",
    shot: { cam: "laptop", hi: ["laptop"], cards: [] },
    cues: { mem: { cards: [{ k: "memory", owner: "laptop", plan: "start", snap: 0, ask: PCB.cfg.ip, sticky: true }] } },
  },
  {
    id: "n6",
    text: "Anything for dot twenty? Nope. Empty. These two have never talked before.",
    say: "Anything for dot twenty? Nope. Empty. These two have never talked before.",
    hold: 200,
  },
  {
    id: "n7",
    text: "So the Laptop does just what you did. [[ask]]It asks the room. That question is called an ARP Request: “Who has 192.168.10.20? Tell 192.168.10.10.”",
    say: "So the laptop does just what you did. [[ask]]It asks the room. That question is called an ARP request. Who has dot twenty? Tell dot ten.",
    cues: { ask: { cards: [F(0, { mask: true, glow: ["question"] })], marks: [{ at: "laptop", text: "Who has .20?", tone: "say" }] } },
  },
  {
    id: "n8",
    text: "Now, here's an interesting little problem. [[to]]Who should this frame be addressed to?",
    say: "Now, here's an interesting little problem. [[to]]Who should this frame be addressed to?",
    cues: { to: { cards: [F(0, { mask: true, glow: ["dstMac"] })] } },
    hold: 200,
    question: {
      id: "bcast",
      kind: "choice",
      needs: "card",
      topic: "Why the request is a broadcast",
      prompt: "It doesn't know PC-B's MAC yet. Which destination MAC goes on the ARP Request?",
      say: "It doesn't know PC-B's MAC yet. So which destination MAC goes on the ARP request?",
      answer: "ff",
      options: [
        { id: "ff", label: "FF:FF:FF:FF:FF:FF: everyone (broadcast)", lines: [fb("bcast.ff", "That's it: the broadcast address. [[all]]All F's means: everyone on this network. That's your “Who's Sam?” to the whole room.", undefined, { say: "That's it, the broadcast address. [[all]]All F's means, everyone on this network. That's your Who's Sam, to the whole room.", cues: { all: { cards: [F(0, { glow: ["dstMac"] })] } } })] },
        {
          id: "pcb",
          label: "02:AA:00:00:00:20: PC-B's MAC",
          lines: [fb("bcast.pcb", "Careful: that's the very address we're trying to find! We can't use it yet. When you don't know who to ask, [[all]]you ask everyone: all F's.", undefined, { say: "Careful. That's the very address we're trying to find. We can't use it yet. When you don't know who to ask, [[all]]you ask everyone. All F's.", cues: { all: { cards: [F(0, { glow: ["dstMac"] })] } } })],
        },
        {
          id: "zero",
          label: "00:00:00:00:00:00: all zeros",
          lines: [
            fb("bcast.zero", "Good eye: zeros do appear, [[inside]]but inside the request, in the target field. They mean “please fill this in”. As a destination they'd reach nobody. [[all]]The frame goes to all F's.", undefined, {
              say: "Good eye. Zeros do appear, [[inside]]but inside the request, in the target field. They mean: please fill this in. As a destination, they'd reach nobody. [[all]]The frame goes to all F's.",
              cues: { inside: { cards: [F(0, { mask: true, glow: ["target"] })] }, all: { cards: [F(0, { glow: ["dstMac"] })] } },
            }),
          ],
        },
      ],
    },
  },
  {
    id: "n9",
    text: "Let's follow it. [[go]]Keep your eye on the switch.",
    shot: { cam: "lan", cards: [], marks: [], hi: [], fx: ["ports"], flow: null },
    cues: { go: { flow: { plan: "local", waves: [0] } } },
    hold: 1300,
  },
  {
    id: "n10",
    text: "The frame arrives on port one. [[bc]]The switch reads the destination: everyone.",
    say: "The frame arrives on port one. [[bc]]The switch reads the destination. Everyone.",
    shot: { cam: "switch", flow: { plan: "local", waves: [0], hold: true }, hi: ["sw1"] },
    cues: { bc: { marks: [{ at: "sw1", text: "To: everyone", tone: "say" }] } },
    question: {
      id: "flood",
      kind: "choice",
      needs: "scene",
      topic: "What a switch does with a broadcast",
      prompt: "What does the switch do with a broadcast?",
      answer: "flood",
      options: [
        { id: "flood", label: "Copy it out of every other port", lines: [fb("flood.flood", "Right. Every port except the one it came in on. Now watch it happen.")] },
        { id: "pcb", label: "Send it only to PC-B", lines: [fb("flood.pcb", "That would be handy, wouldn't it? But the switch never reads the question inside, and the destination literally says “everyone”. So it copies the frame out of every other port.", undefined, { say: "That would be handy, wouldn't it? But the switch never reads the question inside. And the destination literally says: everyone. So it copies the frame out of every other port." })] },
        { id: "all", label: "Copy it out of every port, back to the Laptop too", lines: [fb("flood.all", "Almost. Every port except one. [[back]]The Laptop sent it, so it doesn't need its own question back.", undefined, { cues: { back: { hi: ["laptop"] } } })] },
      ],
    },
  },
  {
    id: "n11",
    text: "[[out]]There it goes. PC-B, PC-C and the router all get a copy. That's a broadcast: one sender, everyone listening.",
    say: "[[out]]And there it goes. PC-B, PC-C, and the router, all get a copy. That's a broadcast. One sender, everyone listening.",
    shot: { cam: "lan", marks: [], hi: [], flow: null },
    cues: { out: { flow: { plan: "local", waves: [1] }, fx: ["ports", "ripple"] } },
    hold: 500,
  },
  {
    id: "n12",
    text: "And here's something you might miss. [[sw]]The switch just learned where the Laptop lives: port one. It read the sender's address on the way in.",
    say: "And here's something you might miss. [[sw]]The switch just learned where the laptop lives. Port one. It read the sender's address on the way in.",
    shot: { cam: "switch", flow: { plan: "local", waves: [1], hold: true }, fx: ["ports"], hi: ["sw1"] },
    cues: { sw: { cards: [{ k: "swmem", plan: "local", snap: 1 }] } },
  },
  {
    id: "n13",
    text: "Three devices are now holding the same question. Remember the office: heads turned. Who's going to raise a hand?",
    say: "Three devices are now holding the same question. Remember the office? Heads turned. So who's going to raise a hand?",
    shot: { cam: "receivers", cards: [], hi: [], flow: null, marks: [{ at: "pcb", text: "?", tone: "ask" }, { at: "pcc", text: "?", tone: "ask" }, { at: "r1", text: "?", tone: "ask" }] },
    question: {
      id: "owner",
      kind: "device",
      needs: "scene",
      topic: "Who answers an ARP Request",
      prompt: "Who answers? Tap the device that replies.",
      answer: "pcb",
      options: [
        { id: "pcb", label: "PC-B", lines: [fb("owner.pcb", "Yes, PC-B. The only one whose address is dot twenty. That's Sam raising a hand.")] },
        { id: "pcc", label: "PC-C", lines: [fb("owner.pcc", "Like Priya in the office: PC-C heard it, [[ip]]but it's dot thirty, not dot twenty. So it stays quiet. PC-B answers.", undefined, { say: "Like Priya in the office. PC-C heard it, [[ip]]but it's dot thirty, not dot twenty. So it stays quiet. PC-B answers.", cues: { ip: { ips: ["pcc", "pcb"] } } })] },
        { id: "r1", label: "R1", lines: [fb("owner.r1", "The router heard it too. [[ip]]But its address here is dot one, and it only answers for its own addresses. PC-B answers.", undefined, { cues: { ip: { ips: ["r1", "pcb"] } } })] },
      ],
    },
  },

  // ================================================================ the answer
  {
    id: "n14",
    chapter: "The answer",
    text: "[[v]]PC-C and the router ignore it. PC-B recognises its own address.",
    shot: { marks: [], flow: null },
    cues: { v: { marks: requestVerdicts("local", 1) } },
  },
  {
    id: "n15",
    text: "And here's a detail people often miss. [[mem]]Before answering, PC-B writes down who asked. The Laptop's IP and MAC were right there in the request.",
    say: "And here's a detail people often miss. [[mem]]Before answering, PC-B writes down who asked. The laptop's IP and MAC were right there in the request.",
    shot: { cam: "pcb", hi: ["pcb"], marks: [{ at: "pcb", text: "That's me!", tone: "ok" }] },
    cues: { mem: { cards: [{ k: "memory", owner: "pcb", plan: "local", snap: 2, sticky: true }] } },
  },
  {
    id: "n16",
    text: "Now PC-B replies. And it knows exactly who asked.",
    say: "Now PC-B replies. And remember, it knows exactly who asked.",
    shot: { cam: "pcb-laptop", cards: [], marks: [], hi: ["pcb", "laptop"] },
    question: {
      id: "unicast",
      kind: "choice",
      needs: "scene",
      topic: "Why the reply is unicast",
      prompt: "So how does PC-B send the ARP Reply?",
      say: "So how does PC-B send the ARP reply?",
      answer: "uni",
      options: [
        { id: "uni", label: "Straight to the Laptop, and only the Laptop", lines: [fb("unicast.uni", "Exactly. One to one. No need to bother the whole room.")] },
        {
          id: "bc",
          label: "To everyone, like the request",
          lines: [fb("unicast.bc", "That would make sense if PC-B didn't know who asked. [[learned]]But it just wrote the Laptop down. So it answers directly: one to one, just like Sam.", undefined, {
            cues: { learned: { cards: [{ k: "memory", owner: "pcb", plan: "local", snap: 2, sticky: true }] } },
          })],
        },
        { id: "sw", label: "To the switch, which passes it on", lines: [fb("unicast.sw", "Frames aren't addressed to the switch; it just passes them along. PC-B sends the reply straight to the Laptop's MAC.")] },
      ],
    },
  },
  {
    id: "n17",
    text: "[[go]]“Dot twenty is at this MAC.” Can you see the difference? [[cmp]]The request went to everyone. The reply goes to just one.",
    say: "[[go]]Dot twenty is at this MAC. Can you see the difference? [[cmp]]The request went to everyone. The reply goes to just one.",
    shot: { cam: "lan", cards: [], hi: ["pcb", "laptop", "sw1"], fx: ["ports", "dim-others"], flow: null },
    cues: { go: { flow: { plan: "local", waves: [2, 3] }, cards: [F(2)] }, cmp: { cards: [{ k: "bvu" }] } },
    hold: 400,
  },
  {
    id: "n18",
    text: "And the switch? It already knew the Laptop was on port one, [[one]]so this time it used just that port. And it learned PC-B's port on the way.",
    say: "And the switch? It already knew the laptop was on port one, [[one]]so this time, it used just that port. And it learned PC-B's port on the way.",
    shot: { cam: "switch", hi: ["sw1"], fx: ["ports"], flow: { plan: "local", waves: [3], hold: true }, cards: [] },
    cues: { one: { cards: [{ k: "swmem", plan: "local", snap: 3 }] } },
    question: {
      id: "remember",
      kind: "choice",
      needs: "scene",
      topic: "What the Laptop remembers",
      prompt: "The reply reaches the Laptop. What does the Laptop write down?",
      say: "The reply reaches the laptop. What does the laptop write down?",
      answer: "right",
      options: [
        { id: "right", label: "192.168.10.20 is at 02:AA:00:00:00:20", lines: [fb("remember.right", "That's the one. Its sticky note: dot twenty, at PC-B's MAC.")] },
        { id: "self", label: "192.168.10.10 is at 02:AA:00:00:00:01", lines: [fb("remember.self", "Close. That's actually PC-B's note about the Laptop. The Laptop writes down the other side: PC-B's IP, and PC-B's MAC.")] },
        { id: "port", label: "02:AA:00:00:00:20 is on port 3", lines: [fb("remember.port", "That's the switch's kind of memory: MAC to port. [[sw]]The Laptop remembers something different. IP to MAC.", undefined, { cues: { sw: { cards: [{ k: "swmem", plan: "local", snap: 3 }] } } })] },
      ],
    },
  },
  {
    id: "n19",
    text: "So the Laptop writes its note. [[mem]]Dot twenty: this MAC. [[table]]And in networking language, that note is an entry in the ARP cache.",
    say: "So the laptop writes its note. [[mem]]Dot twenty, this MAC. [[table]]And in networking language, that note is an entry in the ARP cache.",
    shot: { cam: "laptop", hi: ["laptop"], flow: null, fx: [], cards: [] },
    cues: { mem: { cards: [{ k: "memory", owner: "laptop", plan: "local", snap: 4, sticky: true }] }, table: { cards: [{ k: "memory", owner: "laptop", plan: "local", snap: 4, table: true }] } },
  },
  {
    id: "n20",
    text: "[[done]]And look: the empty field is filled. The frame is ready to go.",
    say: "[[done]]And look. The empty field is filled. The frame is ready to go.",
    cues: { done: { cards: [F(4, { glow: ["dstMac"] })] } },
  },

  // ================================================================ the real traffic
  {
    id: "n21",
    chapter: "The real traffic",
    text: "Here's the part I want you to remember. ARP was never the message. It only found the desk. [[go]]Now the real ping can leave.",
    say: "Here's the part I want you to remember. ARP was never the message. It only found the desk. [[go]]Now, the real ping can leave.",
    shot: { cam: "lan", cards: [], hi: [], fx: ["ports"] },
    cues: { go: { flow: { plan: "local", waves: [4] } } },
    hold: 1200,
  },
  {
    id: "n22",
    text: "It reaches the switch, [[to]]addressed to PC-B's MAC this time.",
    shot: { cam: "switch", flow: { plan: "local", waves: [4], hold: true }, hi: ["sw1"] },
    cues: { to: { cards: [F(4, { glow: ["dstMac"] })] } },
    question: {
      id: "forward",
      kind: "choice",
      needs: "scene",
      topic: "A known MAC goes out one port",
      prompt: "Where does the switch send it?",
      answer: "p3",
      options: [
        { id: "p3", label: "Only out port 3, to PC-B", lines: [fb("forward.p3", "Right, just port three. The switch learned that when the reply passed through.")] },
        { id: "flood", label: "Out every other port, like the request", lines: [fb("forward.flood", "That was true for the broadcast. [[mem]]But this frame carries a specific MAC, and the switch learned it on port three. So: one port.", undefined, { cues: { mem: { cards: [{ k: "swmem", plan: "local", snap: 4 }] } } })] },
        { id: "r1", label: "To the router", lines: [fb("forward.r1", "PC-B is right here on the same network, so the router isn't involved. Straight out port three.")] },
      ],
    },
  },
  {
    id: "n23",
    text: "[[go]]Out port three, and nowhere else.",
    shot: { cam: "lan", cards: [], hi: [], flow: null, fx: ["ports"] },
    cues: { go: { flow: { plan: "local", waves: [5] } } },
    hold: 900,
  },
  {
    id: "n24",
    text: "And PC-B answers straight away. [[go]]No need to ask: it wrote the Laptop down earlier. Just like Sam knowing where you sit.",
    say: "And PC-B answers straight away. [[go]]No need to ask, it wrote the laptop down earlier. Just like Sam knowing where you sit.",
    cues: { go: { flow: { plan: "local", waves: [6, 7] } } },
    hold: 600,
  },

  // ================================================================ the second time
  {
    id: "n25",
    chapter: "The second time",
    text: "Now let's ping PC-B again. [[race]]Remember that sticky note?",
    say: "Now let's ping PC-B again. [[race]]Remember that sticky note?",
    shot: { cam: "lan", flow: null },
    cues: { race: { cards: [{ k: "race", second: false }] } },
    hold: 300,
  },
  {
    id: "n26",
    text: "[[go]]This is where it pays off. No question, no answer. The ping just goes.",
    say: "[[go]]This is where it pays off. No question. No answer. The ping just goes.",
    cues: { go: { flow: { plan: "again", waves: [0, 1, 2, 3], ms: 900 }, cards: [{ k: "race", second: true }] } },
    hold: 600,
  },
  {
    id: "n27",
    text: "That's why ARP usually happens once, and then the data simply flows. One small caveat: people change desks. So these notes expire after a while, and the Laptop simply asks again.",
    say: "That's why ARP usually happens once, and then the data simply flows. One small caveat. People change desks. So these notes expire after a while, and the laptop simply asks again.",
    shot: { flow: null },
  },

  // ================================================================ leaving the room
  {
    id: "r1",
    chapter: "Leaving the network",
    text: "Okay. Local ARP makes sense. Now let's make it harder. [[far]]What if the destination isn't in this room at all?",
    say: "Okay. Local ARP makes sense. Now let's make it harder. [[far]]What if the destination isn't in this room at all?",
    shot: { cam: "lan", cards: [], flow: null, fx: [] },
    cues: { far: { far: true, cam: "all", hi: ["laptop", "server"], ips: ["server"] } },
  },
  {
    id: "r2",
    text: "The Laptop wants to reach the Server, at 10.20.20.20. It lives on a different network, behind the router.",
    say: "The laptop wants to reach the server, at ten dot twenty dot twenty dot twenty. It lives on a different network, behind the router.",
  },
  {
    id: "r3",
    text: "Quick trip back to the office. [[letter]]Say your note is for Alex, in another building. Would you stand up and shout “Who's Alex?” in here? [[desk]]Of course not. You'd take it to the front desk.",
    say: "Quick trip back to the office. [[letter]]Say your note is for Alex, in another building. Would you stand up in here and shout, who's Alex? [[desk]]Of course not. You'd take it to the front desk.",
    shot: { skin: "office", far: true, cam: "all", hi: [], ips: [], fx: ["names", "desks"] },
    cues: { letter: { fx: ["names", "desks", "far-letter"], hi: ["laptop"] }, desk: { fx: ["names", "desks", "far-letter"], hi: ["r1"], marks: [{ at: "r1", text: "Front desk", tone: "info" }] } },
  },
  {
    id: "r4",
    text: "[[run]]The front desk knows how to get things out of the building. That's their whole job.",
    say: "[[run]]The front desk knows how to get things out of the building. That's their whole job.",
    shot: { marks: [] },
    cues: { run: { fx: ["names", "desks", "messenger"], hi: ["r1", "server"] } },
    hold: 600,
  },
  {
    id: "r5",
    text: "[[net]]The Laptop thinks the same way. [[cmp]]Is 10.20.20.20 on my network? No. So it hands the packet to its front desk: its default gateway, the router.",
    say: "[[net]]The laptop thinks the same way. [[cmp]]Is ten dot twenty dot twenty dot twenty on my network? No. So it hands the packet to its front desk. Its default gateway, the router.",
    shot: { marks: [] },
    cues: { net: { skin: "net", fx: [], hi: ["laptop"] }, cmp: { hi: ["laptop", "r1"], ips: ["laptop", "r1", "server"], marks: [{ at: "laptop", text: "Not my network → gateway", tone: "say" }] } },
  },
  {
    id: "r6",
    text: "It still needs ARP first. And here's where a lot of people go wrong.",
    say: "It still needs ARP first. And here's where a lot of people go wrong.",
    shot: { marks: [] },
    hold: 200,
    question: {
      id: "gateway",
      kind: "choice",
      needs: "scene",
      topic: "Remote destination: ARP for the gateway",
      prompt: "The Laptop needs to send to 10.20.20.20. Whose MAC address does it need?",
      say: "The laptop needs to send to the server. Whose MAC address does it need?",
      answer: "gw",
      options: [
        { id: "gw", label: "The router's: its default gateway", lines: [fb("gateway.gw", "Yes, the front desk. The router. The frame only needs to reach the next stop. The router takes it from there.")] },
        {
          id: "server",
          label: "The Server's",
          lines: [
            fb("gateway.server.1", "That's the most common mix-up with ARP, so I'm glad we're looking at it. Remember: [[wall]]a question asked in this room stays in this room.", { cam: "all", fx: [] }, {
              say: "That's the most common mix-up with ARP, so I'm glad we're looking at it. Remember? [[wall]]A question asked in this room stays in this room.",
              cues: { wall: { fx: ["ripple-wall", "server-x"] } },
            }),
            fb("gateway.server.2", "The broadcast stops at the router. The Server never hears it. And the Laptop doesn't need the Server's MAC anyway: [[gw]]the frame only has to reach the router.", undefined, {
              cues: { gw: { fx: ["server-x"], hi: ["laptop", "r1"] } },
            }),
          ],
        },
        { id: "pcb", label: "PC-B's: it's already in the cache", lines: [fb("gateway.pcb", "That note is for PC-B. A frame with PC-B's MAC goes to PC-B. For anything leaving the network, the Laptop needs the router's MAC.")] },
      ],
    },
  },
  {
    id: "r7",
    text: "[[ask]]“Who has 192.168.10.1?” The question floods the room, [[wall]]and stops at the wall. [[ans]]The router answers, and the Laptop writes another note.",
    say: "[[ask]]Who has dot one? The question floods the room, [[wall]]and stops at the wall. [[ans]]The router answers. And the laptop writes another note.",
    shot: { cam: "all", fx: ["ports"], marks: [], hi: [] },
    cues: {
      ask: { flow: { plan: "remote", waves: [0, 1], ms: 1100 } },
      wall: { flow: { plan: "remote", waves: [0, 1], ms: 1100 }, fx: ["ports", "ripple-wall"] },
      ans: { cam: "laptop-router", flow: { plan: "remote", waves: [2, 3], ms: 1100 }, fx: ["ports"], marks: [{ at: "r1", text: "That's me!", tone: "ok" }], cards: [{ k: "memory", owner: "laptop", plan: "remote", snap: 4, sticky: true }] },
    },
    hold: 600,
    question: {
      id: "two-dest",
      kind: "choice",
      needs: "scene",
      topic: "MAC = next hop, IP = final destination",
      prompt: "The ping is ready to leave for the Server. What does its frame say?",
      say: "Okay, the ping is ready to leave for the server. So, what does its frame say?",
      answer: "right",
      options: [
        { id: "right", label: "MAC: the router · IP: the Server", lines: [fb("two-dest.right", "That's it, and it's the key idea. The MAC says who gets it next. The IP says where it's finally going.")] },
        { id: "server", label: "MAC: the Server · IP: the Server", lines: [fb("two-dest.server", "That's a very natural guess. But the Laptop never learns the Server's MAC, and couldn't use it: a frame only travels inside one network. The MAC points at the router. The IP still points at the Server.", undefined, { say: "That's a very natural guess. But the laptop never learns the server's MAC, and couldn't use it. A frame only travels inside one network. The MAC points at the router. The IP still points at the server." })] },
        { id: "r1", label: "MAC: the router · IP: the router", lines: [fb("two-dest.r1", "Careful: then the router would think the packet was meant for itself. The IP stays the Server, the whole way. Only the MAC points at the router.")] },
      ],
    },
  },
  {
    id: "r8",
    text: "If this feels strange, focus on one thing. [[ip]]IP tells us the final destination. [[mac]]MAC gets the frame to the next device on this network.",
    say: "If this feels strange at first, focus on one thing. [[ip]]IP tells us the final destination. [[mac]]MAC gets the frame to the next device, on this network.",
    shot: { cam: "all", cards: [], marks: [], hi: ["laptop"], flow: null },
    cues: {
      ip: { arrows: [{ from: "laptop", to: "server", label: "IP destination", tone: "ip" }], cards: [{ k: "compare" }], hi: ["laptop", "server"], fx: ["dim-others"] },
      mac: { arrows: [{ from: "laptop", to: "server", label: "IP destination", tone: "ip" }, { from: "laptop", to: "r1", label: "MAC destination", tone: "mac" }], hi: ["laptop", "server", "r1"], fx: ["dim-others"] },
    },
  },

  // ================================================================ through the router
  {
    id: "r9",
    chapter: "Through the router",
    text: "Let's follow the packet together. [[go]]It reaches the router. [[look]]The frame is addressed to the router, so the router opens it, and finds a packet for the Server.",
    say: "Let's follow the packet together. [[go]]It reaches the router. [[look]]The frame is addressed to the router, so the router opens it, and finds a packet for the server.",
    shot: { cam: "laptop-router", arrows: [], cards: [], hi: [], fx: [] },
    cues: { go: { flow: { plan: "remote", waves: [4, 5], ms: 1100 } }, look: { cam: "router", hi: ["r1"], cards: [{ k: "rebuild", phase: 0 }] } },
    hold: 300,
  },
  {
    id: "r10",
    text: "And now the router has the same problem the Laptop had. New network, unknown MAC. [[arp]]So the router asks, too.",
    say: "And now the router has the same problem the laptop had. New network. Unknown MAC. [[arp]]So the router asks, too.",
    shot: { cam: "router-server", hi: ["r1", "server"], flow: null },
    cues: { arp: { flow: { plan: "remote", waves: [6, 7], ms: 1100 }, cards: [{ k: "memory", owner: "r1", plan: "remote", snap: 8, sticky: true }] } },
    hold: 600,
  },
  {
    id: "r11",
    text: "Here's the envelope trick. [[off]]The router throws away the old outer envelope, [[new]]and puts the same letter into a new one, addressed to the Server. [[ttl]]The letter inside doesn't change. Well, almost: its TTL counts down by one.",
    say: "Here's the envelope trick. [[off]]The router throws away the old outer envelope, [[new]]and puts the same letter into a new one, addressed to the server. [[ttl]]The letter inside doesn't change. Well, almost. Its TTL counts down by one.",
    shot: { cam: "router", flow: null, cards: [{ k: "rebuild", phase: 0 }] },
    cues: { off: { cards: [{ k: "rebuild", phase: 1 }] }, new: { cards: [{ k: "rebuild", phase: 2 }] }, ttl: { cards: [{ k: "rebuild", phase: 3 }] } },
  },
  {
    id: "r12",
    text: "[[go]]The Server gets it, and replies. [[home]]The router sends the answer home. Ping successful!",
    say: "[[go]]The server gets it, and replies. [[home]]The router sends the answer home. Ping successful.",
    shot: { cam: "all", cards: [], hi: [] },
    cues: { go: { flow: { plan: "remote", waves: [8, 9], ms: 1000 } }, home: { flow: { plan: "remote", waves: [10, 11], ms: 1000 } } },
    hold: 900,
  },

  // ================================================================ recap
  {
    id: "z1",
    chapter: "Recap",
    text: "So, let's put it together. [[c1]]Check your notes first. [[c2]]Nothing there? Ask the whole room. [[c3]]Only the owner answers, straight to you. [[c4]]And you write it down.",
    say: "So, let's put it all together. [[c1]]Check your notes first. [[c2]]Nothing there? Ask the whole room. [[c3]]Only the owner answers, straight to you. [[c4]]And you write it down.",
    shot: { cam: "lan", far: false, flow: null, arrows: [], cards: [{ k: "recap", n: 0 }] },
    cues: { c1: { cards: [{ k: "recap", n: 1 }] }, c2: { cards: [{ k: "recap", n: 2 }] }, c3: { cards: [{ k: "recap", n: 3 }] }, c4: { cards: [{ k: "recap", n: 4 }] } },
  },
  {
    id: "z2",
    text: "And if the destination is in another building, [[gw]]you don't shout for it. You ask for the front desk, your default gateway, and let it take it from there. That's ARP.",
    say: "And if the destination is in another building, [[gw]]you don't shout for it. You ask for the front desk, your default gateway, and let it take it from there. That's ARP.",
    shot: { cam: "all", far: true },
    cues: { gw: { cards: [{ k: "recap", n: 5 }], hi: ["laptop", "r1"] } },
    hold: 1200,
  },
];

export const QUESTIONS: Question[] = LINES.flatMap((l) => (l.question ? [l.question] : []));
export const CHAPTERS: { name: string; line: number }[] = LINES.flatMap((l, i) => (l.chapter ? [{ name: l.chapter, line: i }] : []));
