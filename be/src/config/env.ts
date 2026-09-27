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
      // 127.0.0.1, not localhost: on Windows localhost can resolve to ::1,
      // where WSL's relay holds the port and uploads hang.
      .default("http://127.0.0.1:3000/uploads"),
    // Refused above this at presign time, so a 40MB photo is rejected before
    // the client wastes a minute uploading it.
    // Where STORAGE_PROVIDER=local writes files. Container-local on purpose:
    // this provider is for development, and its files are not shared between
    // replicas or kept across a rebuild.
    STORAGE_LOCAL_DIR: z.string().default("uploads"),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 1024 * 1024),

    INTEGRATION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    INTEGRATION_MAX_RETRIES: z.coerce.number().int().min(0).default(2),

    SHOW_OTP_IN_RESPONSE: booleanFromString(false),

    // GST on the driver's platform fee, set only in .env -- no defaults here,
    // so a tax decision is never made by a missing line. Off until GatePass
    // has a GSTIN: an unregistered business may not collect tax.
    GST_ENABLED: z
      .enum(["true", "false"], { message: 'must be "true" or "false"' })
      .transform((value) => value === "true"),
    GST_RATE: z
      .string({ message: 'is required, e.g. "0.18" for 18%' })
      .pipe(z.coerce.number().min(0).max(1, 'is a fraction, e.g. "0.18" for 18%')),

    // GatePass's service fee: the share of each booking's parking amount it
    // keeps; the host is paid the rest. The driver pays the listed price and
    // nothing on top. Set only in .env, like the GST keys -- no default, so a
    // pricing decision is never made by a missing line.
    COMMISSION_RATE: z
      .string({ message: 'is required, e.g. "0.10" for 10%' })
      .pipe(z.coerce.number().min(0).max(1, 'is a fraction, e.g. "0.10" for 10%')),

    // Payment gateway. "none" keeps bookings working with no order behind
    // them (checkout: null); "cashfree" opens a Cashfree order per booking.
    // The secret only ever travels in a request header -- see
    // integrations/payment/cashfree/client.
    PAYMENT_PROVIDER: z.enum(["cashfree", "none"]).default("none"),
    CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    CASHFREE_CLIENT_ID: emptyToUndefined,
    CASHFREE_CLIENT_SECRET: emptyToUndefined,
    CASHFREE_API_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like "2026-01-01"')
      .default("2026-01-01"),

    // Where a driver lands after a payment page (card 3-D Secure): the
    // gateway sends them to API_PUBLIC_URL/payments/return, which forwards
    // to the app -- the gatepass:// scheme on a phone, APP_WEB_URL in a
    // desktop browser. On a real phone API_PUBLIC_URL must be an address the
    // phone can reach (the LAN IP), not 127.0.0.1.
    API_PUBLIC_URL: z.string().url().default("http://127.0.0.1:3000"),
    APP_WEB_URL: z.string().url().default("http://localhost:8081"),

    // The public HTTPS address of this API that the gateway posts payment
    // webhooks to (sent as each order's notify_url, + /webhooks/cashfree).
    // Production: the API's own domain. Development: a tunnel to this
    // machine (cloudflared), since the gateway can't reach localhost. Unset,
    // orders carry no notify_url and payments are confirmed only when a
    // driver's screen asks (GET /bookings/:id).
    WEBHOOK_PUBLIC_URL: emptyToUndefined.pipe(
      z
        .string()
        .url()
        .refine((value) => value.startsWith("https://"), "must be https:// -- Cashfree refuses anything else")
        .optional()
    ),

    // Structured logs (pino, through Fastify). Security events are `warn`,
    // state changes `info`; see lib/security-log.
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // Only behind a reverse proxy that sets X-Forwarded-For. Off, the client's
    // own header would let anyone pick the IP they are rate limited as.
    TRUST_PROXY: booleanFromString(false),

    // Requests per minute per caller (user when signed in, else IP). In
    // memory: correct for one API process; several need a shared store.
    RATE_LIMIT_ENABLED: booleanFromString(true),
    RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
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

    if (value.PAYMENT_PROVIDER === "cashfree") {
      for (const key of ["CASHFREE_CLIENT_ID", "CASHFREE_CLIENT_SECRET"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "required when PAYMENT_PROVIDER=cashfree",
          });
        }
      }

      // Without it a driver who closes the app after paying stays unconfirmed
      // until they open the booking again.
      if (value.NODE_ENV === "production" && !value.WEBHOOK_PUBLIC_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["WEBHOOK_PUBLIC_URL"],
          message: "required when NODE_ENV=production and PAYMENT_PROVIDER=cashfree",
        });
      }

      // A sandbox payment "succeeds" with test cards; in production it would
      // confirm a real booking nobody paid for.
      if (value.NODE_ENV === "production" && value.CASHFREE_ENV === "sandbox") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CASHFREE_ENV"],
          message: "sandbox is refused when NODE_ENV=production",
        });
      }
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
