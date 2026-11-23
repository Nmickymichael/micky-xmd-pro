import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeWhatsAppNumber(value, defaultCountry = "KE") {
  const input = String(value ?? "").trim();
  const digits = input.replace(/\D/g, "");
  const candidate = input.startsWith("+")
    ? input
    : /^254[17]\d{8}$/.test(digits)
      ? `+${digits}`
      : input;
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw new Error("Enter a valid WhatsApp phone number with its country code.");
  }
  return parsed.number.replace(/\D/g, "");
}
