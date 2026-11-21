"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Nav, UtilityNav } from "./nav";

export function WorkspaceNavigation({ userName }: { userName: string }) {
  const path = usePathname();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const expanded = expandedPath === path;
  return (
    <>
      <p className="mb-3 px-4 text-sm font-semibold break-words lg:mb-5">
        {userName}&apos;s workspace
      </p>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="workspace-navigation"
        onClick={() => setExpandedPath(expanded ? null : path)}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-control px-4 py-3 text-sm font-semibold lg:hidden"
      >
        Workspace menu <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div
        id="workspace-navigation"
        className={expanded ? "mt-4 lg:mt-0" : "mt-4 hidden lg:mt-0 lg:block"}
      >
        <Nav />
        <UtilityNav />
        <p className="mt-8 hidden px-4 text-sm leading-relaxed lg:block">
          Your practice.
          <br />
          Your company.
          <br />
          At your pace.
        </p>
      </div>
    </>
  );
}
