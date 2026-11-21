import type { ReactNode } from "react";
import { Card } from "./card";

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Card className="flex min-h-64 flex-col items-start justify-center border-dashed p-8 sm:p-12">
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="mt-3 max-w-xl leading-relaxed">{description}</p>
      {children && <div className="mt-6">{children}</div>}
    </Card>
  );
}
