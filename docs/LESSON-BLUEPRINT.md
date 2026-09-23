# PacketVerse Lesson Blueprint

The standard shape used by PacketVerse interactive lessons, and the reference implementations that demonstrate each pattern. Read `docs/ARCHITECTURE.md` first — this document assumes that architecture and only talks about lesson *content* structure.

## The standard arc

```
Problem
  ↓
Why the protocol exists
  ↓
Control plane
  ↓
Interactive protocol exchange
  ↓
Internal device processing
  ↓
Tables / state change
  ↓
Data-plane consequence
  ↓
Fault injection
  ↓
Troubleshooting
  ↓
Engineer Challenge
```

This is a *teaching* arc, not a literal 1:1 step list — a real lesson interleaves prediction questions, "build it yourself" mini-steps, and X-Ray/device-entry moments throughout, and some lessons (MPLS L3VPN, EVPN/VXLAN) run the data-plane consequence *twice* (once naively/assumed, once after the control plane makes it verifiable) before ever reaching the fault. What must never move is the underlying causality: the learner should never be asked to troubleshoot a mechanism they haven't first watched work correctly, and a fault must always be introduced against an otherwise-fully-healthy system (never "five simultaneous faults").

### 1. Problem
One paragraph, concrete, no protocol names yet if avoidable. State a real constraint the topology creates (two hosts can't talk / a provider core can't hold every customer's routes / iBGP's O(n²) mesh doesn't scale / a routed fabric doesn't carry Layer 2). This is also the lesson's `WHY_<PROTOCOL>` "WHAT/WHY/WHEN/WITHOUT" quad-panel content on the page.

### 2. Why the protocol exists
Usually collapsed into the Problem step's own narrative plus one `predict-*` question whose wrong options are other plausible-sounding "solutions" that don't actually work (a bigger cable, a static route, forcing non-overlapping addressing, a VLAN trunk across a routed core). The point of the question is to make the learner reject the naive answers before being handed the real one.

### 3. Control plane
Introduce the signaling/adjacency mechanism *before* any data moves, if the protocol has one that predates data flow (OSPF Hello/adjacency states; BGP OPEN/KEEPALIVE/UPDATE; MP-BGP VPNv4; BGP EVPN session). If the lesson is explicitly teaching a data-plane mechanism that can and should be understood *without* its control plane first (VXLAN before BGP EVPN), see the EVPN/VXLAN exception below — the control plane still comes, just later, once its absence has been felt as a real limitation.

### 4. Interactive protocol exchange
The actual packet(s) animate hop to hop, each one clickable (`PacketDetailPanel`/`PacketInspector`), summary + badge distinguishing message subtype (OPEN vs. KEEPALIVE vs. UPDATE; VPNv4 UPDATE vs. reflected VPNv4 UPDATE; EVPN Type 2 UPDATE). Reuse an existing packet-layer shape before inventing a new one — MPLS L3VPN's VPNv4 layer and EVPN's Type-2 EVPN layer are both literally "a BGP UPDATE with a different NLRI," reusing `protocol: "BGP"` and the generic multi-field `PacketLayer`.

### 5. Internal device processing
Enter at least one device (usually the one doing the most interesting work) in 3D and show its Conceptual [X] Pipeline (`DeviceProcessingTrace` → `ForwardingPipeline3D`). Name the pipeline after what it conceptually does, not generically ("Conceptual VXLAN Ingress Pipeline", not "Conceptual Forwarding Pipeline", when a better name exists). Show physical interfaces (`DeviceInterfaceData`) with real generic fields plus protocol-specific `extra` fields.

### 6. Tables / state change
Whatever table the protocol actually maintains, shown as a real, inspectable object — OSPF's LSDB and routing table; BGP's Adj-RIB-In/best-path table; MPLS L3VPN's VRF + received-VPNv4-route table; EVPN's per-leaf MAC/EVPN table with local-vs-remote clearly distinguished. This is also where a "before/after" dramatic contrast lands well (unknown MAC → flooding required, vs. known MAC → table → unicast).

### 7. Data-plane consequence
Send an actual user packet/frame through the now-informed forwarding path and watch it arrive. X-Ray focus (`focusLayerIndices`) should highlight only the field(s) *this* hop actually acts on, dimming the rest as "present — not used for this hop's decision" — this is one of the most reliably impressive moments in every lesson (a P router ignoring the VPN label underneath; a spine ignoring the inner MAC entirely).

