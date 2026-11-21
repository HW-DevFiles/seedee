"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { EmptyState } from "@/components/ui";
import type { ViewTable } from "./contracts";

export function RecordTable({
  table,
  preview,
}: {
  table: ViewTable;
  preview: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const rows = table.rows.filter((row) =>
    row.cells.some((cell) =>
      cell.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const href = (value: string) =>
    preview
      ? `${value}${value.includes("?") ? "&" : "?"}preview=sample`
      : value;
  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="font-display text-2xl">
        {table.title}
      </h2>
      {table.description && (
        <p className="mt-2 text-sm leading-relaxed">{table.description}</p>
      )}
      {table.rows.length > 0 ? (
        <>
          <label
            htmlFor={`${id}-search`}
            className="mt-4 block text-sm font-semibold"
          >
            Search {table.title.toLowerCase()}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-2 min-h-12 w-full max-w-md rounded-xl border border-control bg-white px-4 py-3 text-base"
          />
          <p role="status" className="mt-2 text-sm">
            {rows.length} of {table.rows.length} records shown
          </p>
          <p id={`${id}-scroll`} className="mt-3 text-sm">
            Scroll horizontally to view all columns on smaller screens.
          </p>
          <div
            role="region"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-scroll`}
            tabIndex={0}
            className="relative mt-3 overflow-x-auto rounded-2xl border border-line"
          >
            <table className="w-full min-w-[600px] border-collapse text-left text-sm">
              <caption className="sr-only">{table.title}</caption>
              <thead className="bg-sage/50">
                <tr>
                  {table.columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="px-5 py-4 font-semibold text-heading"
                    >
                      {column}
                    </th>
                  ))}
                  <th scope="col" className="px-5 py-4">
                    <span className="sr-only">Open record</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white/50">
                {rows.map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell, index) =>
                      index === 0 ? (
                        <th
                          key={index}
                          scope="row"
                          className="px-5 py-4 font-medium"
                        >
                          {cell}
                        </th>
                      ) : (
                        <td key={index} className="px-5 py-4 tabular-nums">
                          {cell}
                        </td>
                      ),
                    )}
                    <td className="px-5 py-4">
                      {row.href && (
                        <Link
                          href={href(row.href)}
                          className="inline-block min-h-11 py-3 font-semibold underline underline-offset-4"
                        >
                          {row.linkLabel ?? "Open"}
                          <span className="sr-only"> {row.cells[0]}</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="mt-4 rounded-xl bg-sage/40 p-4">
              No records match this search. Clear the search to see every
              record.
            </p>
          )}
        </>
      ) : (
        <div className="mt-4">
          <EmptyState title="Nothing here yet" description={table.empty} />
        </div>
      )}
    </section>
  );
}
