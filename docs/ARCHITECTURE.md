# PacketVerse Architecture

This document describes the architecture actually implemented in this repository, as of the EVPN + VXLAN Foundations lesson. It is a reference for anyone (human or model) building the next lesson — it should stay in sync with the code; when the two disagree, the code wins and this file should be updated.

The one rule everything below serves: **networking/protocol logic lives in exactly two places — a scenario file (`src/lib/sim-engine/scenarios/*.ts`) and that lesson's own Scene Adapter (`src/app/demo/<lesson>/deviceTrace.ts` + `explain.ts`).** Every component under `src/components/network3d/` and the shared 2D components under `src/components/network/` and `src/components/protocol/` are generic renderers. They accept plain data shapes and know nothing about VRFs, VNIs, labels, or BGP attributes. A new lesson should almost never need to touch `network3d/*`.

## 1. ScenarioEngine

`src/lib/sim-engine/ScenarioEngine.ts` is a framework-agnostic class, generic over a lesson's own state type `TState`. It has no dependency on React or Three.js and could be unit-tested headlessly.

```ts
class ScenarioEngine<TState> {
  constructor(initialState: TState, steps: ScenarioStep<TState>[])
  subscribe(listener: () => void): () => void
  getSnapshot(): ScenarioSnapshot<TState>
  answer(optionId: string): void
  act(payload: unknown): void
  canAdvance(): boolean
  advance(): void
  restart(): void
  goTo(index: number): void
}
```

A lesson is a linear array of `ScenarioStep<TState>` (`src/lib/sim-engine/types.ts`):

```ts
interface ScenarioStep<TState> {
  id: string;
  label: string;
  narrative: string;
  question?: StepQuestion;                         // gates advancement until answered
  packet?: (state: TState) => PacketVisual | undefined; // the in-flight packet for THIS step
  run?: (state: TState) => StepResult<TState>;      // pure transition, applied the instant the step is entered
  whatChanged?: (prev: TState, next: TState) => string[];
  action?: (state: TState, payload: unknown) => StepResult<TState>; // repeatable, does NOT advance the index
  requiresState?: (state: TState) => boolean;       // gates advancement on a predicate instead of/alongside a question
}
```

Wired into React via `useScenarioEngine` (`src/lib/sim-engine/useScenarioEngine.ts`), which creates one `ScenarioEngine` per mount (`useMemo(..., [])`) and subscribes with `useSyncExternalStore`.

### Important behavioral detail: a step's `run()` fires immediately

`applyStepEffects(index)` runs a step's `run()` the moment that step *becomes* current — on construction, on `advance()`, and on `restart()`. This means a step's narrative and its state effects are always shown together, but it also means **derived "current location" fields (e.g. `packetAt`) reflect where the model says the packet now IS, which is often already the next hop**, not the hop the step's own narrative/pipeline is teaching about. Concretely: MPLS L3VPN's `p1-swap` step and EVPN/VXLAN's `leaf1-ingress` step both set the packet's location to the *following* device inside their own `run()`. Anything that needs to highlight "what THIS device (the one currently entered in the 3D view) is doing" must key off **which device is entered** (`effectiveDeviceId`), never off `state.packetAt` — a page-level focus helper (`focusIndicesFor(device, packet)`) should be parameterized by device, with a separate computation for the roaming overview/sidebar inspector (which legitimately does track `packetAt`, since it has no single "device being examined").

### `canAdvance()` vs. `advance()`

`canAdvance()` is only a **UI hint** — it drives whether the "Next Step" button is disabled and what it's labeled ("Answer to continue" / "Apply the correct fix to continue" / "Next Step →"). It does **not** gate `advance()` itself; `advance()` unconditionally moves forward (unless already at the last step). The page is responsible for disabling the control. For a question step, `canAdvance()` only requires `lastAnswer.stepId === step.id` — **correctness of the answer is never required to advance**, only that *an* answer was recorded. This is deliberate (a prediction question is pedagogy, not a lock) and downstream tooling (browser verification, e2e scripts) can safely click any option, not just the correct one, to make forward progress — though picking the correct option is obviously preferable when demonstrating a lesson.

## 2. Immutable / snapshotted state

- `TState` is always a plain, immutable object graph — every `run()`/`action()` returns a brand-new object (spreads, never mutation).
- The engine keeps `stateByIndex: Map<number, TState>` — a snapshot of the state as it existed the moment each step index was entered.
- `goTo(index)` (used by "← Previous" and by clicking an earlier, completed step in the timeline strip) restores `this.state` from that map rather than replaying steps or merely rewinding the index. Without this, going back past a step that pushed/swapped/popped a label (or built a route, or injected a fault) would leave that mutation in place even though the displayed narrative no longer claims it happened.
- `restart()` resets to `initialState`, clears `events`, `whatChangedByIndex`, and `stateByIndex`, and re-runs `applyStepEffects(0)`.
- `getSnapshot()` caches its result (`cachedSnapshot`) and only recomputes on `notify()` — required for `useSyncExternalStore`, which needs a referentially stable snapshot when nothing has changed.

