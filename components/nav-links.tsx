"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, House, Library, Search, Sparkles, Disc3 } from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: House },
  { href: "/library", label: "Library", icon: Library },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/discover", label: "Discover", icon: Sparkles },
  { href: "/wrapped", label: "Wrapped", icon: Disc3 },
  { href: "/search", label: "Search", icon: Search },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="nav-links">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className="nav-link"
            data-active={active || undefined}
            href={href}
            key={href}
            prefetch={false}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={1.5} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
