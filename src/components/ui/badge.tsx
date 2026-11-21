import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full bg-sage px-3 py-1 text-sm font-medium text-heading",
        className,
      )}
      {...props}
    />
  );
}
