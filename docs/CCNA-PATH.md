# CCNA on PacketVerse — architecture, coverage map and build plan

Students told us they want to study by certification. This document records how PacketVerse does that without
becoming a Cisco-only, checklist-shaped site, and what had to be built for CCNA. CCNP is next and is out of scope here.

## 1. Architecture: one lesson catalog, many ways in

```
Lessons (src/lib/content/lessons)          one implementation per topic: model, guided lesson, guide, Deep Dive, lab
   ▲                 ▲
   │                 │
Certifications        Career tracks (src/lib/content/learningPaths.ts)
(src/lib/content/     Fundamentals · Enterprise · Service Provider · Troubleshooting
 certifications/)
   CCNA 200-301
     6 exam domains → objectives → lessons (core / practice / go further)
     study plan     → stages in teaching order, prerequisites
```

- **A lesson exists once.** VLANs are taught by `vlan-fundamentals`, whether the student arrives from CCNA › Network
  Access or from the Enterprise track. A certification only *references* lessons; it never copies them.
- **A certification is a lens, not a container.** It adds what a certification student needs on top of the catalog:
  the exam's domains and their weights, the objectives each lesson covers, a teaching order across domains, and
  checkpoint questions in the exam's style.
- **Progress is derived, never duplicated.** Certification progress is computed from the same `completedLessons`
  the rest of the platform uses. XP, streaks, achievements and track progress are untouched. The only new stored
  state is the result of each domain checkpoint (additive, optional).
- **Certification-first is the primary entry point** (home page, navigation, the CCNA journey page), while the
  career tracks and the full catalog stay, unchanged, for students who learn by role or by topic.
- **Vendor-neutral teaching, exam-aligned organization.** The certification decides *which topics* a student must
  master. Lessons keep teaching the networking itself, with Cisco and Junos side by side where the existing labs
  already do so. A lesson says when a name is Cisco's (HSRP, CDP, Rapid PVST+, EtherChannel) and what the standard or
  multi-vendor equivalent is (VRRP, LLDP, RSTP/MSTP, LACP/802.3ad).

### Lesson roles inside a certification

