"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp } from "@/lib/auth/actions";
import { Button, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  const [state, action, pending] = useActionState(
    isSignUp ? signUp : signIn,
    {},
  );
  return (
    <form action={action} className="mt-8 space-y-5">
      {isSignUp && (
        <Input
          label="Your name"
          id="name"
          autoComplete="name"
          maxLength={80}
          required
        />
      )}
      <Input
        label="Email address"
        id="email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
      />
      <Input
        label="Password"
        id="password"
        type="password"
        autoComplete={isSignUp ? "new-password" : "current-password"}
        minLength={12}
        required
        hint={
          isSignUp
            ? "At least 12 characters; up to 72 bytes. Spaces are welcome."
            : undefined
        }
      />
      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-danger p-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        {isSignUp ? "Already have an account? " : "New to Seedee? "}
        <Link
          className="font-semibold underline underline-offset-4"
          href={isSignUp ? "/sign-in" : "/sign-up"}
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
