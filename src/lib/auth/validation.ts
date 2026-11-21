import { z } from "zod";

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "Use a password of 72 bytes or fewer.",
    ),
});

export const signUpSchema = credentialsSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Use 80 characters or fewer."),
});

export type AuthState = { error?: string };
