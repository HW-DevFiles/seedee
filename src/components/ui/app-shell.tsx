import { Brand } from "@/components/ui/brand";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";
import { Badge } from "./badge";
import { Button } from "./button";
import { WorkspaceNavigation } from "./workspace-navigation";

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
          <span className="hidden sm:block">
            <Badge>Demo preview</Badge>
          </span>
          <form action={signOut}>
            <Button variant="quiet" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid max-w-screen-2xl lg:min-h-[calc(100vh-90px)] lg:grid-cols-[220px_1fr]">
        <aside className="border-b border-line p-5 lg:border-r lg:border-b-0 lg:p-6">
          <WorkspaceNavigation userName={userName} />
        </aside>
        <main id="main-content" className="min-w-0 px-5 py-8 sm:px-8 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
