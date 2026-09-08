import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EntityDetail } from "@/components/entity-detail";
import { getAlbumDetail } from "@/lib/data";
import { decodeDetailParam, getDetailPageFeatures, parseDetailPeriod } from "@/lib/detail-features";

export const dynamic = "force-dynamic";

type AlbumPageProps = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

const loadAlbum = cache((name: string) => getAlbumDetail(name));

export async function generateMetadata({ params }: Pick<AlbumPageProps, "params">): Promise<Metadata> {
  const name = decodeDetailParam((await params).name);
  const data = await loadAlbum(name);
  return { title: data ? `${data.title} · Album` : "Album" };
}

export default async function AlbumPage({ params, searchParams }: AlbumPageProps) {
  const name = decodeDetailParam((await params).name);
  const period = parseDetailPeriod((await searchParams).period);
  const [data, features] = await Promise.all([
    loadAlbum(name),
    getDetailPageFeatures("album", name, false, period),
  ]);
  if (!data || !features) notFound();
  return <EntityDetail basePath={`/album/${encodeURIComponent(name)}`} data={data} features={features} />;
}
