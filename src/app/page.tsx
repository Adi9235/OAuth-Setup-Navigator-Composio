import { Library } from "@/components/library";
import { SearchBox } from "@/components/search-box";
import { listGuideCards } from "@/lib/db/guides";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cards = await listGuideCards();
  return (
    <div className="space-y-12">
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          How hard is it to get an OAuth app approved?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
          Difficulty, hands-on time, approval wait and blockers for registering an OAuth app with a provider —
          with evidence for every claim.
        </p>
        <div className="mt-6 text-left">
          <SearchBox />
        </div>
      </section>
      <Library cards={cards} />
    </div>
  );
}
