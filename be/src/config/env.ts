import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value) => value === "true");

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(16, "must be at least 16 characters"),
    JWT_EXPIRES_IN: z.string().default("30d"),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
    LOG_PRETTY: booleanFromString(false),
    LOG_TO_FILE: booleanFromString(true),
    LOG_DIR: z.string().default("logs"),

    EMAIL_PROVIDER: z.enum(["resend", "console"]).default("console"),
    RESEND_API_KEY: emptyToUndefined,
    EMAIL_FROM: z.string().email().default("no-reply@gatepass.app"),
    EMAIL_FROM_NAME: z.string().default("GatePass"),

    INTEGRATION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    INTEGRATION_MAX_RETRIES: z.coerce.number().int().min(0).default(2),

    SHOW_OTP_IN_RESPONSE: booleanFromString(false),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "required when EMAIL_PROVIDER=resend",
      });
    }
  })
  .transform((value) => ({
    ...value,
    LOG_LEVEL:
      value.LOG_LEVEL ?? (value.NODE_ENV === "production" ? "info" : "debug"),
  }));

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
