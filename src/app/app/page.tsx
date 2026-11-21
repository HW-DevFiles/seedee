import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { workspaceSections } from "@/lib/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";

export default async function Dashboard() {
  const user = await requireUser();
  const agency = await db.agency.findUnique({
    where: { ownerId: user.id },
    select: { name: true, description: true },
  });
  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.15em]">
          Your workspace
        </p>
        <h1 className="mt-4 font-display text-title">Welcome, {user.name}.</h1>
        <p className="mt-4 max-w-2xl leading-relaxed">
          A place for your practice to become a company. This preview gives you
          the foundation; the tools below are still taking shape.
        </p>
      </div>
      {agency ? (
        <Card className="bg-sage">
          <Badge className="bg-background">Your agency</Badge>
          <h2 className="mt-5 font-display text-3xl">{agency.name}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed">{agency.description}</p>
        </Card>
      ) : (
        <EmptyState
          title="Your agency starts with you"
          description="Your account is ready. The upcoming agency builder will help you review and accept a studio draft before anything is saved."
        />
      )}
      <section aria-labelledby="workspace-heading">
        <h2 id="workspace-heading" className="font-display text-3xl">
          A space for every next step.
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workspaceSections.map((section) => (
            <Link
              key={section.slug}
              href={`/app/${section.slug}`}
              className="rounded-3xl"
            >
              <Card className="h-full transition-colors hover:bg-sage">
                <p className="text-sm">Coming next</p>
                <h3 className="mt-3 font-display text-2xl">{section.title}</h3>
                <p className="mt-3 leading-relaxed">{section.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
