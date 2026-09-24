/**
 * Rupees, as the API means them.
 *
 * Amounts cross the wire as decimal strings because a price is not a float.
 * Paise are shown whenever there are any: a checkout that rounds ₹37.50 up to
 * ₹38 is quoting a price nobody is going to be charged.
 */
export function formatRupees(amount: number | string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";

  // Indian grouping: ₹12,236 and ₹1,00,000, the way prices are read here.
  const [rupees, paise] = value.toFixed(2).split(".");
  const grouped = Number(rupees).toLocaleString("en-IN");
  return `₹${grouped}${paise === "00" ? "" : `.${paise}`}`;
}

/**
 * What a stay costs: the hourly rate billed by the minute, to the paisa.
 *
 * Mirrors booking.service.createSpotBooking. Only ever an estimate shown
 * before booking -- the server prices the booking from its own SpotPricing
 * row, and what it answers with is what the screens show afterwards.
 */
export function hourlyAmount(
  pricePerHour: number | string,
  minutes: number
): number {
  return Math.round((Number(pricePerHour) * minutes * 100) / 60) / 100;
}