### 8. Fault injection
Exactly **one** fault, chosen so that most of the stack is still healthy — this is what makes troubleshooting a skill rather than a coin flip. The proven house style is a **policy-layer** fault (Route Target import mismatch) rather than a link-down/session-down fault, because it demonstrates the more subtle, more realistic lesson: "the session is Established, the route is received, and it *still* doesn't work." Both MPLS L3VPN and EVPN/VXLAN use literally the same shape of fault (an import-RT mismatch) at different layers (IPv4 VPN route vs. MAC/IP EVPN route) — reuse this shape again for the next lesson unless there's a specific pedagogical reason to introduce a different failure mode (and if introducing multihoming/DF-election lessons later, a DF-election tie or an ESI mismatch would be the natural next *kind* of fault).

### 9. Troubleshooting
A short "diagnostic layers" ladder (`TroubleshootingLayers`, generic ✓/✕/? per layer, bottom-up: interface → underlay/IGP → session/adjacency → the specific policy that's actually broken), plus one `trouble-question` (a real multiple-choice diagnosis, with progressive `hints` on the question) before the repair. Never skip straight to "here's the fix" — the learner must be asked to *locate* the fault first.

### 10. Engineer Challenge
A `repair-challenge` step using `action`/`requiresState` (not `question`) — 3-4 plausible repair options, exactly one correct, `WRONG_FEEDBACK` explaining *why* each wrong option doesn't fix it (not just "incorrect"). At least one wrong option should be a real anti-pattern the lesson's own accuracy rules warn against (MPLS L3VPN doesn't offer "redistribute into the global table"; EVPN/VXLAN's wrong options include "manually configure a static MAC entry," which is explicitly rejected as abandoning the whole point of having a control plane). Verify with a `verify-dataplane` step, then `complete` — award XP via `completeLesson` and a real, dashboard-visible achievement via `unlockAchievement` (see ARCHITECTURE.md §13 — **add the achievement to the `ACHIEVEMENTS` catalog in the same change**).

## The EVPN/VXLAN exception: data plane before its control plane

Most lessons teach control plane → data plane, because the control plane is *why the data plane works at all* (an LSP doesn't exist without LDP; a VPN route can't be imported without MP-BGP). EVPN/VXLAN deliberately inverts this for one arc: VXLAN (the encapsulation) is taught completely, successfully, end-to-end **before** BGP EVPN is introduced — with the one missing piece (how did the ingress VTEP know the remote MAC's location?) explicitly flagged in the state model as `learnedVia: "assumed"` and called out in the narrative ("assume this was known for now — we'll explain how shortly"), never silently hand-waved. This is the right pattern whenever a protocol has **two genuinely separable questions** — "does the mechanism work" and "how did it learn what it needed to know" — where teaching them interleaved would obscure which failure belongs to which layer. The BUM/Type-3 lesson (`evpn-bum`) has exactly this shape too: ingress replication is demonstrated as a data-plane mechanism, while flood-list membership is fundamentally a control-plane (Type-3/IMET) topic — any lesson that reuses a pre-existing flood list before deriving it live keeps the same "assumed, then explained" honesty.

## Reference implementations

The foundational lessons below remain the best examples of lesson *content* structure. (These are content references; for historical-inspection architecture see the second table and `docs/ARCHITECTURE.md` §17–§19.)

| Lesson | File | What it's the best example of |
|---|---|---|
| OSPF | `scenarios/ospfArea0.ts` + `app/demo/ospf-area0/` | Neighbor state machine (Down→Init→2-Way→ExStart→Exchange→Loading→Full) as the "control plane"; LSA flooding as a `FloodCopy3D` moment; SPF recompute on a cost change; a link-layer fault (MTU mismatch) rather than a policy fault — the simplest full arc to copy structurally for a brand-new protocol family. |
| BGP Enterprise | `scenarios/bgpEnterprise.ts` + `app/demo/bgp-enterprise/` | TCP-before-BGP layering (the "why TCP first" prediction question), OPEN/KEEPALIVE/UPDATE message-subtype badges on one `protocol: "BGP"` packet type, best-path selection as a real multi-attribute decision (`BestPathDecisionViewer`), and policy manipulation (prepend, Local Preference) as the "Engineer Challenge" instead of a break/repair — a good model for a lesson whose climax is *design*, not *fault repair*. |
| BGP Route Reflector | `scenarios/bgpRouteReflector.ts` + `app/demo/bgp-route-reflector/` | Teaching a scaling *problem* first (predicted session counts at 4/10/... routers building to "this doesn't scale"), then the one deliberate exception to a rule the learner already knows (iBGP split-horizon), `Region3D` used for RR clusters, and `ReflectionDecisionViewer` as a generic reflect/withhold-per-candidate component — the best template for any lesson whose core idea is "a scaling problem forces one new rule." |
| MPLS / LDP | `scenarios/mplsLdp.ts` + `app/demo/mpls-ldp/` | Two genuinely distinct journeys sharing one `traceFor` — LDP control-plane messages (Hello/Session/Label Mapping, keyed off `currentStepId`, no packet) and MPLS data-plane forwarding (PUSH/SWAP/POP/PHP, read from a growing `state.journey: JourneyHop[]`, reusing SR-MPLS's pattern) — combined into one `HopTimeline`. Also the reference for `deviceForStep` needing **sender**-priority (`packet.from ?? packet.to`), not the receiver-priority every BGP/OSPF lesson uses, because each `JourneyHop` is recorded against the router that performed the label operation, not the one that received the result. |
| MPLS L3VPN | `scenarios/mplsL3vpn.ts` + `app/demo/mpls-l3vpn/` | The fullest expression of the standard arc: VRF → RD → RT → MP-BGP VPNv4 (control) → two-label push/swap/pop (data) → RT-import-mismatch fault → repair. Also the reference for **integrating a second, already-completed lesson's real logic** without duplicating it (`rrIntegration.ts` reusing `bgpRouteReflector.ts`'s `evaluateReflection`) — copy this pattern instead of re-deriving reflection/RR logic if a future lesson needs an RR again. Historical inspection of the fault/repair steps (§28 of the interactive-topology brief) must give each RT-import-check event its own `traceFor` branch reading `state.received.PE1`/`state.vrfs.PE1` directly — a generic step-index fallback shows the wrong (already-healed or already-broken) RT comparison for an event on the other side of the fault. |
| EVPN / VXLAN Foundations | `scenarios/evpnVxlan.ts` + `app/demo/evpn-vxlan/` | Data-plane-before-control-plane sequencing (see above); a *reused* fault shape (RT-mismatch, now on a MAC/IP route) applied to a new protocol family instead of inventing a new failure category; strict, explicit scope boundaries recorded directly in the scenario file's own doc comment (what's deferred and why) so a future contributor doesn't accidentally re-derive Route Type 1/3/4/5 logic inside what's supposed to be the foundations lesson. |

Strongest current Level-3 references (Focus Mode / historical inspection):

| Lesson | File | What it's the best example of |
|---|---|---|
| SRv6 Policy | `app/demo/srv6-policy/` | Complex `ScenarioEngine` Level 3 with SR Policy state; frozen `getStateAt()` historical `HopTimeline` inspection; the centralized `historicalIndex < liveIndex` stale-cursor invariant (ARCHITECTURE.md §18). The reference to copy for historical inspection. |
| SRv6 CSID | `app/demo/srv6-csid/` | Compressed instruction (CSID owner sequence) kept distinct from the physical packet path; DA / Segments Left correctness per hop; a long historical timeline. |
| SR-MPLS vs SRv6 Capstone | `app/demo/sr-mpls-vs-srv6/` | Dual-technology state isolation: two parallel executions of one intent, compared side by side, each inspected with its own native technology-specific packet/inspector view rather than one packet's before/after. |
| EVPN Troubleshooting | `app/demo/evpn-troubleshooting/` | Level 3 without `ScenarioEngine`: history from frozen per-test results plus a `stateBeforeFix` snapshot (ARCHITECTURE.md §19). |
| SR-MPLS Foundations | `app/demo/sr-mpls-foundations/` | The original Focus Mode / Hop Inspector / Question Context Mode architecture. Its timeline history is still the legacy selection-only (live-state) model — do **not** copy that part; use SRv6 Policy's. |

## The interactive-topology standard (mandatory for every lesson)

Every lesson is expected to deliver this learner arc, using the topology itself as part of the explanation, not decoration:

```
Explore → Observe → Predict → Answer → Reveal → Follow Packet → Inspect Hop → Inspect Object → Troubleshoot
```

Capability is expressed in three tiers. A lesson gets the richest tier its **real** domain data actually supports — never a lower tier out of neglect, and never a higher tier by inventing data. See `docs/ARCHITECTURE.md` §18 for the full technical contract each tier requires.

- **Level 1 — Topology Focus** (mandatory for every lesson with a 3D topology): Expand/Focus Mode, 2D↔3D where supported, Overview/Device/Free Orbit, node/link/interface-anchor selection, focused 3D object inspection, Back to Device, Overview return.
- **Level 2 — Packet Journey** (any lesson whose domain models a packet or control message moving): Play/Pause/Previous/Next/Reset, Follow Packet, HopTimeline, active path, ingress/egress, current device, next hop, reason. A control-plane message (BGP OPEN, OSPF Hello, LDP label mapping) is a journey exactly as much as a data-plane packet is — never fake a "packet" to get this tier, model the message the protocol actually sends.
- **Level 3 — Processing Inspection** (lessons with enough domain data): Hop Inspector, PacketDiff/before-after, processing stages, packet/header stack, object focus on a stage/layer/interface/link, and historical inspection of earlier timeline entries against their own frozen state — every field sourced from the domain/adapter, never invented to fill the panel.

All 34 current demo lessons are classified Level 3. For historical inspection, 32 use the standard `ScenarioEngine` `getStateAt()` model, `evpn-troubleshooting` uses its intentional investigation-history variant, and `sr-mpls-foundations` still uses the legacy selection-only model pending normalization — see ARCHITECTURE.md's curriculum status and §18.

**Anti-fake-data rule (mandatory):** do not add fake packet stacks, guessed interfaces, invented next hops, synthetic protocol states, or placeholder lookup results presented as real, just to claim a higher tier. If the domain state doesn't yet expose a fact, either enrich the scene adapter accurately (see `deviceTrace.ts` in `ospf-area0`/`bgp-enterprise`/`bgp-route-reflector`/`mpls-ldp`/`mpls-l3vpn` for the pattern: add `ingressInterfaceId`/`egressInterfaceId`/`lookupType`/`lookupKey`/`lookupResult`/`nextHopId`/`nextHopLabel`/`reason` to `traceFor()`'s return, deriving every value from data the scenario file already computed) or leave that specific capability unavailable and say so in the report. Accuracy beats feature count.

