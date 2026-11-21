"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { Field, FormAction, FormSpec } from "./contracts";

const control =
  "min-h-12 w-full rounded-xl border border-control bg-white px-4 py-3 text-base text-heading disabled:bg-sage/40";

function FormField({
  field,
  prefix,
  error,
}: {
  field: Field;
  prefix: string;
  error?: string;
}) {
  const id = `${prefix}-${field.name}`;
  const describedBy =
    [field.hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined;
  const props = {
    id,
    name: field.name,
    required: field.required,
    "aria-describedby": describedBy,
    "aria-invalid": Boolean(error),
    className: control,
  };
  const label = (
    <label htmlFor={id} className="block text-sm font-semibold text-heading">
      {field.label}
      {field.required && <span aria-hidden="true"> *</span>}
    </label>
  );
  return (
    <div className="min-w-0 space-y-2">
      {field.type !== "checkbox" && field.type !== "multiselect" && label}
      {field.type === "textarea" ? (
        <textarea
          {...props}
          rows={4}
          maxLength={field.maxLength ?? 4000}
          defaultValue={String(field.value ?? "")}
        />
      ) : field.type === "select" ? (
        <select {...props} defaultValue={String(field.value ?? "")}>
          <option value="">Choose an option</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "multiselect" ? (
        <fieldset aria-describedby={describedBy} aria-invalid={Boolean(error)}>
          <legend className="mb-3 text-sm font-semibold text-heading">
            {field.label}
            {field.required ? " (choose at least one)" : ""}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options?.map((option) => (
              <label
                key={option.value}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-control bg-white px-4 py-3"
              >
                <input
                  type="checkbox"
                  name={field.name}
                  value={option.value}
                  defaultChecked={
                    Array.isArray(field.value) &&
                    field.value.includes(option.value)
                  }
                  className="size-5 accent-primary"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : field.type === "checkbox" ? (
        <label className="flex min-h-12 items-center gap-3" htmlFor={id}>
          <input
            {...props}
            type="checkbox"
            defaultChecked={field.value === true}
            className="size-5 shrink-0 accent-primary"
          />
          {field.label}
        </label>
      ) : (
        <input
          {...props}
          type={field.type === "money" ? "text" : (field.type ?? "text")}
          inputMode={field.type === "money" ? "decimal" : undefined}
          pattern={
            field.type === "money"
              ? `${field.signed ? "-?" : ""}[0-9]+(\\.[0-9]{1,2})?`
              : undefined
          }
          min={field.min}
          max={field.max}
          step={field.step}
          maxLength={
            field.maxLength ?? (field.type === "number" ? undefined : 240)
          }
          defaultValue={
            typeof field.value === "boolean" || Array.isArray(field.value)
              ? ""
              : field.value
          }
        />
      )}
      {field.hint && (
        <p id={`${id}-hint`} className="text-sm leading-relaxed">
          {field.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function ActionForm({
  spec,
  action,
  preview = false,
}: {
  spec: FormSpec;
  action: FormAction;
  preview?: boolean;
}) {
  const requestKey = useRef<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: import("./contracts").ActionState, data: FormData) => {
      requestKey.current ??= crypto.randomUUID();
      data.set("idempotencyKey", requestKey.current);
      const result = await action(previous, data);
      if (result.status === "success") requestKey.current = null;
      return result;
    },
    {},
  );
  const prefix = useId();
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error" || state.status === "conflict")
      summary.current?.focus();
  }, [state]);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      action={formAction}
      aria-labelledby={`${prefix}-form-title`}
      aria-busy={pending}
      className="space-y-5"
    >
      <div>
        <h2 id={`${prefix}-form-title`} className="font-display text-2xl">
          {spec.title}
        </h2>
        {spec.description && (
          <p className="mt-2 text-sm leading-relaxed">{spec.description}</p>
        )}
        <p className="mt-2 text-sm">Fields marked * are required.</p>
      </div>
      <input type="hidden" name="command" value={spec.id} />
      <input type="hidden" name="screenKey" value={spec.screenKey ?? ""} />
      <input type="hidden" name="projectId" value={spec.projectId ?? ""} />
      <input type="hidden" name="idempotencyKey" value="" />
      {spec.recordId && (
        <input type="hidden" name="recordId" value={spec.recordId} />
      )}
      {spec.version !== undefined && (
        <input type="hidden" name="expectedVersion" value={spec.version} />
      )}
      {spec.recordVersions && (
        <input
          type="hidden"
          name="recordVersions"
          value={JSON.stringify(spec.recordVersions)}
        />
      )}
      {preview && <input type="hidden" name="preview" value="sample" />}
      <fieldset
        disabled={pending || Boolean(spec.unavailableReason)}
        className="min-w-0 space-y-5"
      >
        {spec.fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            prefix={prefix}
            error={state.fieldErrors?.[field.name]}
          />
        ))}
      </fieldset>
      {spec.confirmation && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            id={`${prefix}-confirmed`}
            name="confirmed"
            aria-invalid={Boolean(state.fieldErrors?.confirmed)}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-5 shrink-0 accent-primary"
            required
            disabled={pending || Boolean(spec.unavailableReason)}
          />
          {spec.confirmation}
        </label>
      )}
      {(state.message || state.fieldErrors) && (
        <div
          ref={summary}
          tabIndex={-1}
          role={state.status === "success" ? "status" : "alert"}
          className={`rounded-xl border p-4 text-sm leading-relaxed ${state.status === "success" ? "border-primary bg-sage/40" : "border-danger text-danger"}`}
        >
          <p>{state.message ?? "Check the highlighted fields."}</p>
          {state.fieldErrors && (
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {Object.entries(state.fieldErrors).map(([name, message]) => (
                <li key={name}>
                  <a
                    href={`#${prefix}-${name}`}
                    className="font-semibold underline underline-offset-4"
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {state.status === "conflict" && (
            <p className="mt-2">
              Reload this page to review the current record before submitting
              again. Your changes have not overwritten it.
            </p>
          )}
        </div>
      )}
      {spec.unavailableReason && (
        <p
          id={`${prefix}-unavailable`}
          className="rounded-xl bg-sage/40 p-4 text-sm leading-relaxed"
        >
          {spec.unavailableReason}
        </p>
      )}
      <Button
        type="submit"
        disabled={
          pending ||
          Boolean(spec.unavailableReason) ||
          Boolean(spec.confirmation && !confirmed)
        }
        aria-describedby={
          spec.unavailableReason ? `${prefix}-unavailable` : undefined
        }
      >
        {pending ? "Working…" : spec.submit}
      </Button>
      {preview && (
        <p className="text-sm">
          Sample preview. This form cannot change your workspace.
        </p>
      )}
    </form>
  );
}
