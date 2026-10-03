"use client";

import type { CliVendor } from "@/lib/cli/types";
import { LiveStateCard } from "@/components/practice-lab/LiveStateCard";
import type { SwitchPortId } from "@/lib/sim-engine/scenarios/firstConnection";
import { whyLearned, type ArpLabState, type ArpLabTable } from "@/lib/sim-engine/scenarios/arpLab";
import { interfaceAlias } from "../cliAdapter";

const portName = (vendor: CliVendor, id: SwitchPortId) => interfaceAlias(vendor, { kind: "switch", id });

/** ARP's live state: two ARP caches and SW1's MAC table, as generic LiveStateCards fed from ArpLabState. */
export function ArpLabTables({ lab, vendor, openWhy, onWhy }: { lab: ArpLabState; vendor: CliVendor; openWhy?: string; onWhy: (id: string | undefined) => void }) {
  const fresh = (table: ArpLabTable, key: string) => lab.learned.some((l) => l.table === table && l.key === key);
  const card = (title: string, caption: string, table: ArpLabTable, entries: [string, string][], device: string) => (
    <LiveStateCard
      title={title}
      caption={caption}
      pulseKey={lab.transit?.id}
      openWhy={openWhy}
      onWhy={onWhy}
      whyHeading={`Why did ${device} learn this?`}
      rows={entries.map(([primary, secondary]) => ({ key: primary, primary, secondary, fresh: fresh(table, primary), why: whyLearned(table, primary) }))}
    />
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      {card("Laptop ARP", "IP → MAC", "laptop-arp", Object.entries(lab.laptopArp), "Laptop")}
      {card("SW1 MAC", "MAC → PORT", "switch-mac", Object.entries(lab.switchMac).map(([mac, port]) => [mac, portName(vendor, port)]), "SW1")}
      {card("R1 ARP", "IP → MAC", "router-arp", Object.entries(lab.routerArp), "R1")}
    </div>
  );
}
