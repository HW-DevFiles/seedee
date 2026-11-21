import { db } from "@/lib/db";
import { WorkspaceEntry } from "@/features/integration/entry";
import { AppShell } from "@/components/ui/app-shell";
import { requireUser } from "@/lib/auth/session";

export const metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const agency = await db.agency.findUnique({
    where: { ownerId: user.id },
    select: { id: true },
  });
  return (
    <AppShell userName={user.name}>
      {agency && <WorkspaceEntry agencyId={agency.id} />}
      {children}
    </AppShell>
  );
}
