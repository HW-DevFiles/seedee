import { z } from "zod";

// Shared by CLI, Next config and runtime. Never print environment values.
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .regex(/^file:(?!:memory:$)[^\s?#\0]+$/)
    .default("file:./prisma/dev.db"),
  AI_PROVIDER: z.literal("demo").default("demo"),
  DEMO_ACCOUNT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TRUST_PROXY_HOPS: z
    .string()
    .regex(/^(0|[1-9]\d?)$/)
    .default("0")
    .transform(Number)
    .pipe(z.number().max(32)),
});

export function readEnvironment(
  source: Record<string, string | undefined> = process.env,
) {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(
      `Invalid configuration: ${fields.join(", ")}. See .env.example.`,
    );
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.DEMO_ACCOUNT_ENABLED
  ) {
    throw new Error("Public demo credentials must be disabled in production.");
  }
  return parsed.data;
}

export type Environment = ReturnType<typeof readEnvironment>;
