import type { LearningPath } from "./types";

/**
 * Structured learning maps (project brief §21). Node `status` here is
 * the *design-time* default — the dashboard recomputes real status
 * per-user from useProgressStore at render time.
 */
export const learningPaths: LearningPath[] = [
  {
    id: "fundamentals",
    title: "Networking Fundamentals",
    description: "The foundation every other track builds on.",
    nodes: [
      { id: "ethernet-switching", label: "Ethernet", lessonId: "ethernet-switching", status: "available" },
      { id: "arp-resolution", label: "ARP", lessonId: "arp-resolution", status: "available" },
      { id: "ipv4-basics", label: "IPv4", lessonId: "ipv4-basics", status: "available" },
      { id: "subnetting", label: "Subnetting", status: "locked" },
      { id: "icmp", label: "ICMP", status: "locked" },
      { id: "tcp-udp", label: "TCP/UDP", lessonId: "tcp-three-way-handshake", status: "available" },
      { id: "dhcp-dns", label: "DHCP/DNS", status: "locked" },
      { id: "switching", label: "Switching", status: "locked" },
      { id: "routing", label: "Routing", status: "locked" },
    ],
  },
  {
    id: "enterprise",
    title: "Enterprise Engineer",
    description: "Access to WAN — the path most campus network engineers live in.",
    nodes: [
      { id: "vlan", label: "VLAN", lessonId: "vlan-fundamentals", status: "available" },
      { id: "stp", label: "STP", status: "locked" },
      { id: "lacp", label: "LACP", status: "locked" },
      { id: "ospf", label: "OSPF", lessonId: "ospf-fundamentals", status: "available" },
      { id: "bgp", label: "BGP", lessonId: "bgp-fundamentals", status: "locked" },
      { id: "firewall", label: "Firewall", status: "locked" },
      { id: "vpn", label: "VPN", status: "locked" },
      { id: "sd-wan", label: "SD-WAN", status: "locked" },
    ],
  },
  {
    id: "service-provider",
    title: "Service Provider Engineer",
    description: "IS-IS, MPLS and the technologies that carry the Internet's core.",
    nodes: [
      { id: "isis", label: "IS-IS", status: "locked" },
      { id: "bgp-sp", label: "BGP", lessonId: "bgp-fundamentals", status: "locked" },
      { id: "mpls", label: "MPLS", lessonId: "mpls-fundamentals", status: "locked" },
      { id: "ldp", label: "LDP", status: "locked" },
      { id: "rr", label: "Route Reflector", lessonId: "bgp-route-reflector", status: "available" },
      { id: "rsvp", label: "RSVP", lessonId: "mpls-rsvp-te", status: "available" },
      { id: "frr", label: "Fast Reroute", lessonId: "mpls-rsvp-frr", status: "available" },
      { id: "l3vpn", label: "L3VPN", lessonId: "mpls-l3vpn", status: "available" },
      { id: "l2vpn", label: "L2VPN", lessonId: "mpls-l2vpn-vpws", status: "available" },
      { id: "vpls", label: "VPLS", lessonId: "mpls-vpls", status: "available" },
      { id: "bgp-vpls", label: "BGP-VPLS", lessonId: "bgp-vpls", status: "available" },
      { id: "h-vpls", label: "H-VPLS", lessonId: "h-vpls", status: "available" },
      { id: "evpn", label: "EVPN", lessonId: "evpn-vxlan-foundations", status: "available" },
      { id: "l2vpn-evolution", label: "L2VPN Evolution", lessonId: "l2vpn-evolution", status: "available" },
      { id: "sr", label: "Segment Routing", lessonId: "sr-mpls-foundations", status: "available" },
      { id: "sr-policy", label: "SR Policy", lessonId: "sr-policy", status: "available" },
      { id: "ti-lfa", label: "TI-LFA", lessonId: "sr-ti-lfa", status: "available" },
      { id: "flex-algo", label: "Flex-Algo", lessonId: "sr-flex-algo", status: "available" },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting Engineer",
    description: "Structured methodology for finding the fault, fast.",
    nodes: [
      { id: "packet-analysis", label: "Packet Analysis", status: "available" },
      { id: "l1", label: "Layer 1", status: "locked" },
      { id: "l2", label: "Layer 2", status: "locked" },
      { id: "l3", label: "Layer 3", status: "locked" },
      { id: "routing-ts", label: "Routing", status: "locked" },
      { id: "mpls-ts", label: "MPLS", status: "locked" },
      { id: "firewall-ts", label: "Firewall", status: "locked" },
      { id: "app-ts", label: "Application", status: "locked" },
    ],
  },
];
