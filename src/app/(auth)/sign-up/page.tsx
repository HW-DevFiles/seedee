import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create an account" };
export default function SignUpPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Make room for your idea.</h1>
      <p className="mt-3 leading-relaxed">
        Create your account to explore the Seedee foundation.
      </p>
      <AuthForm mode="sign-up" />
    </>
  );
}
