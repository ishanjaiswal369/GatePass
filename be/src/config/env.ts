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

/**
 * Values shipped in .env.example or obvious stand-ins. Rejected outright: a
 * placeholder JWT secret is not a weak secret, it is a published one.
 */
const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-string",
  "your-secret-key-change-this",
  "supersecretsupersecret",
  "changeme-changeme-changeme",
]);

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z
      .string()
      .min(16, "must be at least 16 characters")
      .refine((value) => !PLACEHOLDER_SECRETS.has(value.toLowerCase()), {
        // The length check alone passes the template value, which then signs
        // every session token and every gate pass with a secret that is in the
        // repository. Anyone could mint a valid token for any user.
        message:
          "is still the example value -- generate one with: openssl rand -base64 48",
      }),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'must look like "30d", "12h", "15m" or "60s"')
      .default("30d"),

    EMAIL_PROVIDER: z.enum(["resend", "console"]).default("console"),
    RESEND_API_KEY: emptyToUndefined,
    EMAIL_FROM: z.string().email().default("no-reply@gatepass.app"),
    EMAIL_FROM_NAME: z.string().default("GatePass"),

    // Every OAuth client that may mint tokens for us (web, iOS, Android),
    // comma-separated. These are the only accepted `aud` values -- without the
    // check, a Google token minted for any other app would be accepted here.
    // Empty is allowed so the server still boots before Google is set up;
    // /auth/google then refuses with a clear message.
    GOOGLE_CLIENT_IDS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
          : []
      ),

    // Place search for the "enter an area manually" field. Proxied through
    // the API rather than called from the app: an EXPO_PUBLIC_ key ships
    // inside the bundle, where anyone can pull it out and spend the quota.
    GEOCODE_PROVIDER: z.enum(["ola", "google", "none"]).default("none"),
    OLA_MAPS_API_KEY: emptyToUndefined,
    GOOGLE_MAPS_API_KEY: emptyToUndefined,

    // Where spot photos and ownership documents live. "local" hands out fake
    // presigned URLs so the upload flow is drivable before a bucket exists;
    // it stores nothing. See integrations/storage.
    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_PUBLIC_BASE_URL: z
      .string()
      .url()
      .default("http://localhost:3000/uploads"),
    // Refused above this at presign time, so a 40MB photo is rejected before
    // the client wastes a minute uploading it.
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 1024 * 1024),

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

    if (value.GEOCODE_PROVIDER === "ola" && !value.OLA_MAPS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OLA_MAPS_API_KEY"],
        message: "required when GEOCODE_PROVIDER=ola",
      });
    }

    if (value.STORAGE_PROVIDER === "s3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_PROVIDER"],
        // Better to refuse at boot than to hand out local URLs while the
        // operator believes photos are going to a bucket.
        message:
          "s3 is not implemented yet -- use local, or add the provider in " +
          "src/integrations/storage",
      });
    }

    if (value.GEOCODE_PROVIDER === "google" && !value.GOOGLE_MAPS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_MAPS_API_KEY"],
        message: "required when GEOCODE_PROVIDER=google",
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
