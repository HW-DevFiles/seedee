import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { workspaceSections, type WorkspaceSection } from "@/lib/navigation";
import { Badge, ButtonLink, EmptyState } from "@/components/ui";

export async function WorkspacePlaceholder({
  slug,
}: {
  slug: WorkspaceSection;
}) {
  await requireUser();
  const section = workspaceSections.find((item) => item.slug === slug);
  if (!section) notFound();
  return (
    <div className="space-y-8">
      <div>
        <Badge>Coming in a later release</Badge>
        <h1 className="mt-5 font-display text-title">{section.title}</h1>
        <p className="mt-4 max-w-2xl leading-relaxed">{section.description}</p>
      </div>
      <EmptyState
        title={section.emptyTitle}
        description={section.emptyDescription}
      >
        <ButtonLink href="/app" variant="secondary">
          Back to overview
        </ButtonLink>
      </EmptyState>
    </div>
  );
}
