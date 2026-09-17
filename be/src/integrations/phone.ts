export function toE164(input: string, countryCode = "91"): string {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) {
    return `${countryCode}${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `${countryCode}${digits.slice(1)}`;
  }

  return digits;
}
