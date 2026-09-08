import Image from "next/image";
import Link from "next/link";
import { Disc3, Music2, User } from "lucide-react";

import { entityHref, formatNumber, formatRelativeDate } from "@/lib/format";
import type { EntityItem, RecentPlay } from "@/lib/data";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  detail,
  href,
}: {
  title: string;
  detail?: string;
  href?: string;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {href ? <Link href={href}>View all</Link> : null}
    </div>
  );
}

export function Surface({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`surface ${className}`.trim()}>{children}</section>;
}

export function StatTile({
  label,
  value,
  detail,
  // Track and artist names need a smaller size than a play count does. At the
  // shared numeric size they clamp to two cramped lines and leave the row of
  // tiles visibly ragged next to the figures they sit beside.
  tone = "numeric",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "numeric" | "text";
}) {
  return (
    <div className="stat-tile" data-tone={tone}>
      <span>{label}</span>
      {/* The value is clamped, so keep the full text reachable. */}
      <strong title={value}>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function Artwork({
  src,
  kind = "track",
  size = 48,
  loading,
  priority = false,
}: {
  src?: string | null;
  kind?: "artist" | "album" | "track";
  size?: number;
  loading?: "eager" | "lazy";
  priority?: boolean;
}) {
  if (src) {
    return (
      <Image
        alt=""
        className={kind === "artist" ? "artwork round" : "artwork"}
        height={size}
        // `priority` already implies eager loading, and passing both makes
        // next/image warn.
        loading={priority ? undefined : loading}
        priority={priority}
        sizes={`${size}px`}
        src={src}
        width={size}
      />
    );
  }

  const Icon = kind === "artist" ? User : kind === "album" ? Disc3 : Music2;
  return (
    <span
      className={kind === "artist" ? "artwork artwork-placeholder round" : "artwork artwork-placeholder"}
      style={{ height: size, width: size }}
    >
      <Icon aria-hidden="true" size={Math.max(16, size * 0.38)} strokeWidth={1.5} />
    </span>
  );
}

export function EntityList({
  items,
  kind,
}: {
  items: EntityItem[];
  kind: "artist" | "album" | "track";
}) {
  return (
    <div className="entity-list">
      {items.map((item, index) => (
        <Link
          className="entity-row"
          href={entityHref(kind, item.name, item.id)}
          key={`${item.id ?? item.name}-${item.secondary ?? ""}`}
        >
          <span className="rank">{String(index + 1).padStart(2, "0")}</span>
          <Artwork kind={kind} src={item.imageUrl} />
          <span className="entity-copy">
            <strong>{item.name}</strong>
            {item.secondary ? <small>{item.secondary}</small> : null}
          </span>
          <span className="play-count">{formatNumber(item.plays)} plays</span>
        </Link>
      ))}
    </div>
  );
}

export function RecentList({ items }: { items: RecentPlay[] }) {
  return (
    <div className="entity-list">
      {items.map((item, index) => (
        <Link
          className="entity-row"
          href={entityHref("track", item.trackName, item.spotifyId)}
          key={`${item.playedAt}-${index}`}
        >
          <Artwork src={item.imageUrl} />
          <span className="entity-copy">
            <strong>{item.trackName}</strong>
            <small>{item.artistName}</small>
          </span>
          <span className="play-count">{formatRelativeDate(item.playedAt)}</span>
        </Link>
      ))}
    </div>
  );
}

export function SegmentedControl({
  items,
  active,
}: {
  items: Array<{ label: string; href: string; value: string }>;
  active: string;
}) {
  return (
    <nav className="segmented" aria-label="View options">
      {items.map((item) => (
        <Link
          aria-current={active === item.value ? "page" : undefined}
          data-active={active === item.value || undefined}
          href={item.href}
          key={item.value}
          prefetch={false}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <Music2 aria-hidden="true" size={22} strokeWidth={1.5} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
