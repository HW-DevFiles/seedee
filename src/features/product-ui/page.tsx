import { notFound } from "next/navigation";
import { readProductScreen } from "./adapter";
import { productAction } from "./actions";
import { resolveScreen } from "./catalog";
import { Screen } from "./screen";

export async function ProductPage({
  path,
  searchParams,
}: {
  path: string[];
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const route = resolveScreen(path);
  if (!route) notFound();
  const query = await searchParams;
  const view = await readProductScreen(
    route.key,
    query?.preview === "sample",
    route.recordId,
  );
  if (!view) notFound();
  return <Screen view={view} action={productAction} />;
}
