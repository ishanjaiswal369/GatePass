import { badRequest } from "./errors.js";

/**
 * Indian mobile numbers only, stored in E.164 as +91XXXXXXXXXX.
 *
 * One stored shape matters more than it looks: the column is unique, so
 * "9876543210" and "+91 98765 43210" would otherwise be two different values
 * for one phone and both could be registered.
 *
 * Mobile numbers start 6-9; landlines and service numbers do not, and nothing
 * in this product can use them -- OTP, Razorpay contact and gate calls all
 * assume a mobile.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalisePhone(input: string): string {
  const digits = input.replace(/[\s()-]/g, "");

  const local = digits.startsWith("+91")
    ? digits.slice(3)
    : digits.startsWith("91") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0")
        ? digits.slice(1)
        : digits;

  if (!INDIAN_MOBILE.test(local)) {
    throw badRequest("Enter a valid 10-digit Indian mobile number");
  }

  return `+91${local}`;
}
