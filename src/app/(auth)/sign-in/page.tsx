import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Sign in" };
export default function SignInPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Welcome back.</h1>
      <p className="mt-3 leading-relaxed">
        Your creative workspace is right here.
      </p>
      <AuthForm mode="sign-in" />
    </>
  );
}
