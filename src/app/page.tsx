import Link from "next/link";
import { HeroTopology } from "@/components/hero/HeroTopology";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const FLOW_STEPS = ["Explore", "Learn", "Visualize", "Configure", "Break", "Troubleshoot", "Test"];

const DIFFERENTIATORS = [
  { title: "Packet Journey", desc: "Follow one HTTPS request from a laptop's NIC all the way to a web server — every header, every hop.", tone: "cyan" as const },
  { title: "Interactive 3D Protocols", desc: "TCP handshakes, OSPF adjacencies and MPLS label swaps you drive step-by-step, not a video you watch.", tone: "violet" as const },
  { title: "Break the Network", desc: "Inject a real fault — wrong VLAN, missing route, ASN mismatch — into a working topology and find it yourself.", tone: "danger" as const },
  { title: "Troubleshooting Arena", desc: "A CLI, a broken topology, and a complaint. Your methodology is scored, not just your final answer.", tone: "warning" as const },
  { title: "Multi-Vendor CLI", desc: "The same concept shown in Cisco IOS, Junos, Palo Alto and the RFC's own language, side by side.", tone: "success" as const },
  { title: "Certification Tracks", desc: "Structured paths toward CCNA, CCNP, JNCIA through JNCIE-SP — original questions, same depth.", tone: "cyan" as const },
];

const ENTERPRISE_PATH = ["Access — VLAN, STP, LACP, 802.1X, DHCP", "Distribution — Inter-VLAN, FHRP, OSPF", "Core — OSPF, IS-IS, BGP", "Firewall — Policies, NAT, VPN", "WAN — Internet, SD-WAN, MPLS VPN, Cloud"];
const SP_PATH = ["CE Router — Customer edge", "PE Router — VRF, MP-BGP, MPLS", "P Router — IS-IS/OSPF, LDP, RSVP, SR", "PE Router — remote edge", "CE Router — remote customer site"];

export default function Home() {
  return (
    <div>
      {/* HERO */}
      <section className="relative flex min-h-[92vh] items-center overflow-hidden border-b border-pv-border">
        <div className="pv-grid-bg absolute inset-0" />
        <HeroTopology />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-pv-bg via-transparent to-pv-bg/40" />

        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 flex justify-center">
            <Badge tone="cyan">Interactive 3D Networking Platform</Badge>
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-pv-text sm:text-6xl">
            Don&apos;t memorize networking.
            <br />
            <span className="text-pv-cyan-soft">See it happen.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-pv-text-muted sm:text-lg">
            Explore protocols, follow packets, configure routers and troubleshoot real networks through interactive
            visual labs — not another wall of documentation.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/learn">
              <Button size="lg">Explore Network</Button>
            </Link>
            <Link href="/demo/first-connection">
              <Button size="lg" variant="secondary">
                Try Interactive Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="border-b border-pv-border px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-pv-cyan-soft">The philosophy</p>
          <h2 className="text-balance text-center text-2xl font-semibold text-pv-text sm:text-3xl">
            Instead of reading <span className="text-pv-text-faint line-through">&ldquo;TCP uses a three-way handshake&rdquo;</span>
          </h2>
          <p className="mt-2 text-center text-2xl font-semibold text-pv-cyan-soft sm:text-3xl">you watch it happen, one packet at a time.</p>

          <GlassPanel strong className="mx-auto mt-10 max-w-2xl p-6 sm:p-8">
            <div className="flex flex-col items-center gap-4 pv-mono text-xs sm:text-sm">
              <div className="flex w-full items-center justify-between gap-4">
                <Badge tone="cyan">Client</Badge>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <span className="text-pv-success">SYN →</span>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <Badge tone="violet">Server</Badge>
              </div>
              <div className="flex w-full items-center justify-between gap-4">
                <Badge tone="cyan">Client</Badge>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <span className="text-pv-warning">← SYN-ACK</span>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <Badge tone="violet">Server</Badge>
              </div>
              <div className="flex w-full items-center justify-between gap-4">
                <Badge tone="cyan">Client</Badge>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <span className="text-pv-success">ACK →</span>
                <span className="h-px flex-1 bg-pv-border-strong" />
                <Badge tone="violet">Server</Badge>
              </div>
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* EXPLORE -> TEST FLOW */}
      <section className="border-b border-pv-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-pv-cyan-soft">Every topic, one process</p>
          <h2 className="mb-12 text-center text-2xl font-semibold text-pv-text sm:text-3xl">
            Explore → Understand → Visualize → Configure → Break → Troubleshoot → Test
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {FLOW_STEPS.map((step, i) => (
              <GlassPanel key={step} className="flex flex-col items-center gap-2 p-4">
                <span className="pv-mono text-[10px] text-pv-text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-sm font-medium text-pv-text">{step}</span>
              </GlassPanel>
            ))}
          </div>
        </div>
      </section>

      {/* DIFFERENTIATORS */}
      <section className="border-b border-pv-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-pv-cyan-soft">Why PacketVerse</p>
          <h2 className="mb-12 text-center text-2xl font-semibold text-pv-text sm:text-3xl">Competes on interaction, not more text</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <GlassPanel key={d.title} className="p-6">
                <Badge tone={d.tone} className="mb-4">
                  {d.title}
                </Badge>
                <p className="text-sm leading-relaxed text-pv-text-muted">{d.desc}</p>
              </GlassPanel>
            ))}
          </div>
        </div>
      </section>

      {/* LEARNING PATHS PREVIEW */}
      <section className="border-b border-pv-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-pv-cyan-soft">Two worlds, one mental map</p>
          <h2 className="mb-12 text-center text-2xl font-semibold text-pv-text sm:text-3xl">Enterprise vs. Service Provider</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <GlassPanel strong className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-pv-cyan-soft">Enterprise Network</h3>
              <ol className="space-y-3">
                {ENTERPRISE_PATH.map((step, i) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-pv-text-muted">
                    <span className="pv-mono mt-0.5 text-xs text-pv-text-faint">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </GlassPanel>
            <GlassPanel strong className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-pv-violet">Service Provider Network</h3>
              <ol className="space-y-3">
                {SP_PATH.map((step, i) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-pv-text-muted">
                    <span className="pv-mono mt-0.5 text-xs text-pv-text-faint">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </GlassPanel>
          </div>
          <div className="mt-8 text-center">
            <Link href="/learn">
              <Button variant="secondary">View the full learning map</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-6 py-24">
        <GlassPanel strong glow="cyan" className="mx-auto flex max-w-4xl flex-col items-center gap-6 p-12 text-center">
          <h2 className="text-2xl font-semibold text-pv-text sm:text-3xl">See your first packet in under two minutes.</h2>
          <p className="max-w-xl text-sm text-pv-text-muted">
            The flagship demo walks a real HTTPS connection — ARP, switching, routing, and the TCP handshake — with
            you driving every step.
          </p>
          <Link href="/demo/first-connection">
            <Button size="lg">Start the Demo</Button>
          </Link>
        </GlassPanel>
      </section>
    </div>
  );
}
