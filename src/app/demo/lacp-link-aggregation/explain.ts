import type { NodeExplanation } from "@/components/network3d/types";
import { FLOWS, HOST_IP, HOST_MAC, HOST_SW, LAG1_KEY, LAG_NAME, MEMBERS, SYSTEMS, bitsText, eligible, lagStatus, selectable, type FlowId, type LacpDevice, type LacpHost, type LacpSide, type LacpState } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";

type Table = { title: string; rows: { label: string; value: string }[] };

export function lacpTables(device: LacpDevice, s: LacpState): Table[] {
  if (device === "SW1" || device === "SW2") {
    const side = device as LacpSide;
    return [
      {
        title: "LACP system",
        rows: [
          { label: "System Priority", value: String(SYSTEMS[side].priority) },
          { label: "System ID (MAC)", value: SYSTEMS[side].mac },
          { label: `${LAG_NAME} local key`, value: String(LAG1_KEY[side]) },
          { label: "Mode", value: s.mode[side] === "active" ? "Active" : "Passive" },
        ],
      },
      { title: LAG_NAME, rows: [{ label: "Status", value: lagStatus(s).text }, { label: "Distributing members", value: eligible(s, side).join(", ") || "none" }] },
      {
        title: "Members",
        rows: MEMBERS.flatMap((m) => {
          const l = s.lacp[side][m];
          const sel = selectable(s, side, m);
          return [
            { label: `${m} physical`, value: s.up[m] ? "up" : "DOWN" },
            { label: `${m} actor`, value: `key ${s.key[side][m]} · ${bitsText(l.actor)}` },
            { label: `${m} partner`, value: l.partner ? `key ${l.partner.key} · ${bitsText(l.partner.state)}` : "none (defaulted)" },
            { label: `${m} in ${LAG_NAME}`, value: sel.ok ? "selected" : `not selected — ${sel.why}` },
          ];
        }),
      },
      { title: "Flows (PacketVerse modeled hash)", rows: (Object.keys(FLOWS) as FlowId[]).map((f) => ({ label: `${f} ${FLOWS[f].src} → ${FLOWS[f].dst}`, value: s.flowMap[f] ?? "— (hashed on next packet)" })) },
    ];
  }
  const h = device as LacpHost;
  const flows = (Object.keys(FLOWS) as FlowId[]).filter((f) => FLOWS[f].src === h || FLOWS[f].dst === h);
  return [
    {
      title: "Host",
      rows: [
        { label: "IPv4", value: `${HOST_IP[h]}/24` },
        { label: "MAC", value: HOST_MAC[h] },
        { label: "Attached to", value: `${HOST_SW[h].sw} ${HOST_SW[h].port}` },
        ...flows.map((f) => ({ label: `${f} path`, value: `${FLOWS[f].src} → SW1 → ${LAG_NAME}${s.flowMap[f] ? ` (${s.flowMap[f]})` : ""} → SW2 → ${FLOWS[f].dst}` })),
      ],
    },
  ];
}

export function explainLacp(s: LacpState, id: string, stepId: string): NodeExplanation {
  const device = id as LacpDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = lacpTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "SW1" || device === "SW2") {
    const side = device as LacpSide;
    return {
      id,
      name: side,
      deviceType: "Ethernet switch with LACP",
      role: `${LAG_NAME} end · System ${SYSTEMS[side].priority} / ${SYSTEMS[side].mac} · local key ${LAG1_KEY[side]}`,
      currentAction: act,
      controlPlaneRole: "LACPDUs on each member decide which members are selected, synchronized, collecting and distributing.",
      dataPlaneRole: hop ? `In: ${hop.input}. Result: ${hop.output}.` : `Customer frames use ${LAG_NAME}; the forwarding logic pins each flow to one eligible member.`,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: s.faultActive && side === "SW2" ? "A member's configuration changed during the clean-up." : undefined,
      tables,
    };
  }
  const h = device as LacpHost;
  return {
    id,
    name: h,
    deviceType: "Ethernet/IPv4 host",
    role: `Attached to ${HOST_SW[h].sw}`,
    currentAction: act,
    controlPlaneRole: "Hosts don't run LACP and never see member links.",
    dataPlaneRole: hop ? `${hop.lookupResult}.` : "Sends ordinary Ethernet/IPv4 frames.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
