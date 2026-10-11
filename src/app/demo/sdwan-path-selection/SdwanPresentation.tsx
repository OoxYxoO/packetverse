"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * SD-WAN path selection — the presentation before the lesson/lab, and the last lesson of the Enterprise path. Builds on
 * the VPN (an encrypted tunnel to the hub, now one over each ISP), BGP (two ISPs) and the Firewall (applications by
 * port and marking): CLIENT — BRANCH — ISP-A / ISP-B — HUB — APP. Measurement, SLA classes, per-application policy,
 * failover, hysteresis, and what to do when no path is good.
 */
type Id = "why" | "two" | "overlay" | "apps" | "measure" | "upgood" | "sla" | "policy" | "steer" | "brown" | "failover" | "recover" | "hyst" | "none" | "strict" | "local" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why SD-WAN", title: "“The link is up” is not “the call works”.", body: <p>A routing table uses a path as long as it is up. A circuit can be up with 160 ms latency and 2 % loss — perfect for a backup, useless for a phone call.</p> },
  { id: "two", chapter: "Why SD-WAN", title: "Two circuits: a business line and a cheap one.", body: <p>The branch has <Bb>ISP-A</Bb> (biz-internet) and <Bb>ISP-B</Bb> (public internet). We want each application on the right one — and to move when one degrades.</p> },
  { id: "overlay", chapter: "Underlay and overlay", title: "A tunnel to the hub over each circuit.", body: <p>The circuits are the <Bb>underlay</Bb>. Over each, the edge keeps an encrypted tunnel to the hub — the <Bb>overlay</Bb>: TUN-A and TUN-B, the VPN lesson twice.</p> },
  { id: "apps", chapter: "Underlay and overlay", title: "Applications, not packets.", body: <p>The edge classifies traffic: <Bb>VOICE</Bb> (UDP, marked DSCP EF) and <Bb>BULK</Bb> (the backup, TCP 873). Each has its own policy.</p> },
  { id: "measure", chapter: "Measuring", title: "Every interval, measure every path.", body: <p>Probes go through each tunnel to the hub and back (Cisco: BFD; Junos: RPM). The edge averages <Bb>latency, jitter and loss</Bb> per interval.</p> },
  { id: "upgood", chapter: "Measuring", title: "Reachable, eligible, down.", body: <p>Down: no probe comes back — the path is unusable. Up but degraded: <Bb>reachable</Bb>, not good enough for voice. Up and good: <Bb>eligible</Bb>.</p> },
  { id: "sla", chapter: "SLA classes", title: "An SLA class says what an application tolerates.", body: <p>Voice: <Bb>≤ 100 ms latency, ≤ 30 ms jitter, ≤ 1 % loss</Bb>. A path inside all three is eligible for voice. The backup has no class: any reachable path will do.</p> },
  { id: "policy", chapter: "Policy", title: "Per application: SLA, preference, and a plan B.", body: <p>Voice: SLA required, prefer TUN-A then TUN-B, fall back to the best path if none qualifies. Backup: no SLA, prefer TUN-B then TUN-A.</p> },
  { id: "steer", chapter: "Policy", title: "Same moment, two applications, two paths.", body: <p>The call takes the first eligible path in its preference — TUN-A; the backup its first reachable one — TUN-B. The business line stays free for voice.</p> },
  { id: "brown", chapter: "Failover", title: "ISP-A browns out.", body: <p>Still up. At the next interval the edge measures 160 ms, 40 ms jitter, 2 % loss: TUN-A <Bb>fails the voice SLA</Bb>. It stays usable — just not for voice.</p> },
  { id: "failover", chapter: "Failover", title: "Voice moves; the backup doesn't care.", body: <p>The next call goes over TUN-B, the first path still eligible. Until the interval closed, calls suffered: the edge only knows what it measured.</p> },
  { id: "recover", chapter: "Recovery", title: "Back — but not too fast.", body: <p>ISP-A recovers. One good interval: <Bb>recovering 1/3</Bb>. Only after three good intervals in a row does voice return.</p> },
  { id: "hyst", chapter: "Recovery", title: "Hysteresis stops calls from flapping.", body: <p>A circuit that alternates good and bad would otherwise move every call back and forth. Cisco: <Bb>bfd app-route multiplier</Bb>; Junos: <Bb>switch-idle-time</Bb>.</p> },
  { id: "none", chapter: "No good path", title: "Both paths fail: fallback.", body: <p>On a bad day neither path meets the voice SLA. With <Bb>fallback-to-best-path</Bb>, calls use the least bad reachable path: poor, but connected.</p> },
  { id: "strict", chapter: "No good path", title: "Strict: silence.", body: <p>With <Bb>strict</Bb>, the same day drops every call at the branch. And an SLA nothing can meet (20 ms) makes every call a fallback — the class no longer tells good from bad.</p> },
  { id: "local", chapter: "Who decides", title: "Policy may be central; the decision is local.", body: <p>Cisco pushes the policy from the controller; Junos configures it on the SRX. Either way the <Bb>edge</Bb> decides per packet, from installed policy and its own live measurements.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Measured, allowed, chosen.", body: <p>What did each path measure? which paths meet the class? which path did each application use?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Measurements → SLA class → policy → path.", body: <p>Same symptom, different causes: separate them in that order.</p> },
  { id: "recap", chapter: "The whole idea", title: "Measure, qualify, prefer, move — carefully.", body: <p>Now follow the branch in the lesson, then break and repair its policy in the SD-WAN Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", two: "net", overlay: "net", apps: "net", measure: "net", upgood: "upgood", sla: "sla", policy: "policy", steer: "net", brown: "net", failover: "net", recover: "net", hyst: "hyst", none: "net", strict: "net", local: "local", verify: "verify", trouble: "trouble", recap: "recap" };
const NODES: TopoNode[] = [
  { id: "c", label: "CLIENT", sub: "10.30.30.10", icon: "💻", x: 6, y: 50 },
  { id: "br", label: "BRANCH", sub: "edge", icon: "R", x: 26, y: 50 },
  { id: "ia", label: "ISP-A", sub: "biz-internet", icon: "☁", x: 50, y: 18 },
  { id: "ib", label: "ISP-B", sub: "public-internet", icon: "☁", x: 50, y: 82 },
  { id: "hub", label: "HUB", sub: "edge", icon: "R", x: 74, y: 50 },
  { id: "app", label: "APP", sub: "10.40.40.20", icon: "🖥", x: 94, y: 50 },
];
const at = (n: string) => nodeAt(NODES, n);
function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={650} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "net") {
    const aBad = ["brown", "failover", "recover", "none", "strict", "why"].includes(id);
    const bBad = ["none", "strict"].includes(id);
    const links: TopoLink[] = [
      { a: "c", b: "br" },
      { a: "br", b: "ia", label: id === "overlay" ? "TUN-A" : undefined, state: aBad ? "blocked" : ["steer", "two", "overlay", "measure"].includes(id) ? "active" : "up" },
      { a: "ia", b: "hub", state: aBad ? "blocked" : ["steer", "two", "overlay", "measure"].includes(id) ? "active" : "up" },
      { a: "br", b: "ib", label: id === "overlay" ? "TUN-B" : undefined, state: bBad ? "blocked" : ["steer", "failover", "overlay", "measure"].includes(id) ? "active" : "up" },
      { a: "ib", b: "hub", state: bBad ? "blocked" : ["steer", "failover", "overlay", "measure"].includes(id) ? "active" : "up" },
      { a: "hub", b: "app" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") views.ia = { ring: "bad", bubble: { text: "UP · 160 ms · 2 % loss", tone: "warn" } };
    if (id === "apps") {
      views.br = { ring: "on", bubble: { text: "VOICE: UDP · EF   BULK: TCP 873", tone: "info" } };
    }
    if (id === "measure")
      movers = (
        <>
          {go("br", "ia", { label: "probe", key: "1", color: "violet" })}
          {go("ia", "hub", { label: "probe", key: "2", delay: 600, color: "violet" })}
          {go("br", "ib", { label: "probe", key: "3", color: "violet" })}
          {go("ib", "hub", { label: "probe", key: "4", delay: 600, color: "violet" })}
        </>
      );
    if (id === "steer" || id === "failover") {
      const voiceVia = id === "steer" ? "ia" : "ib";
      movers = (
        <>
          {go("br", voiceVia, { label: "VOICE", key: "1", color: "amber" })}
          {go(voiceVia, "hub", { label: "VOICE", key: "2", delay: 600, color: "amber" })}
          {go("br", "ib", { label: "BULK", key: "3", delay: 300, color: "green" })}
          {go("ib", "hub", { label: "BULK", key: "4", delay: 900, color: "green" })}
        </>
      );
    }
    if (id === "brown") views.ia = { ring: "bad", bubble: { text: "160 ms · 40 ms · 2 % → SLA ✗", tone: "bad" } };
    if (id === "failover") views.ia = { bubble: { text: "SLA ✗ — no voice", tone: "warn" } };
    if (id === "recover") views.ia = { bubble: { text: "healthy · recovering 1/3", tone: "warn" } };
    if (id === "none") {
      views.ia = { bubble: { text: "SLA ✗", tone: "bad" } };
      views.ib = { bubble: { text: "SLA ✗", tone: "bad" } };
      views.br = { ring: "on", bubble: { text: "fallback → best reachable path", tone: "yes", delay: 400 } };
      movers = go("br", "ia", { label: "VOICE (poor)", key: "1", color: "amber" });
    }
    if (id === "strict") {
      views.br = { ring: "bad", bubble: { text: "no compliant path · strict → DROP", tone: "bad" } };
      movers = go("c", "br", { label: "VOICE", key: "1", stay: true, color: "red" });
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={48} minH={250}>
          {movers}
        </Topo>
        {["measure", "steer", "failover", "none", "strict"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "upgood":
      return (
        <>
          {head}
          <MiniTable title="Three states of a path" cols={["State", "Probes", "Voice", "Backup"]} rows={[{ cells: ["down", "none back", "no", "no"] }, { cells: ["reachable (SLA ✗)", "back, but slow / lossy", "no", "yes"] }, { cells: ["eligible (SLA ✓)", "back, within the class", "yes", "yes"], state: "hit" }]} />
        </>
      );
    case "sla":
      return (
        <>
          {head}
          <MiniTable title="TUN-A against the voice class" cols={["Metric", "Healthy", "Brownout", "Voice SLA"]} rows={[{ cells: ["latency", "25 ms ✓", "160 ms ✗", "≤ 100 ms"] }, { cells: ["jitter", "3 ms ✓", "40 ms ✗", "≤ 30 ms"] }, { cells: ["loss", "0.2 % ✓", "2 % ✗", "≤ 1 %"], state: "hit" }]} />
        </>
      );
    case "policy":
      return (
        <>
          {head}
          <MiniTable title="Application policy" cols={["Application", "SLA", "Preference", "No compliant path"]} rows={[{ cells: ["VOICE", "required", "TUN-A > TUN-B", "best path"], state: "hit" }, { cells: ["BULK", "none", "TUN-B > TUN-A", "—"] }]} />
        </>
      );
    case "hyst":
      return (
        <>
          {head}
          <Chain k="hy" horizontal items={[{ t: "SLA ✗ → out at once", tone: "red" }, { t: "good 1/3", tone: "amber" }, { t: "good 2/3", tone: "amber" }, { t: "good 3/3 → eligible", tone: "green" }]} />
        </>
      );
    case "local":
      return (
        <>
          {head}
          <Compare items={[{ title: "Cisco Catalyst SD-WAN", tone: "cyan", body: "policy written on the controller (vSmart), pushed to every edge; the edge measures with BFD and decides" }, { title: "Junos SRX", tone: "violet", body: "policy configured on the SRX (APBR, SLA rule, routing instances); RPM measures; the SRX decides" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco Catalyst SD-WAN" cols={["Question", "Command"]} rows={[{ cells: ["Tunnels up?", "show sdwan bfd sessions"] }, { cells: ["Measured / class met", "show sdwan app-route stats"] }, { cells: ["Installed policy", "show sdwan policy from-vsmart"] }, { cells: ["Path used", "show sdwan policy app-route-policy-filter"] }]} />
            <MiniTable title="Junos SRX" cols={["Question", "Command"]} rows={[{ cells: ["Measured", "show services rpm probe-results"] }, { cells: ["SLA + active path", "show security advance-policy-based-routing"] }, { cells: ["Preference", "show route table RI-VOICE.inet.0"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Dropped, poor, or wrong path?", tone: "red" }, { t: "Right application class?", tone: "cyan" }, { t: "What did each path measure?", tone: "violet" }, { t: "Which paths meet the class — is the class sensible?", tone: "amber" }, { t: "Policy: SLA required, preference, fallback?", tone: "amber" }, { t: "Measure again, send again, check the path", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Overlay tunnels over every underlay circuit" }, { t: "Measure each path every interval: up is not good", tone: "violet" }, { t: "SLA classes: what each application tolerates", tone: "amber" }, { t: "Per application: SLA, preference, fallback", tone: "cyan" }, { t: "Move away at once; come back after the hold time", tone: "green" }]} />
        </>
      );
  }
  return head;
}
export function SdwanPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="SD-WAN path selection, from zero" kicker="Learn · the SD-WAN presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
