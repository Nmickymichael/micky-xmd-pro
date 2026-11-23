import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeWhatsAppNumber(value, defaultCountry = "KE") {
  const input = String(value ?? "").trim();
  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw new Error("Enter a valid WhatsApp phone number with its country code.");
  }
  return parsed.number.replace(/\D/g, "");
}
