import type { Metadata } from "next";
import { CCNA } from "@/lib/content/certifications";
import { CertificationJourney } from "@/components/certifications/CertificationJourney";

export const metadata: Metadata = { title: "CCNA journey · PacketVerse", description: "Every CCNA 200-301 topic as interactive lessons, organized by exam domain and study order." };

export default function CcnaPage() {
  return <CertificationJourney cert={CCNA} />;
}
