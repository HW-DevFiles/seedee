import { ProductPage } from "@/features/product-ui/page";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  return <ProductPage path={path} searchParams={searchParams} />;
}
