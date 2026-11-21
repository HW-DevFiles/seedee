"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { workspaceSections } from "@/lib/navigation";

export function Nav() {
  const pathname = usePathname();
  const preview = useSearchParams().get("preview") === "sample";
  const links = [
    { href: "/app", title: "Overview" },
    ...workspaceSections.map((section) => ({
      href: `/app/${section.slug}`,
      title: section.title,
    })),
  ];
  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-2 lg:flex-col">
      {links.map(({ href, title }) => {
        const active =
          href === "/app"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={preview ? `${href}?preview=sample` : href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "rounded-xl px-4 py-3 text-sm font-medium",
              active ? "bg-primary text-background" : "hover:bg-sage",
            )}
          >
            {title}
          </Link>
        );
      })}
    </nav>
  );
}

export function UtilityNav() {
  const preview = useSearchParams().get("preview") === "sample";
  return (
    <nav
      aria-label="Workspace utilities"
      className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4 lg:flex-col"
    >
      {[
        { href: "/app/notifications", title: "Notifications" },
        { href: "/app/settings", title: "Settings" },
      ].map((link) => (
        <Link
          key={link.href}
          href={preview ? `${link.href}?preview=sample` : link.href}
          className="min-h-11 rounded-xl px-4 py-3 text-sm font-medium hover:bg-sage"
        >
          {link.title}
        </Link>
      ))}
      <Link
        href={preview ? "/app" : "/app?preview=sample"}
        className="min-h-11 rounded-xl px-4 py-3 text-sm font-medium underline underline-offset-4 hover:bg-sage"
      >
        {preview ? "Return to my workspace" : "Explore sample workspace"}
      </Link>
    </nav>
  );
}
