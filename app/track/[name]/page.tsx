import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EntityDetail } from "@/components/entity-detail";
import { getTrackDetail } from "@/lib/data";
import { decodeDetailParam, getDetailPageFeatures, parseDetailPeriod } from "@/lib/detail-features";

export const dynamic = "force-dynamic";

type TrackPageProps = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

const loadTrack = cache((name: string) => getTrackDetail(name));

export async function generateMetadata({ params }: Pick<TrackPageProps, "params">): Promise<Metadata> {
  const name = decodeDetailParam((await params).name);
  const data = await loadTrack(name);
  return { title: data ? `${data.title} · Track` : "Track" };
}

export default async function TrackPage({ params, searchParams }: TrackPageProps) {
  const name = decodeDetailParam((await params).name);
  const period = parseDetailPeriod((await searchParams).period);
  const [data, features] = await Promise.all([
    loadTrack(name),
    getDetailPageFeatures("track", name, false, period),
  ]);
  if (!data || !features) notFound();
  return <EntityDetail basePath={`/track/${encodeURIComponent(name)}`} data={data} features={features} />;
}