| Role | Meaning | Counts toward CCNA progress |
|---|---|---|
| **Core** | Teaches an exam objective. | Yes |
| **Practice** | Applies core objectives to troubleshooting (the Troubleshooting track's L1/L2/L3 lessons). | No — shown as practice |
| **Go further** | Real-world context beyond the exam (SD-WAN as a controller-based example, the stateful firewall). | No |

## 2. Coverage map (from an evidence survey of every lesson folder)

Legend: **Strong** = existing lesson teaches it well · **Expand** = existing lesson, gap closed in this work ·
**Reuse** = taught well in a lesson from another track · **New** = new lesson built for this path.

### 1.0 Network Fundamentals (20 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| Network components | New | `network-components-architectures` |
| Architectures: 2-tier, 3-tier, spine-leaf, SOHO, WAN, on-prem/cloud | New | `network-components-architectures` |
| Physical cabling: copper, fiber | New (basics) + Reuse (faults) | `cabling-interfaces`, practice: `troubleshooting-layer1` |
| Interface and cable issues (errors, duplex, speed) | Reuse — strong | `troubleshooting-layer1` (practice) + `cabling-interfaces` |
| TCP and UDP | Strong | `tcp-three-way-handshake` |
| IPv4 addressing, subnetting, private ranges | Strong | `ipv4-basics`, `subnetting-design` |
| IPv6 addressing (types, EUI-64, SLAAC, link-local) | New | `ipv6-addressing` |
| Wireless principles | New | `wireless-principles` |
| Virtualization (VMs, containers, VRFs) | New | `virtualization-fundamentals` |
| Switching concepts (learning, aging, flooding) | Strong | `ethernet-switching`, `switching-fundamentals` |
| Supporting: ARP, ICMP and client verification | Strong | `arp-resolution`, `icmp-diagnostics` |

### 2.0 Network Access (20 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| VLANs, access ports, inter-VLAN routing | Strong | `vlan-fundamentals` |
| 802.1Q trunking, native VLAN | Strong | `vlan-fundamentals` |
| Discovery protocols: CDP, LLDP | New | `discovery-protocols` |
| EtherChannel, LACP (and PAgP) | Strong + Expand (PAgP) | `lacp-link-aggregation` |
| STP: Rapid PVST+, PortFast, BPDU Guard, Root Guard, Loop Guard | Strong + Expand (Loop Guard, per-VLAN) | `stp-rstp` |
| Wireless architectures, AP modes, WLC connections and management | New | `wireless-architectures` |
| Practice | Reuse | `troubleshooting-layer2` |

### 3.0 IP Connectivity (25 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| Interpreting the routing table: AD, metric, longest prefix match | Strong | `routing-fundamentals` |
| IPv4 static, default, network and host routes | Strong | `routing-fundamentals` |
| Floating static routes, IPv6 static routes | New | `static-routing-floating-ipv6` |
| Single-area OSPFv2 | Strong | `ospf-fundamentals` |
| OSPF on broadcast networks: DR/BDR election, router ID | New (the OSPF lab is point-to-point) | `ospf-dr-bdr` |
| First Hop Redundancy: HSRP, VRRP | New | `fhrp-hsrp-vrrp` |
| Practice | Reuse | `troubleshooting-layer3` |

### 4.0 IP Services (10 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| NAT (static, pool) and PAT | New (router NAT); Reuse (firewall PAT) | `nat-pat`; go further: `firewall-stateful-security` |
| NTP, syslog, SNMP | New | `ntp-syslog-snmp` |
| DHCP (client, server, relay) and DNS | Strong | `dhcp-dns` |
| SSH, TFTP, FTP | New | `device-management-ssh` |
| QoS | New | `qos-fundamentals` |

### 5.0 Security Fundamentals (15 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| Security threats, vulnerabilities, mitigation, security program | New | `security-fundamentals` |
| Device access, passwords, AAA, TACACS+, RADIUS | New | `device-access-aaa` |
| ACLs | New (no ACL lesson existed) | `access-control-lists` |
| Layer 2 security: port security, DHCP snooping, DAI, RA Guard, storm control | New | `layer2-security` |
| VPNs (site-to-site, remote access) | Reuse — strong | `ipsec-site-to-site-vpn` |
| Wireless security: WPA2, WPA3 | New | `wireless-security` |
| Go further | Reuse | `firewall-stateful-security` |

### 6.0 Automation and Programmability (10 %)

| Curriculum topic | Coverage | Lesson |
|---|---|---|
| Controller-based networking, SDN planes, northbound/southbound APIs, cloud-managed networks | New | `controller-based-networking` |
| REST APIs, JSON | New | `rest-apis-json` |
| Configuration management: Ansible, Terraform, Puppet, Chef | New | `configuration-management` |
| Generative AI and machine learning in network operations | New | `ai-ml-network-operations` |
| Go further | Reuse | `sdwan-path-selection` (a real controller-based WAN) |

### Out of the CCNA path (still on PacketVerse, in their own tracks)

BGP, MPLS, Segment Routing, SRv6, EVPN/VXLAN, VPLS, IS-IS — beyond CCNA scope. They stay in the Enterprise and
Service Provider tracks.

## 3. Study order

The exam domains are the organization a student checks progress against. The *study plan* is the order that
teaches best: it crosses domains where prerequisites demand it (IPv6 static routes need IPv6 addressing; VRFs need
routing; wireless is taught as one arc of principles → architecture → security). See `ccna.ts` (`stages`).

## 4. Build plan

One domain at a time, each finished (lessons, alignment, checkpoint, QA) before the next:

1. Architecture + CCNA journey UI over the existing lessons (new lessons shown as "in development").
2. Network Fundamentals → 3. Network Access → 4. IP Connectivity → 5. IP Services → 6. Security Fundamentals →
7. Automation and Programmability.

Status: all seven steps are done. Every module in `ccna.ts` resolves to a playable catalog lesson (23 new, 2
expanded, the rest reused), every objective has at least one core lesson, and every domain has a checkpoint with
at least one question per objective.

Decisions made in final QA:

- `wireless-security` keeps the wireless arc (principles → architecture → security) and explains 802.1X/RADIUS
  itself, so it does not require `device-access-aaa`, which is studied later.
- In the security stage, `firewall-stateful-security` comes before `ipsec-site-to-site-vpn`, which lists it as a
  prerequisite.
- Checkpoint answers are spread across positions a–d, and the correct option is not systematically the longest:
  the dialog does not shuffle options, so the data itself must not give the answer away.

New lessons use the house guided-lesson shell (`FundamentalsLessonShell`): a protocol model in
`src/lib/sim-engine/scenarios/`, a guided step journey with predictions, device X-ray, an incident with layered
diagnosis and a repair challenge, a Lesson Guide and a Deep Dive. The separate practice-lab workspace and the
narrated video are not built for new lessons in this pass; the catalog records which lessons have them.
