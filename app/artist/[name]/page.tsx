import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EntityDetail } from "@/components/entity-detail";
import { getArtistDetail } from "@/lib/data";
import { decodeDetailParam, getDetailPageFeatures, parseDetailPeriod } from "@/lib/detail-features";

export const dynamic = "force-dynamic";

type ArtistPageProps = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

const loadArtist = cache((name: string) => getArtistDetail(name));

export async function generateMetadata({ params }: Pick<ArtistPageProps, "params">): Promise<Metadata> {
  const name = decodeDetailParam((await params).name);
  const data = await loadArtist(name);
  return { title: data ? `${data.title} · Artist` : "Artist" };
}

export default async function ArtistPage({ params, searchParams }: ArtistPageProps) {
  const name = decodeDetailParam((await params).name);
  const period = parseDetailPeriod((await searchParams).period);
  const [data, features] = await Promise.all([
    loadArtist(name),
    getDetailPageFeatures("artist", name, false, period),
  ]);
  if (!data || !features) notFound();
  return <EntityDetail basePath={`/artist/${encodeURIComponent(name)}`} data={data} features={features} />;
}