**Selection semantics (mandatory, must not vary per lesson):** click node → inspect that exact node; click timeline hop → inspect that historical hop; click "Go to next hop" → inspect next hop; click interface → inspect interface; click link → inspect link; click processing stage/packet layer → focus that object. No gesture may silently substitute for another. The Hop Inspector always uses explicit "● INSPECTING {device}" language and "Go to next hop: {X} →" — never "Inspect {X} →" while a different device is current.

**Questions in Focus Mode are mandatory** wherever a lesson has prediction steps: visible and answerable inside Focus Mode, reusing the exact same `engine.answer()`/`lastAnswer` state the normal page uses (never a second quiz engine), no duplicated XP, no future-state spoiler before the learner answers.

### Lesson capability checklist

Run through this before calling any new or newly touched lesson done. This is the architectural expectation going forward; it does not claim that every existing page has already been audited against every item (known follow-ups are listed in ARCHITECTURE.md §18, "Known Level-3 normalization work").

- [ ] Focus Mode works (Expand, Overview, Device, Free Orbit, Close)
- [ ] questions work in Focus Mode (visible, answerable, same state as normal mode) and always win the inspector slot over Hop/Device
- [ ] direct node selection is correct (click X while entered → Device Explorer for X, not a neighbor; the `InspectorSurface` set to `"device"` — see ARCHITECTURE.md §18)
- [ ] Device Explorer is actually reachable inside Focus Mode (not just the main column) once a device is entered, and a Hop/Device switch appears whenever both surfaces exist for that device
- [ ] packet/message journey is modeled if the domain has one (HopTimeline shows real, protocol-appropriate labels — not generic "hop 1/2/3"); selecting a timeline entry sets `InspectorSurface` to `"hop"`
- [ ] Hop Inspector is domain-derived (ingress/egress/lookup/action/reason come from `traceFor()`, not invented in the component)
- [ ] earlier timeline entries show frozen state, not current live state (`ScenarioEngine` lessons: `historicalIndex` + `engine.getStateAt()`, never `engine.goTo()`)
- [ ] the historical cursor is strictly earlier than the live cursor; rewinding to or across the selected historical step clears it
- [ ] a missing historical entry never produces an invalid (`-1`) timeline selection — fall back to the live position
- [ ] long `HopTimeline` histories scroll horizontally without shrinking or overlapping chips
- [ ] Device Explorer never mixes live device state with frozen history (Device surface disabled while historical)
- [ ] a logical instruction/segment sequence (SIDs, CSIDs, policy segment list) is never treated as physical adjacency or the physical packet path
- [ ] before/after is accurate (`packetBefore`/`packetAfter` or `packetBeforeFrames`/`packetAfterFrames` reflect real state, never guessed)
- [ ] relevant packet/header layers can be focused, where the domain models discrete layers
- [ ] interfaces/links can be inspected (`DeviceInterfaceData`/`LinkDetail`, generic `extra` bag for protocol-specific fields)
- [ ] `requiresState` actions (repair/challenge controls) are visible and usable inside Focus Mode
- [ ] one WebGL canvas: one-canvas invariant holds (normal = 1, Focus Mode open = 1, close = 1)
- [ ] anti-spoiler verified at every `predict-*` step (no future mutation/next-hop/reason visible before the learner answers)

