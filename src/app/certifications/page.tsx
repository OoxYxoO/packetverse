import type { Metadata } from "next";
import { CertificationCatalog } from "@/components/certifications/CertificationCatalog";

export const metadata: Metadata = { title: "Certifications · PacketVerse", description: "Study for a certification with interactive, multi-vendor networking lessons." };

export default function CertificationsPage() {
  return <CertificationCatalog />;
}
