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
  return <AppShell userName={user.name}>{children}</AppShell>;
}
