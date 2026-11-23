import test from "node:test";
import assert from "node:assert/strict";
import { createPairingCodeWaiter, normalizePairingCode, createOnceAsync } from "../server/whatsapp/pairing-code.js";
import { normalizeWhatsAppNumber } from "../server/whatsapp/phone.js";

test("pairing code waiter resolves exactly once", async () => {
  const waiter = createPairingCodeWaiter(1000);
  assert.equal(waiter.resolve("ABCD1234"), true);
  assert.equal(waiter.resolve("ZZZZ9999"), false);
  assert.equal(await waiter.promise, "ABCD1234");
});

test("pairing code waiter rejects exactly once", async () => {
  const waiter = createPairingCodeWaiter(1000);
  assert.equal(waiter.reject(new Error("socket closed")), true);
  assert.equal(waiter.reject(new Error("second error")), false);
  await assert.rejects(waiter.promise, /socket closed/);
});

test("pairing code normalization preserves letters and validates eight characters", () => {
  assert.equal(normalizePairingCode("abcd-1234"), "ABCD1234");
  assert.throws(() => normalizePairingCode("1234"), /invalid pairing-code format/i);
});

test("WhatsApp phone numbers normalize local Kenyan and international formats", () => {
  assert.equal(normalizeWhatsAppNumber("0712 345 678"), "254712345678");
  assert.equal(normalizeWhatsAppNumber("254712345678"), "254712345678");
  assert.equal(normalizeWhatsAppNumber("+254 712-345-678"), "254712345678");
  assert.equal(normalizeWhatsAppNumber("+1 202 555 0123"), "12025550123");
  assert.throws(() => normalizeWhatsAppNumber("123"), /valid WhatsApp phone number/i);
});

test("duplicate readiness events only issue one pairing request", async () => {
  let calls = 0;
  const request = createOnceAsync(async () => {
    calls += 1;
    return "ABCD1234";
  });
  const [first, second, third] = await Promise.all([request(), request(), request()]);
  assert.equal(first, "ABCD1234");
  assert.equal(second, "ABCD1234");
  assert.equal(third, "ABCD1234");
  assert.equal(calls, 1);
});
