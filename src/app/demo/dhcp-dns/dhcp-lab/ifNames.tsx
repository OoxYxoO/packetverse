"use client";

import { createContext, useContext } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { DL_IFACES, type DlIface } from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * What an interface is called, everywhere in the lab: the topology, device cards and windows, captures, Follow.
 * R1 and the switches use the names of the OS view the student picked (IOS: Gi0/0, Gi1/0/24 · Junos: ge-0/0/0,
 * ge-0/0/24), exactly as their CLI prints them; hosts keep their own OS's name (the laptop's "Ethernet", eth0).
 */
export type IfNamer = (i: DlIface) => string;
export const ifNamer =
  (vendor: CliVendor): IfNamer =>
  (i) => {
    const info = DL_IFACES[i];
    return vendor === "cisco" && (info.node === "R1" || info.node === "SW1" || info.node === "SW2") ? info.cisco : info.name;
  };
export const IfNameContext = createContext<IfNamer>(ifNamer("juniper"));
export const useIfName = () => useContext(IfNameContext);
