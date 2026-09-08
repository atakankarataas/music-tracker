import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EntityDetail } from "@/components/entity-detail";
import { getAlbumDetail } from "@/lib/data";
import { decodeDetailParam, getDetailPageFeatures, parseDetailPeriod } from "@/lib/detail-features";

export const dynamic = "force-dynamic";

type AlbumByIdPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

const loadAlbum = cache((id: string) => getAlbumDetail(id, true));

export async function generateMetadata({ params }: Pick<AlbumByIdPageProps, "params">): Promise<Metadata> {
  const id = decodeDetailParam((await params).id);
  const data = await loadAlbum(id);
  return { title: data ? `${data.title} · Album` : "Album" };
}

export default async function AlbumByIdPage({ params, searchParams }: AlbumByIdPageProps) {
  const id = decodeDetailParam((await params).id);
  const period = parseDetailPeriod((await searchParams).period);
  const [data, features] = await Promise.all([
    loadAlbum(id),
    getDetailPageFeatures("album", id, true, period),
  ]);
  if (!data || !features) notFound();
  return <EntityDetail basePath={`/album/id/${encodeURIComponent(id)}`} data={data} features={features} />;
}
