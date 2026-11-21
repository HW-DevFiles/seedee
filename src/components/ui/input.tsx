import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

export function Input({
  label,
  hint,
  id,
  name,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  id: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-heading">
        {label}
      </label>
      <input
        id={id}
        name={name ?? id}
        aria-describedby={hintId}
        className={clsx(
          "min-h-12 w-full rounded-xl border border-control bg-white px-4 py-3 text-base text-heading",
          className,
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}
