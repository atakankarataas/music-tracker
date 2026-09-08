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
