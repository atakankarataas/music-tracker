import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EntityDetail } from "@/components/entity-detail";
import { getTrackDetail } from "@/lib/data";
import { decodeDetailParam, getDetailPageFeatures, parseDetailPeriod } from "@/lib/detail-features";

export const dynamic = "force-dynamic";

type TrackByIdPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

const loadTrack = cache((id: string) => getTrackDetail(id, true));

export async function generateMetadata({ params }: Pick<TrackByIdPageProps, "params">): Promise<Metadata> {
  const id = decodeDetailParam((await params).id);
  const data = await loadTrack(id);
  return { title: data ? `${data.title} · Track` : "Track" };
}

export default async function TrackByIdPage({ params, searchParams }: TrackByIdPageProps) {
  const id = decodeDetailParam((await params).id);
  const period = parseDetailPeriod((await searchParams).period);
  const [data, features] = await Promise.all([
    loadTrack(id),
    getDetailPageFeatures("track", id, true, period),
  ]);
  if (!data || !features) notFound();
  return <EntityDetail basePath={`/track/id/${encodeURIComponent(id)}`} data={data} features={features} />;
}
