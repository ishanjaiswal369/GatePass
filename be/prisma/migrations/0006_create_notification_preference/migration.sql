-- Migration: Create the NotificationPreference table -- per-user notification switches

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startingSoon" BOOLEAN NOT NULL DEFAULT true,
    "endingSoon" BOOLEAN NOT NULL DEFAULT true,
    "refunds" BOOLEAN NOT NULL DEFAULT true,
    "reviewReminders" BOOLEAN NOT NULL DEFAULT true,
    "hostNewBookings" BOOLEAN NOT NULL DEFAULT true,
    "hostPayouts" BOOLEAN NOT NULL DEFAULT true,
    "hostListing" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "offers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
