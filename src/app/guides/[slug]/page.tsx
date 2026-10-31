import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideView } from "@/components/guide-view";
import { getGuideBySlug } from "@/lib/db/guides";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getGuideBySlug(slug);
  if (!detail) return { title: "Guide not found" };
  const s = detail.version.content.summary;
  return {
    title: `${detail.app.name} OAuth setup`,
    description: `${s.difficulty[0].toUpperCase()}${s.difficulty.slice(1)} — ${s.oneLiner}`,
  };
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const detail = await getGuideBySlug(slug);
  if (!detail) notFound();
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Library</Link> <span aria-hidden>/</span> {detail.app.name}
      </nav>
      <GuideView
        guide={detail.version.content}
        meta={{
          slug: detail.app.slug,
          versionNo: detail.version.version_no,
          freshness: detail.guide.freshness,
          lastVerifiedAt: detail.guide.last_verified_at ? new Date(detail.guide.last_verified_at).toISOString() : null,
          versions: detail.versions,
        }}
      />
    </>
  );
}
