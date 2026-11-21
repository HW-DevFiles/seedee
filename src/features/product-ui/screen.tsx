import Link from "next/link";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { RecordTable } from "./record-table";
import { ActionForm } from "./action-form";
import {
  EDUCATIONAL_BOUNDARY,
  type FormAction,
  type WorkspaceUI,
} from "./contracts";

export function Screen({
  view,
  action,
}: {
  view: WorkspaceUI;
  action: FormAction;
}) {
  const { screen, mode, source } = view;
  const preview = mode === "sample_preview";
  const href = (value: string) =>
    preview && value.startsWith("/app")
      ? `${value}${value.includes("?") ? "&" : "?"}preview=sample`
      : value;
  return (
    <div className="space-y-8">
      {(preview || source?.origin === "sample") && (
        <aside
          aria-label={
            preview
              ? "Sample preview disclosure"
              : "Sample workspace disclosure"
          }
          className="rounded-2xl border border-primary bg-sage/50 p-5"
        >
          <p className="font-semibold text-heading">
            Demo preview · Sample data · Not actual business performance
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            {preview
              ? "You are exploring fictional records. Preview forms cannot save or export these as your evidence."
              : "This is a synthetic workspace. Saved changes and exports retain sample labels and never become actual business traction."}
          </p>
          <Link
            href="/app"
            className="mt-2 inline-block min-h-11 py-3 text-sm font-semibold underline underline-offset-4"
          >
            Return to my workspace
          </Link>
        </aside>
      )}
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <p className="eyebrow">{screen.eyebrow}</p>
          <h1 className="mt-3 font-display text-title tracking-tight">
            {screen.title}
          </h1>
          <p className="mt-4 leading-relaxed">{screen.description}</p>
        </div>
        {screen.links && (
          <nav aria-label="Page actions" className="flex flex-wrap gap-2">
            {screen.links.map((link, index) => (
              <ButtonLink
                key={link.href}
                variant={index === 0 ? "primary" : "secondary"}
                href={href(link.href)}
              >
                {link.label}
              </ButtonLink>
            ))}
          </nav>
        )}
      </header>
      {source && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge>{source.origin.replaceAll("_", " ")}</Badge>
          <span>
            As of {source.asOf} · {source.review} · {source.version}
          </span>
        </p>
      )}
      {screen.finance && (
        <aside
          aria-label="Educational planning boundary"
          className="rounded-xl border border-line bg-white/50 p-4 text-sm leading-relaxed"
        >
          {EDUCATIONAL_BOUNDARY}
        </aside>
      )}
      {screen.notices?.map((notice) => (
        <aside
          key={notice.title}
          className={`rounded-2xl border p-5 ${notice.kind === "warning" ? "border-danger bg-white/60" : "border-line bg-sage/35"}`}
        >
          <h2 className="font-semibold">{notice.title}</h2>
          <p className="mt-2 text-sm leading-relaxed">{notice.body}</p>
        </aside>
      ))}
      {screen.steps && (
        <section aria-label="Workflow progress">
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {screen.steps.map((step, index) => (
              <li
                key={step.title}
                aria-current={step.state === "current" ? "step" : undefined}
                className={`rounded-2xl border p-4 ${step.state === "current" ? "border-primary bg-sage/50" : "border-line"}`}
              >
                <p className="text-sm">
                  {String(index + 1).padStart(2, "0")} ·{" "}
                  {step.state === "done"
                    ? "Complete"
                    : step.state === "current"
                      ? "Current step"
                      : "Next"}
                </p>
                <h2 className="mt-2 font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {screen.metrics && (
        <section
          aria-label="Workspace metrics"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {screen.metrics.map((metric) => {
            const content = (
              <Card className="h-full">
                <h2 className="text-sm font-semibold">{metric.label}</h2>
                <p className="mt-4 font-display text-4xl text-heading tabular-nums">
                  {metric.value ?? "Unknown"}
                </p>
                <p className="mt-3 text-sm leading-relaxed">{metric.detail}</p>
                {metric.origin && (
                  <p className="mt-2 text-xs uppercase tracking-wider">
                    {metric.origin.replaceAll("_", " ")}
                  </p>
                )}
              </Card>
            );
            return metric.href ? (
              <Link
                className="rounded-3xl"
                key={metric.label}
                href={href(metric.href)}
                aria-label={`${metric.label}: ${metric.value ?? "Unknown"}. View records`}
              >
                {content}
              </Link>
            ) : (
              <div key={metric.label}>{content}</div>
            );
          })}
        </section>
      )}
      {screen.cards && screen.cards.length > 0 && (
        <section
          aria-label="Workspace records"
          className="grid gap-4 md:grid-cols-2"
        >
          {screen.cards.map((card) => (
            <Card key={card.id} className="flex flex-col items-start">
              <div className="flex w-full flex-wrap items-start justify-between gap-3">
                <h2 className="font-display text-2xl">{card.title}</h2>
                {card.status && <Badge>{card.status}</Badge>}
              </div>
              <p className="mt-4 leading-relaxed">{card.body}</p>
              {card.details && (
                <dl className="mt-5 w-full space-y-3 border-t border-line pt-5">
                  {card.details.map((detail) => (
                    <div
                      key={detail.label}
                      className="flex flex-wrap justify-between gap-2 text-sm"
                    >
                      <dt className="font-semibold">{detail.label}</dt>
                      <dd className="max-w-full break-words">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {card.link && (
                <Link
                  href={href(card.link.href)}
                  className="mt-auto min-h-11 pt-6 font-semibold underline underline-offset-4"
                >
                  {card.link.label} <span aria-hidden="true">↗</span>
                </Link>
              )}
            </Card>
          ))}
        </section>
      )}
      {screen.tables?.map((table) => (
        <RecordTable key={table.title} table={table} preview={preview} />
      ))}
      {screen.forms?.map((form) => (
        <Card key={form.id} className="max-w-3xl p-6 sm:p-8">
          <ActionForm spec={form} action={action} preview={preview} />
        </Card>
      ))}
      {mode === "empty" && (
        <p className="text-sm leading-relaxed">
          Your account contains no sample traction. Unknown means there is no
          saved evidence yet.
        </p>
      )}
    </div>
  );
}
