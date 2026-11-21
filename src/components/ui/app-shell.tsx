import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";
import { Badge } from "./badge";
import { Button } from "./button";
import { Nav } from "./nav";

export function AppShell({
  children,
  userName,
}: {
  children: ReactNode;
  userName: string;
}) {
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 lg:px-10">
        <Link
          href="/"
          aria-label="Seedee home"
          className="font-display text-4xl tracking-tight text-heading"
        >
          seedee<span className="text-primary">.</span>
        </Link>
        <div className="flex items-center gap-3">
          <Badge>Demo preview</Badge>
          <form action={signOut}>
            <Button variant="quiet" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid max-w-screen-2xl lg:min-h-[calc(100vh-90px)] lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-line p-5 lg:border-r lg:border-b-0 lg:p-6">
          <p className="mb-5 px-4 text-sm font-semibold break-words">
            {userName}&apos;s workspace
          </p>
          <Nav />
          <p className="mt-8 hidden px-4 text-sm leading-relaxed lg:block">
            Your practice.
            <br />
            Your company.
            <br />
            At your pace.
          </p>
        </aside>
        <main id="main-content" className="min-w-0 px-6 py-10 sm:px-10 lg:p-12">
          {children}
        </main>
      </div>
    </div>
  );
}
