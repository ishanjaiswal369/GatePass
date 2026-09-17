-- Migration: Add DeviceType enum and OtpVerification table
-- Created at: 2026-09-13

CREATE TYPE "DeviceType" AS ENUM ('IOS', 'ANDROID', 'WEB', 'OTHER');

CREATE TABLE "OtpVerification" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceType" "DeviceType",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpVerification_phone_idx" ON "OtpVerification"("phone");
