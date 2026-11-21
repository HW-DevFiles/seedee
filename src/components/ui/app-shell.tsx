import { Brand } from "@/components/ui/brand";
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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-8">
        <Brand />
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Demo preview</Badge>
          <form action={signOut}>
            <Button variant="quiet" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid max-w-screen-2xl lg:min-h-[calc(100vh-90px)] lg:grid-cols-[220px_1fr]">
        <aside className="border-b border-line p-5 lg:border-r lg:border-b-0 lg:p-6">
          <p className="mb-5 px-4 text-sm font-semibold break-words">
            {userName}&apos;s workspace
          </p>
          <Nav />
          <nav
            aria-label="Workspace utilities"
            className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4 lg:flex-col"
          >
            <Link
              href="/app/notifications"
              className="min-h-11 rounded-xl px-4 py-3 text-sm font-medium hover:bg-sage"
            >
              Notifications
            </Link>
            <Link
              href="/app/settings"
              className="min-h-11 rounded-xl px-4 py-3 text-sm font-medium hover:bg-sage"
            >
              Settings
            </Link>
            <Link
              href="/app?preview=sample"
              className="min-h-11 rounded-xl px-4 py-3 text-sm font-medium underline underline-offset-4 hover:bg-sage"
            >
              Explore sample workspace
            </Link>
          </nav>
          <p className="mt-8 hidden px-4 text-sm leading-relaxed lg:block">
            Your practice.
            <br />
            Your company.
            <br />
            At your pace.
          </p>
        </aside>
        <main id="main-content" className="min-w-0 px-5 py-8 sm:px-8 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
