import { createFirstConnectionState } from "@/lib/sim-engine/scenarios/firstConnection";
import type { ArpLabState } from "@/lib/sim-engine/scenarios/arpLab";
import type { CliNetworkView } from "./cliAdapter";

/** R1's static configuration (interfaces + connected/default routes) — identical in the lesson and the lab; ARP Lab events never change it. */
const R1_ROUTES = createFirstConnectionState().routingTable;

/**
 * ARP Lab state → the CLI's network view. This is the ONLY bridge from
 * lab state to the shared first-connection CLI adapter; the guided
 * lesson's ScenarioEngine is never consulted here.
 */
export function arpLabCliView(lab: ArpLabState): CliNetworkView {
  return {
    arpTable: { laptop: lab.laptopArp, router: lab.routerArp },
    macTable: { switch: lab.switchMac },
    routingTable: R1_ROUTES,
  };
}
