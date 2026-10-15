import { CCNA } from "./ccna";
import type { Certification } from "./types";

export * from "./types";
export { CCNA };

/**
 * The certifications a student can choose. CCNA is the first one built; CCNP is next and is listed only so a student
 * can see where the path continues — it has no domains yet.
 */
export const CERTIFICATIONS: Certification[] = [
  CCNA,
  {
    id: "ccnp-enterprise",
    title: "CCNP Enterprise",
    fullName: "Cisco Certified Network Professional — Enterprise",
    vendor: "Cisco",
    examCode: "350-401",
    status: "next",
    summary: "The professional enterprise path, built the same way once CCNA is complete.",
    domains: [],
    stages: [],
    checkpoints: {},
  },
];

export const getCertification = (id: string) => CERTIFICATIONS.find((c) => c.id === id);

/** Every certification module that references a lesson, with its domain — for lesson pages that show where they belong. */
export function certificationsForLesson(lessonId: string) {
  return CERTIFICATIONS.flatMap((cert) =>
    cert.domains.flatMap((domain) => domain.modules.filter((m) => m.lessonId === lessonId).map((module) => ({ cert, domain, module }))),
  );
}
