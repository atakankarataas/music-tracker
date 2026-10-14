import Link from "next/link";
import { SearchShortcut } from "@/components/search-shortcut";

import { BrandMark } from "@/components/brand-mark";
import { DataFreshness } from "@/components/data-freshness";
import { NavLinks } from "@/components/nav-links";
import { NowPlaying } from "@/components/now-playing";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <DataFreshness />
      <SearchShortcut />
      <header className="site-header">
        <div className="container header-inner">
          <Link className="brand" href="/" prefetch={false} aria-label="atakan.fm home">
            <span className="brand-mark">
              <BrandMark />
            </span>
            {/* The suffix is split out so it can sit a shade back from the name
                without the screen reader hearing two separate words. */}
            <span className="brand-word">atakan<i>.fm</i></span>
          </Link>
          <NavLinks />
        </div>
      </header>
      <main className="container page-content">{children}</main>
      <div className="container"><details className="feature-footnote"><summary>How plays are counted</summary><p>Every page uses the same rules. Known listens of 30 seconds or less and known private sessions are excluded. Artist plays give the first catalogue artist 1 and other credited artists 0.35, then round the displayed total. Sorting uses the unrounded total. This is an estimate: Spotify gives primary artists more credit but does not publish its coefficients or billing roles. API history has no listening duration; Taste Profile exclusions are unavailable. Exact Spotify totals cannot be reproduced from these exports and APIs. <a href="https://newsroom.spotify.com/2025-12-05/wrapped-methodology-explained/" target="_blank" rel="noreferrer">Spotify’s methodology ↗</a></p></details></div>
      <NowPlaying />
      <footer className="container site-footer">
        <span>Personal listening archive</span>
        <span>Europe/Istanbul · Press / to search</span>
        <Link href="/sync">Sync status</Link>
        <form action="/api/auth/logout" method="post"><button className="quiet-link" type="submit">Sign out</button></form>
      </footer>
    </div>
  );
}
