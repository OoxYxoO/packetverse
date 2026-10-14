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
      { id: "subnetting", label: "Subnetting", lessonId: "subnetting-design", status: "available" },
      { id: "icmp", label: "ICMP", lessonId: "icmp-diagnostics", status: "available" },
      { id: "tcp-udp", label: "TCP & UDP", lessonId: "tcp-three-way-handshake", status: "available" },
      { id: "dhcp-dns", label: "DHCP/DNS", lessonId: "dhcp-dns", status: "available" },
      { id: "switching", label: "Switching", lessonId: "switching-fundamentals", status: "available" },
      { id: "routing", label: "Routing", lessonId: "routing-fundamentals", status: "available" },
    ],
  },
  {
    id: "enterprise",
    title: "Enterprise Engineer",
    description: "Access to WAN — the path most campus network engineers live in.",
    nodes: [
      { id: "vlan", label: "VLAN", lessonId: "vlan-fundamentals", status: "available" },
      { id: "stp", label: "STP", lessonId: "stp-rstp", status: "available" },
      { id: "lacp", label: "LACP", lessonId: "lacp-link-aggregation", status: "available" },
      { id: "ospf", label: "OSPF", lessonId: "ospf-fundamentals", status: "available" },
      { id: "bgp", label: "BGP", lessonId: "bgp-fundamentals", status: "locked" },
      { id: "firewall", label: "Firewall", lessonId: "firewall-stateful-security", status: "available" },
      { id: "vpn", label: "VPN", lessonId: "ipsec-site-to-site-vpn", status: "available" },
      { id: "sd-wan", label: "SD-WAN", lessonId: "sdwan-path-selection", status: "available" },
    ],
  },
  {
    id: "service-provider",
    title: "Service Provider Engineer",
    description: "IS-IS, MPLS and the technologies that carry the Internet's core.",
    nodes: [
      { id: "isis", label: "IS-IS", lessonId: "isis-fundamentals", status: "available" },
      { id: "bgp-sp", label: "BGP", lessonId: "bgp-fundamentals", status: "locked" },
      { id: "mpls", label: "MPLS Forwarding", lessonId: "mpls-fundamentals", status: "available" },
      { id: "ldp", label: "LDP Control Plane", lessonId: "mpls-fundamentals", status: "available" },
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
      { id: "srv6-foundations", label: "SRv6 Foundations", lessonId: "srv6-foundations", status: "available" },
      { id: "srv6-endpoint-behaviors", label: "SRv6 Endpoint Behaviors", lessonId: "srv6-endpoint-behaviors", status: "available" },
      { id: "srv6-policy", label: "SRv6 Traffic Engineering", lessonId: "srv6-policy", status: "available" },
      { id: "srv6-l3vpn", label: "SRv6 L3VPN", lessonId: "srv6-l3vpn", status: "available" },
      { id: "srv6-ti-lfa", label: "SRv6 Protection / TI-LFA", lessonId: "srv6-ti-lfa", status: "available" },
      { id: "srv6-csid", label: "SRv6 Compressed SID (CSID / uSID)", lessonId: "srv6-csid", status: "available" },
      { id: "sr-mpls-vs-srv6", label: "SR-MPLS vs SRv6 Engineering Capstone", lessonId: "sr-mpls-vs-srv6", status: "available" },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting Engineer",
    description: "Structured methodology for finding the fault, fast.",
    nodes: [
      { id: "packet-analysis", label: "Packet Analysis", lessonId: "troubleshooting-packet-analysis", status: "available" },
      { id: "l1", label: "Layer 1", lessonId: "troubleshooting-layer1", status: "available" },
      { id: "l2", label: "Layer 2", lessonId: "troubleshooting-layer2", status: "available" },
      { id: "l3", label: "Layer 3", lessonId: "troubleshooting-layer3", status: "available" },
      { id: "routing-ts", label: "Routing", lessonId: "troubleshooting-routing", status: "available" },
      { id: "mpls-ts", label: "MPLS", lessonId: "troubleshooting-mpls", status: "available" },
      { id: "firewall-ts", label: "Firewall", lessonId: "troubleshooting-firewall", status: "available" },
      { id: "app-ts", label: "Application", lessonId: "troubleshooting-application", status: "available" },
    ],
  },
];
