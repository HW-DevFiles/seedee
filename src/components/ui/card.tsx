import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-3xl border border-line bg-white/60 p-6",
        className,
      )}
      {...props}
    />
  );
}
