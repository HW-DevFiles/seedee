import Link from "next/link";
import { Badge, ButtonLink, Card } from "@/components/ui";

const steps = [
  {
    title: "Start with your craft",
    copy: "Bring the practice, perspective, and ambition that make your work yours.",
  },
  {
    title: "Give it a shape",
    copy: "The planned agency builder will help you review an offer, a crew, and a way of working.",
  },
  {
    title: "Grow with intention",
    copy: "Future planning tools will help you organize the work and evidence behind your company story.",
  },
];

export default function Home() {
  return (
    <>
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-7 sm:px-10">
        <Link
          href="/"
          aria-label="Seedee home"
          className="font-display text-4xl tracking-tight text-heading"
        >
          seedee.
        </Link>
        <nav aria-label="Main" className="flex items-center gap-3 sm:gap-6">
          <a
            className="hidden text-sm font-semibold sm:block"
            href="#how-it-works"
          >
            How it works
          </a>
          <ButtonLink variant="secondary" href="/sign-in">
            Sign in
          </ButtonLink>
        </nav>
      </header>
      <main id="main-content">
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pt-12 pb-20 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20 lg:py-24">
          <div>
            <Badge>A home for your creative ambition</Badge>
            <h1 className="mt-7 max-w-3xl font-display text-display tracking-tight">
              Your creative practice.
              <br />
              <span className="italic">A company taking shape.</span>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed">
              Seedee is building a space to create, nurture, and manage your own
              creative agency. Start with you. Make room for what comes next.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/sign-up">Explore the preview</ButtonLink>
              <ButtonLink variant="quiet" href="#how-it-works">
                Meet the idea
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm">
              Demo preview · Sample outputs · You stay in charge
            </p>
          </div>
          <div className="rounded-[2rem] bg-sage p-6 sm:p-10">
            <p className="mb-6 text-sm font-semibold uppercase tracking-[0.15em]">
              A little structure. More possibility.
            </p>
            <Card className="rotate-[-2deg] border-white bg-background p-7 shadow-sm">
              <Badge>Illustrative studio</Badge>
              <h2 className="mt-5 font-display text-4xl">
                Fieldwork
                <br />
                Studio
              </h2>
              <p className="mt-4 leading-relaxed">
                Brand ideas with a human point of view.
              </p>
              <div className="mt-8 border-t border-line pt-5">
                <p className="text-sm font-semibold">An idea to explore</p>
                <p className="mt-2">
                  A focused brand package for independent makers.
                </p>
              </div>
            </Card>
            <div className="relative mt-5 ml-6 rounded-2xl bg-heading p-6 text-background">
              <p className="font-display text-2xl">
                Built around your judgment.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                Drafts to consider. Plans to refine. A company that stays yours.
              </p>
            </div>
          </div>
        </section>
        <section id="how-it-works" className="border-y border-line bg-white/40">
          <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
            <p className="text-sm font-semibold uppercase tracking-[0.15em]">
              The idea behind Seedee
            </p>
            <h2 className="mt-4 max-w-xl font-display text-title">
              From creative instinct
              <br />
              to a considered plan.
            </h2>
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {steps.map((step) => (
                <article key={step.title} className="border-t border-line pt-6">
                  <h3 className="font-display text-2xl">{step.title}</h3>
                  <p className="mt-4 leading-relaxed">{step.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-6 py-16 sm:px-10 md:flex-row md:items-center">
          <div>
            <h2 className="font-display text-title">
              Begin with a little possibility.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed">
              Create an account and explore the workspace foundation. Agency
              tools are still taking shape. Investor preparation will not be a
              promise of funding.
            </p>
          </div>
          <ButtonLink href="/sign-up" className="shrink-0">
            Create your account
          </ButtonLink>
        </section>
      </main>
      <footer className="border-t border-line px-6 py-7 text-center text-sm">
        Seedee · A working foundation for creative ownership.
      </footer>
    </>
  );
}