**Consequence for every lesson page:** any page-local UI state that represents a "replay" of engine-owned data (e.g. MPLS+RR's synthetic PE2→RR1→PE1 relay animation, or a fault-injection toggle) must be reset explicitly in the page's own `handleRestart()` — the engine's `restart()` only knows about its own `TState`, not about page-local `useState`.

## 3. Typed events

`PVEventType` (`src/lib/sim-engine/types.ts`) is one large, append-only union spanning every lesson family: generic (`PACKET_SENT`, `MAC_LEARNED`, `QUESTION_ANSWERED`, …), OSPF, BGP, MPLS/LDP, MPLS L3VPN (VRF/RD/RT/VPNv4), BGP Route Reflection, and so on. A step's `run()`/`action()` returns `{ state, events: PVEvent[] }`; the engine appends every event to its own log (`this.events`) and also always pushes a `STEP_ENTERED` event when a step becomes current.

Rule of thumb before adding a new event type: search the existing union first. EVPN/VXLAN Foundations needed **zero** new event types — every effect (`VRF_ROUTE_LEARNED`-style route creation, `RT_IMPORT_EVALUATED`, `VPN_ROUTE_INSTALLED`, `BGP_STATE_CHANGED`, `PACKET_SENT`/`PACKET_RECEIVED`, `VPN_PACKET_DELIVERED`) already existed generically enough to reuse. Only add a new `PVEventType` when a lesson introduces a genuinely new *kind* of thing happening (e.g. a new route type being created for the first time), not a new *label* for something already covered.

Nothing currently renders the event log directly in the UI — `whatChanged` (human-readable bullet strings, computed once per step) is what pages show. The event log exists for future tooling (analytics, a debug replay view, testing) and as the single source of truth for "what happened," so keep emitting it accurately even though no lesson currently displays it.

## 4. The Scene Adapter pattern

Every lesson under `src/app/demo/<lesson>/` owns two adapter files:

- **`deviceTrace.ts`** — computes, from the current `TState` + current step id, everything the 3D/2D layer needs to render *this instant*: `DeviceProcessingTrace` per enterable device, `DeviceInterfaceData[]`, `PacketStackFrame[]`, and `LinkDetail`. Exports pure functions (`traceFor`, `interfacesFor`, `packetFramesFor`, `linkDetailFor`), never React components.
- **`explain.ts`** — computes a `NodeExplanation` per device: role, current action (in past/present/future tense derived from `state.journey`, not a hand-authored per-step lookup table, so it stays correct through Previous/Restart automatically), control-vs-data-plane role text, and `tables` (arbitrary title/rows key-value blocks — VRF tables, EVPN MAC tables, received-route summaries, etc.).

Neither file imports anything from `components/network3d/`, and nothing in `components/network3d/` imports a scenario file or a lesson's adapter. The lesson **page** (`page.tsx`) is the only thing that imports both sides and wires them together every render. This is what makes the generic 3D layer reusable across OSPF, BGP, MPLS, MPLS L3VPN, BGP Route Reflector, and EVPN/VXLAN without a single `if (protocol === "ospf")` anywhere in `network3d/`.

**Cross-lesson reuse without duplication or coupling:** when a lesson needs to reuse another lesson's *real logic* (not just its visual shape), the pattern is a small, page-local **integration adapter** (e.g. `src/app/demo/mpls-l3vpn/rrIntegration.ts`) that imports specific pure functions/constants from the other lesson's scenario file (e.g. `evaluateReflection`, `ROUTER_IP.RR1` from `bgpRouteReflector.ts`) and combines them with the current lesson's own canonical state. It never imports the other lesson's own `RouterId`/state types (that would create an inappropriate type-coupling between two independent lessons), and the reused device (e.g. RR1) never becomes a member of the current lesson's own state model — it's presentation-only, spliced into the 3D/2D graph conditionally.

## 5. `network3d/*` — the generic 3D contract

All types live in `src/components/network3d/types.ts` and carry zero protocol knowledge:

- `Node3DData` — `{ id, label, subLabel?, kind: DeviceKind, position: [x,y,z], status?: "idle"|"active"|"onPath"|"selected", badges?: string[] }`
- `Link3DData` — `{ id, a, b, label?, active?, onPath? }`
- `ActivePacket3D` — `{ packet: PacketVisual, fromId, toId }` — the one normal in-flight packet.
- `Region3DData` — `{ id, label, subLabel?, center, size, tone? }` — a labeled, clickable 3D boundary box. Originally built for BGP AS regions and Route Reflector clusters; reused as-is for EVPN's underlay-fabric region and its clickable VNI overlay region. Carries no protocol meaning — the lesson decides what a region IS.
- `DeviceInterfaceData`, `ProcessingStage`, `DeviceProcessingTrace`, `PacketStackFrame`, `LinkDetail`, `NodeExplanation` — see §7/§8 below.
- `CameraMode = "overview" | "device" | "packetFollow" | "freeOrbit"` — see §9.

`layoutTo3D` / `layoutRegionsTo3D` (`network3d/layout.ts`) are pure mappers from the *same* percent-space `{x, y}` coordinates every lesson already has for its 2D `GraphTopologyViewer` into 3D world space — a rendering-layout concern only, never a source of new topology data. `layoutTo3D` applies a small z-depth bias by device `kind` (a `p-router` sits back, a `pe-router` sits slightly forward) purely for visual "this is a core" read; nodes without a recognized kind get a default depth.

`NetworkScene3D` (`network3d/NetworkScene3D.tsx`) is the single persistent `<Canvas>` — entering/exiting "device" mode is a camera move, not a WebGL context teardown. It composes `NetworkNode3D`, `NetworkLink3D`, `Packet3D`, `Region3D`, `CameraController3D`, and (in device mode) `DeviceInteriorScene3D`.

## 6. `FloodCopy3D` — simultaneous control-plane/replication objects

`ActivePacket3D` is deliberately singular — one normal in-flight packet. Some lessons need to show **more than one object moving at once**: OSPF's LSA flood reaching multiple neighbors in the same wave, a BGP Route Reflector's mesh, or (new in the BUM/Type-3 lesson) an ingress-replicating VTEP producing several VXLAN copies from one original frame. `NetworkScene3D` accepts a separate, parallel prop for this:

```ts
interface FloodCopy3D { id: string; fromId: string; toId: string; }
floodCopies?: FloodCopy3D[];
onSelectFloodCopy?: (id: string) => void;
selectedFloodCopyId?: string;
```

Flood copies render distinctly from `activePacket` so they never read as ordinary unicast user/control traffic. A lesson computes the array fresh each render (e.g. `state.replicas.map(r => ({ id: r.id, fromId: "LEAF1", toId: r.toVtepDeviceId }))`) — there is no protocol logic inside the renderer, it just draws however many copies it's given.

## 7. `DeviceProcessingTrace` — the Conceptual [X] Pipeline

```ts
interface ProcessingStage { id: string; label: string; detail?: string; }
interface DeviceProcessingTrace {
  deviceId: string;
  ingressInterfaceId?: string;
  egressInterfaceId?: string;
  packetBefore?: string;
  packetAfter?: string;
  stages: ProcessingStage[];
  activeStageId?: string;
  completedStageIds: string[];
  forwardingAction?: string;
}
```

Rendered by `ForwardingPipeline3D` — an explicitly educational abstraction (never a claim about real ASIC internals), growing upward from a fixed base so a longer stage list only pushes the title further into headroom. It has no idea what any stage *means*; it walks `stages`/`activeStageId`/`completedStageIds` and colors accordingly (cyan = active, green = done, dim = not yet reached). The `title` prop defaults to "Conceptual Forwarding Pipeline" but every lesson with a meaningful distinct name should override it — MPLS: unchanged default is fine; BGP: "Conceptual BGP Control-Plane Pipeline"; EVPN/VXLAN: **"Conceptual VXLAN Ingress Pipeline"** at LEAF1, **"Conceptual VXLAN Egress Pipeline"** at LEAF2, a generic underlay-forwarding title at SPINE1 — chosen per-device by the page, not hardcoded in the component.

A lesson's `deviceTrace.ts` owns exactly one `Record<StageId, ProcessingStage>`-shaped stage list **per device role** (not per step) and a `traceFor(device, state, currentStepId)` function that looks up the current step index and returns the right `activeStageId`/`completedStageIds` slice. See §1's note above: a device's own trace should key its "am I currently active" logic off whether the *current step id* belongs to that device's own step-id set, not off `state.packetAt`.

## 8. Physical hardware / interface model + clickable link detail

`DeviceInterfaceData`:

```ts
interface DeviceInterfaceData {
  id: string; name: string; status: "up" | "down";
  ip?: string; neighborId?: string; neighborLabel?: string;
  linkType?: string; mtu?: number; protocols?: string[];
  packetCount?: number;
  role: "ingress" | "egress" | "idle";
  extra?: { label: string; value: string }[]; // protocol-specific fields beyond the generic set
}
```

`extra` is the escape hatch that keeps this type from needing new named fields per protocol (OSPF's Area/Cost/Hello/Dead/Network Type/Neighbor State; EVPN's VNI mapping / VTEP-source-loopback annotations) — always an array of `{label, value}`, rendered generically by `InterfaceListTab` (`network3d/DeviceExplorerPanel.tsx`).

Clicking a link in either the 2D `GraphTopologyViewer` or the 3D scene surfaces a `LinkDetail` (`{ aLabel, bLabel, aInterface, bInterface, status, mtu, protocols: {label,value}[], currentTraffic? }`) via `LinkDetailPanel` — again fully generic; a lesson's `linkDetailFor(linkId, state)` decides what "protocols" and "current traffic" mean for that specific edge (e.g. distinguishing an access port from an underlay/core link).

## 9. Camera modes + Packet Follow

`CameraMode = "overview" | "device" | "packetFollow" | "freeOrbit"`, switched via a `TopologyModeSwitcher`.

- **`overview`** — the topology at a glance. Clicking a node shows a `NodeInspectorPanel` "Quick Inspect" (no tabs) with an optional "Enter Device →" action.
- **`device`** — `DeviceInteriorScene3D` replaces the overview render inside the *same* `<Canvas>`. Shows physical interfaces, the Conceptual [X] Pipeline (§7), and the floating packet-stack frames (§10). Driven by `enteredDeviceId`; re-entering "Device" mode while already in it does **not** re-pick a new device (the effect only fires `if (!enteredDeviceId)`) — to jump to a *different* device, the page must first return to Overview (clearing `enteredDeviceId`) and re-enter, or the learner clicks a new node then "Enter Device →". This is intentional, existing behavior, not a bug to route around.
- **`packetFollow`** — a persistent `PacketFocusPanel` (Previous/Next Hop, hop counter) drives the *same* `engine.goTo()`/`engine.advance()` calls as the ordinary step controls — a "hop" is just a step that carries a packet, there is no parallel simulation. `autoEnterDevices` (a page-local toggle) makes the camera automatically follow into whichever device is currently processing (`activeDeviceId`, derived by scanning the lesson's enterable devices for one whose `traceFor(...)?.activeStageId` is defined).
- **`freeOrbit`** — unconstrained camera, no auto-focus.

## 10. Clickable packet / link / device / region — one interaction contract

Every clickable 3D (and, where applicable, 2D) object follows the same shape: the object renders a visual affordance, the page owns an `onSelect*` callback + a `selected*Id` piece of state, and clicking opens exactly one of a small set of mutually-exclusive panels, checked in a fixed priority order in the page's JSX (packet detail > link detail > region overlay > device explorer > node quick-inspect). The packet itself (`PacketStack3D` in device mode, `Packet3D`/`GraphPacket` in overview/2D) is one first-class clickable object — clicking it pauses the lesson's animation/auto-play and opens `PacketDetailPanel`, with the same Step Forward/Back semantics as the ordinary controls.

## 11. `PlaneViewSwitcher` — Control / Data / Both

A single generic three-way switch (`network3d/PlaneViewSwitcher.tsx`), deliberately not named after any one protocol. The page supplies `controlTitle`/`controlRows`/`dataTitle`/`dataRows` to `PlaneSplitPanel` (`components/protocol/PlaneSplitPanel.tsx`) — generic `{label, value}` rows — and the switcher's `show` prop (`"control"|"data"|"both"`) controls which half renders. What "control" and "data" mean is entirely up to the lesson (OSPF: Hello/DBD/LSU vs. IP forwarding; BGP: UPDATE/best-path vs. user traffic; MPLS L3VPN: VRF/RD/RT/MP-BGP vs. label-stack forwarding; EVPN/VXLAN: BGP EVPN session/Type-2 route vs. VXLAN encap/decap state).

## 12. X-Ray modes (two distinct meanings, don't conflate them)

There are two separate "X-Ray" toggles in most lessons, and they answer different questions:

1. **Device X-Ray** (`deviceXray`, toggled inside Device camera mode) — exterior chassis vs. interior view showing the Conceptual Pipeline + interfaces.
2. **Packet X-Ray mode** (`xrayMode`, a page-level toggle) — when on, `PacketInspector`/`NodeInspectorPanel`/`PacketDetailPanel` accept `focusLayerIndices: number[]` and dim every packet layer *except* the one(s) the current device/hop actually acts on (e.g. a P router only reads the outer transport label; SPINE1 only reads the outer IP; a P router's/SPINE1's the VPN label/inner frame ride along "present — not used for this hop's decision"). This is computed by the page, never inside `PacketInspector` itself, and — per §1's warning — must be keyed off *which device is being examined*, with a separately-computed version for the roaming overview inspector keyed off `state.packetAt`.

## 13. Progress / XP system

`src/lib/state/useProgressStore.ts` — a single Zustand store, persisted to `localStorage` under the key `"packetverse-progress"`.

```ts
{ xp, streak, completedLessons: string[], achievements: string[], packetsInspected, quizScore: {correct, total} }
```

- `completeLesson(lessonId, xpAward = 100)` — idempotent (re-completing awards no extra XP), always unlocks `"first-packet"` as a side effect.
- `recordAnswer(correct)` — +15 XP per correct prediction-question answer; also feeds `quizScore`.
- `inspectPacket()` — called by `PacketInspector` itself on every packet it renders; unlocks `"packet-detective"` at 10 inspections.
- `unlockAchievement(id)` — idempotent, accepts any string id.
- `levelForXp(xp)` / `xpIntoLevel(xp)` — `250` XP per level.

**The `ACHIEVEMENTS` catalog (`useProgressStore.ts`) must be kept in sync by hand.** `achievements: string[]` on the store accepts *any* id (nothing stops `unlockAchievement("some-new-id")` from succeeding), but the Dashboard (`src/app/dashboard/page.tsx`) only renders a card for ids present in the `ACHIEVEMENTS` array — an id awarded by a lesson but missing from that array is silently unlocked yet invisible to the user. **Every new lesson's completion achievement must be added to `ACHIEVEMENTS` in the same change that adds the lesson**, with a real title/description — do not treat this as optional polish.

A lesson's own `useEffect(() => { if (isComplete) { completeLesson(id, xpAward); unlockAchievement(achievementId); } }, [isComplete, ...])` fires exactly once per completion because `isComplete` only transitions `false → true` once (advancing past the last step is a no-op in the engine). Older lessons additionally guard with an `awardedRef` ref to survive React Strict Mode's double-invoke in dev — newer/simpler lessons have relied on the effect's own one-shot transition instead; either is acceptable, but prefer matching whatever the two or three most recently written lessons do.

## 14. Lesson content model (the catalog, separate from the interactive engine)

`src/lib/content/lessons/index.ts` exports a flat, pure-data `lessons: Lesson[]` array (`src/lib/content/types.ts`):

```ts
interface Lesson {
  id: string; title: string; tagline: string;
  category: "fundamentals"|"enterprise"|"service-provider"|"security"|"troubleshooting"|"automation";
  difficulty: "beginner"|"associate"|"professional"|"expert";
  prerequisites: string[];               // other Lesson ids
  estimatedMinutes: number;
  simulationPath?: string;               // "/demo/<lesson>" once a bespoke 3D scenario exists
  sections: { id: string; heading: string; body: string }[]; // currently always exactly "problem"/"solution"
  tier: "free" | "pro";
}
```

This is intentionally decoupled from `ScenarioEngine`/`network3d` — "adding a lesson never requires touching a component" for the catalog/marketing side, even before (or without) a bespoke interactive simulation existing. `src/lib/content/learningPaths.ts` separately defines the track/roadmap view (`LearningPath[]`, each a list of `{id, label, lessonId?, status}` nodes) shown on the Learning Map — a node's `status` here is a design-time default; the Dashboard recomputes real per-user status from `useProgressStore` at render time. **Every new interactive lesson needs an entry in both files**: a `Lesson` object (with `simulationPath` pointing at the new route) and, where a corresponding track node already exists (e.g. the service-provider path's `"evpn"` node), that node's `lessonId`/`status` updated to point at it.

## 15. State-restoration requirements (Previous / goTo / Restart)

Any new lesson must satisfy all of the following, verified in-browser before being called done:

1. **Previous** (`engine.goTo(index - 1)`) restores state *exactly* — including any packet/journey/table/fault state a later step's `run()` had already mutated — never just decrementing a displayed index.
2. **Timeline scrubbing** — clicking an earlier (already-completed) dot in the step-rail calls the same `goTo`, with the same guarantee.
3. **Restart** — `engine.restart()` resets all engine-owned state, but the page's `handleRestart()` must *also* reset every page-local `useState` that represents replayed/derived UI (camera mode, entered device, selected node/link/region, packet-selected, and any lesson-specific toggles like a fault-injection replay or a synthetic relay animation) — the engine has no idea these exist.
4. **No stale cross-step leakage** — a device's `DeviceProcessingTrace`/interfaces/packet-stack must reflect the *current* step precisely; going back must un-highlight a stage that hadn't been reached yet at that earlier index.
5. Achievement/XP awarding must not double-fire on Restart-then-recomplete in a way that inflates XP (`completeLesson` is idempotent per lesson id; this is enforced by the store, not by the page).

## 16. Reference file map (for the next lesson to copy from)

| Concern | Best current example |
|---|---|
| Simplest scenario shape | `scenarios/ospfArea0.ts` |
| Route Reflector-style cluster/region reuse | `scenarios/bgpRouteReflector.ts` + `Region3D` |
| Cross-lesson integration adapter (reuse without coupling) | `app/demo/mpls-l3vpn/rrIntegration.ts` |
| Two-plane (control/data) with a real fault + repair challenge | `scenarios/mplsL3vpn.ts` + `app/demo/mpls-l3vpn/page.tsx` |
| Teaching a data-plane concept *before* introducing its control plane | `scenarios/evpnVxlan.ts` (VXLAN-without-EVPN, then BGP EVPN) |
| Generic MAC/route table viewer pattern | `components/protocol/EvpnRouteTable.tsx`, `VpnRouteViewer.tsx` |
| Flood/replication visualization (`FloodCopy3D`) | `app/demo/ospf-area0/page.tsx`, `app/demo/bgp-route-reflector/page.tsx` |
| Semi-realistic devices, Question Context Mode, Focus Mode, Hop Inspector | `network3d/devices/*` + `sr-mpls-foundations` (see §17) |

## 17. Semi-realistic devices, Question Context Mode, and Focus Mode

This section documents the visual/UX upgrade layered onto the architecture above (§1–§16 unchanged) — prototyped end-to-end on SR-MPLS Foundations, smoke-tested elsewhere. Everything here is additive: a lesson that doesn't opt in keeps rendering exactly as before.

**Device visual taxonomy** (`network3d/types.ts`): `DeviceVisualKind = "ROUTER" | "SWITCH" | "FIREWALL" | "SERVER" | "HOST" | "CLOUD" | "GENERIC_NETWORK"` is a physical-chassis-shape classification, separate from the existing `DeviceKind` (`router`/`pe-router`/`p-router`/...) and from a node's logical `role` badge — a PE, P, RR, spine, or leaf are all still just a `ROUTER` shape. `deviceVisualKindFor(kind)` maps every existing `DeviceKind` to a sensible default so no lesson needs to change; `Node3DData.visualKind` lets one override it per node. `network3d/devices/*` (`Router3D`, `Switch3D`, `Firewall3D`, `Server3D`, `Host3D`, `Cloud3D`, `GenericNetwork3D`) are small procedural Three.js primitive meshes (boxes/cylinders + emissive LED accents, no textures/GLTF) dispatched by `DeviceVisual3D`; `NetworkNode3D` renders through this dispatcher instead of a plain box, sized per-kind via `theme.ts`'s `DEVICE_BOUNDS`. `NetworkLink3D`/`Link3DData` similarly gained an optional `visualState` (`normal`/`selected`/`activePath`/`controlPlane`/`backup`/`failed`/`disabled`, styled via `theme.ts`'s `LINK_STATE_STYLE`) that falls back to the original `active`/`onPath` coloring when omitted.

**Hop Inspector contract**: rather than a second, competing trace type, `DeviceProcessingTrace` (already used by `ForwardingPipeline3D`) gained optional fields — `lookupType`, `lookupKey`, `lookupResult`, `nextHopId`/`nextHopLabel`, `reason`, `packetBeforeFrames`/`packetAfterFrames` (`PacketStackFrame[]`), `mutations` (`PacketMutation[]`, a generic `PUSH`/`POP`/`SWAP`/`ENCAPSULATE`/.../`MAC_CHANGE` vocabulary that reports what happened, never decides it). A lesson's `deviceTrace.ts` populates these from data it already has (SR-MPLS's `hopInspectionFields()` derives them from the existing `JourneyHop`) — the panel computes nothing itself. `HopInspectorPanel` and `PacketDiffViewer` (both under `network3d/`) render this generically; `HopTimeline` renders only hops that have actually happened (never a future/unrevealed one, which is what keeps a prediction question spoiler-free without any extra flag).

**Question Context Mode**: `TopologyFrame` wraps a lesson's existing topology viewport (2D or 3D, unchanged) and, when the page tells it `questionActive` is true (a prediction question is the current step and unanswered), makes it `sticky`/height-clamped on desktop so it survives scrolling to the question, and shows an "Expand" button. It owns no ScenarioEngine state — the page computes `questionActive` from its own snapshot exactly like `canAdvance`/`lastAnswer` already are. Wired into `sr-mpls-foundations`, `bgp-enterprise`, `ospf-area0`, and `bgp-route-reflector` (all four with a full hand-built `TopologyFocusMode`, not just the sticky/compact treatment).

**Focus Mode**: `TopologyFocusMode` is a `fixed inset-0` overlay (not a route change) rendered from the same page state — opening/closing it touches no ScenarioEngine, camera, or selection state, so the lesson resumes exactly where it was. `PacketFlowControls` (Play/Pause/Prev/Next Hop/Reset/speed/Follow Packet/toggles) drives the *same* `engine.advance()`/`engine.goTo()` the ordinary step controls use — there is no parallel simulation, and `canAdvance()` still blocks skipping past an unanswered question inside Focus Mode too. Clicking an earlier `HopTimeline` entry does not call `engine.goTo()` (that would rewind the whole lesson) — it just points the existing `selectedNodeId`/`enteredDeviceId` state at that hop's router, and `traceFor` already reads directly off `state.journey` (which only ever grows) for any router in it, so no "time travel" state was needed (this is the "presentation-only inspection cursor" the design brief anticipated, modeled as reusing existing selection state rather than adding a new one).

**Known correctness fix**: the original `traceFor` picked a device's ingress/egress interface from the first two neighbors found in `LINKS` (`nbrs[0]`/`nbrs[1]`), regardless of which neighbor a hop actually came from or went to — harmless while nothing displayed both facts together, but visibly wrong once the Hop Inspector shows "Action: IP_FORWARD → toward R2" next to "Egress: to-R3". `directionalInterfaces()` now derives ingress/egress from the real previous/next router in `state.journey` (falling back to the old static ids only when no hop has happened yet), which also incidentally makes the *existing* device-interior interface highlighting more accurate.

## 18. Universal capability tiers — the migration standard for every lesson

This section documents the curriculum-wide standard (mandatory, see `docs/LESSON-BLUEPRINT.md` for the content-level checklist) that every lesson delivers the richest of three capability tiers its real domain data supports — never a lower tier from neglect, never a higher one by inventing data.

**Level 1 — Topology Focus** (every lesson with a 3D topology): `TopologyFrame`/`TopologyQuickExpand` (generic drop-in) or a hand-built `TopologyFrame` + `TopologyFocusMode` shell (when a lesson also needs Level 2/3) give Expand, Overview/Device/Free Orbit, node/link/interface selection, and generic object focus. `TopologyQuickExpand` stays the right choice for a lesson with no enriched trace — it deliberately shows no Hop Inspector/PacketDiff/timeline rather than faking them (see `ObjectFocusPanel`'s "No further detail modeled for this object yet" fallback, never a fabricated field).

**Level 2 — Packet Journey**: `HopTimeline` + `PacketFlowControls` inside a hand-built `TopologyFocusMode`. The **journey concept is protocol-generic, not IP-packet-specific** — a journey step may represent a DATA_PACKET, CONTROL_MESSAGE, ROUTE_UPDATE, SIGNALING_MESSAGE, FLOOD_COPY, or STATE_TRANSITION; `HopTimeline`'s `{id, label}[]` contract carries no protocol semantics itself, so a BGP UPDATE's journey is rendered exactly like SR-MPLS's, just labeled `"OPEN (R1 → R3)"` instead of `"R1: PUSH Node SID R6"`. A lesson without a growing per-hop `state.journey` array (OSPF, BGP Enterprise, BGP Route Reflector) derives its timeline entries from `<scenario>Steps.map((s,i)=>({s,i})).filter(({s,i}) => i<=index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id]!==undefined))` instead — re-describing already-decided step data (now carrying each entry's real step `index`, not just `{id,label}`) rather than adding a new log to domain state.

**Historical (timeline) inspection**: clicking an *earlier* `HopTimeline` entry must show that entry's **own** frozen state, not the router's current live state — this is a Level 3 correctness requirement, not a cosmetic nicety. It is solved generically, with no per-lesson journey-log addition: `ScenarioEngine` already snapshots `TState` into a private `stateByIndex` map the instant each step index is first entered (this is the exact mechanism `goTo()` itself restores from) — `getStateAt(index)` is a thin, read-only, protocol-agnostic getter exposing that same snapshot. A page keeps one `historicalIndex: number | undefined` state (the presentation cursor — **never** passed to `engine.goTo()`), and when set, computes `historicalState = engine.getStateAt(historicalIndex)` and re-derives `historicalStep`/`historicalPacket`/`historicalDeviceId` (via a per-lesson `deviceForStep(stepId, packet)` helper) and finally `historicalTrace = traceFor(historicalDeviceId, historicalState, ...)` — the **same** `traceFor`/`interfacesFor` functions used for live inspection, just fed the frozen historical `state` instead of the live one, which guarantees correctness by construction rather than by a second parallel implementation. The Focus Mode inspector chain renders this historical branch (with a "Historical — `<step label>`" banner and a "Return to Current →" affordance) ahead of the live `focusTrace` branch. Because `stateByIndex` entries are set once per index from an already-immutable-per-step-`run()` state object (§2) and never retroactively mutated, an old entry's snapshot provably never changes after later steps execute. `handleToggleAutoPlay()` clears `historicalIndex` (alongside `focusedObject`) whenever autoplay transitions off→on, so pressing Play always returns to live inspection and resumes the journey rather than leaving the inspector parked on a stale historical hop while the animation moves on. `bgp-enterprise/page.tsx`, `ospf-area0/page.tsx`, `bgp-route-reflector/page.tsx`, `mpls-ldp/page.tsx`, and `mpls-l3vpn/page.tsx` are the reference implementations.

**`deviceForStep` sender-vs-receiver priority**: `deviceForStep(stepId, packet)` picks a sensible default target when a timeline entry is clicked with no explicit node selection — but "sensible default" depends on which side of the packet actually has inspectable state at that exact step, and that varies by lesson. BGP/OSPF-style lessons key `traceFor` off `currentStepId` directly (a receiver's branch has real content the instant its message arrives), so `deviceForStep` there prefers the **receiver** (`packet.to ?? packet.from`). MPLS-style lessons whose `traceFor` reads a growing `state.journey: JourneyHop[]` (SR-MPLS, MPLS/LDP, MPLS L3VPN) record each hop against the router that *performed* the PUSH/SWAP/POP — the receiver's own hop isn't recorded until its own later step — so `deviceForStep` there must prefer the **sender** (`packet.from ?? packet.to`), or a receiver-priority default shows "no forwarding activity recorded" instead of the real action. Check which one actually has data before copying either convention into a new lesson.

**Level 3 — Processing Inspection**: `HopInspectorPanel` + `PacketDiffViewer` + generic object focus (`FocusTarget3D`/`ObjectFocusPanel`), same components regardless of protocol. Enriching a lesson to Level 3 means adding `ingressInterfaceId`/`egressInterfaceId`/`lookupType`/`lookupKey`/`lookupResult`/`nextHopId`/`nextHopLabel`/`reason` to `traceFor()`'s return objects — deriving every value from data the scenario file already computed (session/session-state maps, interface config, best-path tables, neighbor tables, an existing `JourneyHop`, or — for BGP Route Reflector — the real `evaluateReflection`/`reflectionCandidatesFor` rule engine's own `reason` string), never a new domain decision. `ospf-area0/deviceTrace.ts`, `bgp-enterprise/deviceTrace.ts`, `bgp-route-reflector/deviceTrace.ts`, `mpls-ldp/deviceTrace.ts`, and `mpls-l3vpn/deviceTrace.ts` are the reference implementations for enriching an *existing*, already-rich adapter this way without touching the scenario file itself. `mpls-ldp` is additionally the reference for a lesson with **two genuinely distinct journeys sharing one `traceFor`**: LDP control-plane steps are keyed off `currentStepId` (no packet, no journey entry — mirrors BGP Route Reflector's non-packet branches), while MPLS data-plane steps fall through to a `state.journey`-array lookup (mirrors SR-MPLS) — the same function serves both without a second parallel trace type. Level 3 also requires the **historical (timeline) inspection** behavior described above — a lesson isn't Level 3 if clicking an earlier `HopTimeline` entry still shows current-state data.

**`InspectorSurface` — explicit Hop-vs-Device intent ("Shared Focus Mode Inspector Fix")**: every Level 3 lesson used to infer which panel to show from whether `focusTrace` was truthy — but `traceFor` always falls back to a non-`undefined` `idleTrace(...)`, so `focusTrace` was truthy the instant any device was entered, and `HopInspectorPanel` silently won over `DeviceExplorerPanel` every time, regardless of what the learner actually clicked. The fix replaces that inference with an explicit `InspectorSurface` (`network3d/types.ts`) — `"hop" | "device"` — a page-local `inspectorSurface` state set by the actual gesture, never derived from data presence:

- A topology **node click** sets `"device"` (and clears `historicalIndex` — an explicit node click is a request for that device's *current* state, not an old one).
- A **HopTimeline entry**, **"Go to next hop"**, **Prev/Next Hop**, and **resuming Play** (`handleToggleAutoPlay`) all set `"hop"` — matching the existing rule that Play already clears `focusedObject`/`historicalIndex` on resume.
- **Object focus** (`focusedObject`) and **link detail** (`selectedLinkId`) keep their own dedicated state exactly as before, and are still checked *ahead* of the Hop/Device split in the inspector chain — `InspectorSurface` only disambiguates the one pair that was actually conflated.

The inspector chain's final order: unanswered **question** (always wins, unconditionally — Focus Mode never lets a Hop/Device switch bypass anti-spoiler) → **link detail** → **object focus** → `inspectorSurface === "device"` (→ `DeviceExplorerPanel` if a device is entered, else the existing quick-inspect `NodeInspectorPanel`, else a placeholder) → historical Hop (`historicalIndex` set) → live Hop (`focusTrace`) → placeholder. When both surfaces are actually available for the same entered device, a small `TopologyModeSwitcher` (`options: [{value:"hop"},{value:"device"}]`, `tone="violet"`) lets the learner switch explicitly — it only renders when `inDeviceMode` is true, since Device is never a real alternative to a hop for a router that hasn't been entered.

**Device Explorer during historical inspection**: `DeviceExplorerPanel` is not wired to accept a frozen `historicalState` (its explorer-tab content closures are built from live `state` in each lesson's `page.tsx`, not parameterized) — per the "do not fake it" rule, the switcher instead passes `disabledValues={["device"]}` to `TopologyModeSwitcher` while `historicalIndex` is set, so the Device button is visibly present but unclickable until the learner returns to current. This keeps the guarantee that anything Device Explorer shows is always live/current, never mislabeled historical state. A node click still force-clears `historicalIndex` (rather than leaving a stale cursor around) so the two states can never combine unexpectedly. `TopologyModeSwitcher` itself gained an optional `disabledValues?: T[]` prop for this — backward-compatible, every pre-existing call site unaffected.

MPLS L3VPN's synthetic RR1 device (`rrIntegration.ts`) is a special case: it carries no `DeviceProcessingTrace`/`state.journey` entry at all, so it has exactly one surface, not a switch — its branch in the inspector chain is checked *before* the `InspectorSurface` split and always renders `DeviceExplorerPanel` (its own `rr1ExplorerTabs`) with no Hop/Device toggle.

**Selection precedence** (every migrated lesson uses the identical rule, see `sr-mpls-foundations/page.tsx`'s comments for the canonical statement): the Hop Inspector's target is `selectedNodeId ?? effectiveDeviceId ?? activeDeviceId` — explicit click always wins. `explainTargetId` (feeding `NodeInspectorPanel`/`DeviceExplorerPanel`) keeps `effectiveDeviceId` first specifically because, in every lesson, that branch is only live while `inDeviceMode` is true, where the visible scene is the device *interior* with no other clickable topology node to conflict with it — so it never actually overrides a same-frame explicit click; this is documented per-lesson, not assumed.

**Object-focus vs. Play**: `handleToggleAutoPlay()` clears `focusedObject` whenever autoplay transitions off→on, so resuming playback always hands the camera back to Packet Follow rather than leaving it parked on a stage/layer/interface the packet has moved past. A focused object otherwise persists indefinitely while paused, until the learner explicitly backs out, picks another object, or resumes play.

**Anti-fake-data rule (mandatory)**: `PacketMutationType`, `ProcessingStage`, `DeviceInterfaceData`, `LinkDetail`, and `FocusTarget3D` may be extended with genuinely reusable, protocol-agnostic fields (e.g. `messageType?: string`, `controlPlane?: boolean`) when a real new lesson family needs them — never with a protocol-specific field (`bgpOnlyThing`, `ospfOnlyThing`) living in shared `network3d/*`. Generic components format `PUSH`/`POP`/`SWAP`/`JOIN`/`PRUNE`/`UPDATE`/`ENCAPSULATE`/`DECAPSULATE`/`STATE_CHANGE`, they never decide when one occurs.
