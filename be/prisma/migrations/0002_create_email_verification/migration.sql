-- Migration: Create the EmailVerification table -- one-time email codes for sign-in, sign-up and password reset

CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceType" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "firstName" TEXT,
    "lastName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerification_email_idx" ON "EmailVerification"("email");
CREATE INDEX "EmailVerification_email_purpose_createdAt_idx" ON "EmailVerification"("email", "purpose", "createdAt");
