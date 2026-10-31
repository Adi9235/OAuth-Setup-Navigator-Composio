// GET /api/guides/[slug]     -> guide JSON
// GET /api/guides/[slug].md  -> Markdown export ([slug] captures "github.md")
import { NextResponse } from "next/server";
import { getGuideBySlug } from "@/lib/db/guides";
import { env } from "@/lib/env";
import { guideToMarkdown } from "@/lib/markdown-export";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug: raw } = await params;
    const markdown = raw.endsWith(".md");
    const slug = markdown ? raw.slice(0, -3) : raw;
    const detail = /^[a-z0-9-]{1,80}$/.test(slug) ? await getGuideBySlug(slug) : null;
    if (!detail) throw new HttpError(404, "Guide not found");

    const lastVerifiedAt = detail.guide.last_verified_at ? new Date(detail.guide.last_verified_at).toISOString() : null;
    if (markdown) {
      const md = guideToMarkdown(detail.version.content, {
        url: `${env().APP_BASE_URL}/guides/${slug}`,
        versionNo: detail.version.version_no,
        lastVerifiedAt,
      });
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `inline; filename="${slug}-oauth-guide.md"`,
        },
      });
    }
    return NextResponse.json({
      app: { name: detail.app.name, slug: detail.app.slug, domain: detail.app.primary_domain, developerPortalUrl: detail.app.developer_portal_url },
      guide: detail.version.content,
      version_no: detail.version.version_no,
      freshness: detail.guide.freshness,
      last_verified_at: lastVerifiedAt,
      versions: detail.versions,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
