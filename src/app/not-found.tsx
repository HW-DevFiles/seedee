import { ButtonLink } from "@/components/ui";
export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="font-display text-title">
        That page hasn&apos;t taken shape.
      </h1>
      <p className="my-6">Return to Seedee to find your next step.</p>
      <ButtonLink href="/">Back to home</ButtonLink>
    </main>
  );
}
