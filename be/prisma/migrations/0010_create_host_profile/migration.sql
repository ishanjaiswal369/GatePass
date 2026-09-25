-- Migration: Create the HostProfile table -- a user's host side: payout details and status

CREATE TABLE "HostProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "panNumber" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payoutAccountName" TEXT,
    "payoutAccountNumber" TEXT,
    "payoutIfsc" TEXT,
    "payoutSubmittedAt" TIMESTAMP(3),
    "payoutAccountId" TEXT,
    "payoutKycStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HostProfile_userId_key" ON "HostProfile"("userId");
CREATE UNIQUE INDEX "HostProfile_payoutAccountId_key" ON "HostProfile"("payoutAccountId");

ALTER TABLE "HostProfile" ADD CONSTRAINT "HostProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
