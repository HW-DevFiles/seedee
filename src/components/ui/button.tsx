import Link from "next/link";
import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

type Variant = "primary" | "secondary" | "quiet";
export function buttonStyles(variant: Variant = "primary", className?: string) {
  return clsx(
    "inline-flex min-h-11 items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    {
      "bg-primary text-background hover:bg-heading": variant === "primary",
      "border border-primary text-primary hover:bg-sage":
        variant === "secondary",
      "text-primary hover:bg-sage": variant === "quiet",
    },
    className,
  );
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={buttonStyles(variant, className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonStyles(variant, className)} {...props} />;
}
