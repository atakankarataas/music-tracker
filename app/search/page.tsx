import { Search } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, EntityList, PageHeader, SectionHeader, Surface } from "@/components/ui";
import { searchEntities } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.slice(0, 100);
  const results = await searchEntities(query);
  const hasResults = results.artists.length + results.albums.length + results.tracks.length > 0;

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Find" title="Search" description="Search across your complete listening history." />
      <form action="/search" className="search-field search-field-large">
        <Search aria-hidden="true" size={19} strokeWidth={1.5} />
        <input autoFocus defaultValue={query} name="q" placeholder="Artist, album or track" type="search" />
      </form>

      {!query ? <EmptyState title="Search your archive" detail="Enter an artist, album or track name." /> : !hasResults ? <EmptyState title="No results" detail={`Nothing in your archive matches “${query}”.`} /> : (
        <div className="search-results">
          {results.artists.length ? <Surface><SectionHeader title="Artists" /><EntityList items={results.artists} kind="artist" /></Surface> : null}
          {results.albums.length ? <Surface><SectionHeader title="Albums" /><EntityList items={results.albums} kind="album" /></Surface> : null}
          {results.tracks.length ? <Surface><SectionHeader title="Tracks" /><EntityList items={results.tracks} kind="track" /></Surface> : null}
        </div>
      )}
    </div>
  );
}
