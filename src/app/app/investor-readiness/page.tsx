import { ProductPage } from "@/features/product-ui/page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <ProductPage path={["investor-readiness"]} searchParams={searchParams} />
  );
}
