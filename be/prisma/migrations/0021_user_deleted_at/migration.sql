-- Migration: Soft-delete marker for users
-- Created at: 2026-09-19
--
-- Deleting an account is soft: the User row and everything attached to it
-- (vehicles, address, host profile, bookings, payments) are kept unchanged,
-- and this column is stamped. Every sign-in path refuses a row that has it.
-- A hard delete was not an option: Booking.driverId has no cascade, so the
-- foreign key refuses it for anyone who has booked, and cascading a host
-- profile would orphan pending payouts. Keeping the data intact also means an
-- account can be restored by clearing this column.

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
