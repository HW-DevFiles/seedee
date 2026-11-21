"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { workspaceSections } from "@/lib/navigation";

export function Nav() {
  const pathname = usePathname();
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
            href={href}
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
