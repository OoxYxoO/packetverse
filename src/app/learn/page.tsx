import Link from "next/link";
import { learningPaths } from "@/lib/content/learningPaths";
import { lessons } from "@/lib/content/lessons";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { ProgressNetwork } from "@/components/dashboard/ProgressNetwork";

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Badge tone="cyan" className="mb-3">
        Learning Map
      </Badge>
      <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Four tracks, one interactive network</h1>
      <p className="mt-2 max-w-2xl text-sm text-pv-text-muted">
        Every node below either opens a lesson with an interactive simulation, or is queued for a future release.
        Free lessons are unmarked; Pro-tier topics unlock BGP, MPLS, EVPN and the advanced troubleshooting arena.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {learningPaths.map((path) => (
          <GlassPanel key={path.id} strong className="p-6">
            <h2 className="text-sm font-semibold text-pv-cyan-soft">{path.title}</h2>
            <p className="mt-1 mb-4 text-xs text-pv-text-muted">{path.description}</p>
            <ProgressNetwork path={path} />
          </GlassPanel>
        ))}
      </div>

      <div className="mt-16">
        <h2 className="mb-4 text-lg font-semibold text-pv-text">Lesson Catalog</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((lesson) => {
            const card = (
              <GlassPanel
                className={`h-full p-5 transition-colors ${lesson.simulationPath ? "hover:border-pv-border-strong" : "opacity-60"}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone={lesson.tier === "pro" ? "violet" : "success"}>{lesson.tier}</Badge>
                  <Badge tone="muted">{lesson.difficulty}</Badge>
                  {!lesson.simulationPath && <Badge tone="warning">Soon</Badge>}
                </div>
                <h3 className="text-sm font-semibold text-pv-text">{lesson.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-pv-text-muted">{lesson.tagline}</p>
                <p className="mt-3 text-[11px] text-pv-text-faint">{lesson.estimatedMinutes} min · {lesson.category}</p>
              </GlassPanel>
            );
            return lesson.simulationPath ? (
              <Link key={lesson.id} href={lesson.simulationPath}>
                {card}
              </Link>
            ) : (
              <div key={lesson.id}>{card}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
