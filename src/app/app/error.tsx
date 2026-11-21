"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl space-y-5">
      <p className="eyebrow">Workspace unavailable</p>
      <h1 className="font-display text-title">Let’s try that again.</h1>
      <p>
        We could not load this view. No successful save is being reported. Try
        again, or return to your workspace.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center px-4 font-semibold underline underline-offset-4"
        >
          Return to workspace
        </Link>
      </div>
    </div>
  );
}