## Practical checklist for the next lesson

1. **Scope boundary first.** Write the doc-comment at the top of the new scenario file listing exactly what this lesson covers and what's explicitly deferred (with a one-line reason each), before writing a single step. Copy the style from `evpnVxlan.ts`'s header.
2. **Reuse before inventing:** check `PVEventType`, `PacketVisual["protocol"]`, and the `components/protocol/*` viewer components for something close enough before adding new ones. A new `protocol` union member (e.g. adding `"VXLAN"`) is fine when it's a genuinely new wire format; a new generic table/list viewer is fine when the existing ones don't fit the shape (EVPN needed `EvpnRouteTable` because MAC/IP/VNI/remote-VTEP didn't fit `VpnRouteViewer`'s RD/RT/prefix shape) — but always check first.
3. **Scene Adapter split**: `deviceTrace.ts` (traces/interfaces/packet frames/link detail) + `explain.ts` (per-device NodeExplanation, tense derived from `state.journey`) + the scenario file itself (state + steps + packet builders). Nothing protocol-specific in `page.tsx` beyond wiring and toolbar/tab layout.
4. **One fault, otherwise-healthy stack, policy-layer where it fits the protocol** (see §8 above).
5. **Register the lesson**: `lessons/index.ts` (new `Lesson` entry, correct `prerequisites`, `simulationPath`), `learningPaths.ts` (point the relevant track node's `lessonId`/`status` at it), and `ACHIEVEMENTS` in `useProgressStore.ts` (new completion achievement, real title/description).
6. **Interactive-topology capability checklist** — run the full checklist in "The interactive-topology standard" above; a new lesson must ship at least Level 1, and Level 2/3 wherever real domain data supports it (every current lesson is Level 3 — match that unless the domain genuinely can't support it).
7. **Quality gates, every time, no exceptions** — the same gates CI (`.github/workflows/ci.yml`, "Quality gates") runs: `npm ci`, `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean (ESLint 0 errors, every demo route built) before calling it done.
8. **Browser-verify the full arc** before reporting complete: every prediction question renders with the right options; at least one full device-entry X-Ray pass per enterable device; the fault genuinely breaks only the intended layer (diagnostic ladder shows the right ✓/✕/? pattern); the wrong repair option(s) are rejected with real feedback and the correct one repairs and re-verifies; completion awards XP and an achievement that will actually render on the Dashboard; zero new console errors across the whole run; Previous/goTo/Restart don't leak stale state (ARCHITECTURE.md §15); one-canvas invariant holds.
9. **Report what was implemented and what was explicitly deferred** — every lesson prompt in this project ends with that ask; treat it as a hard requirement of "done," not a nice-to-have summary.
