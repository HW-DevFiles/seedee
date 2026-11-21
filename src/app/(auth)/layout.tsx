import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getCurrentUser()) redirect("/app");
  return (
    <div className="min-h-screen px-6 py-8">
      <Link
        href="/"
        aria-label="Seedee home"
        className="font-display text-4xl text-heading"
      >
        seedee.
      </Link>
      <main
        id="main-content"
        className="mx-auto mt-12 max-w-md rounded-3xl border border-line bg-white/60 p-7 sm:mt-20 sm:p-10"
      >
        {children}
      </main>
    </div>
  );
}
