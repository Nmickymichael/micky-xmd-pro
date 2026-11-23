export function createPairingCodeWaiter(timeoutMs = 45_000) {
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = setTimeout(() => {
    reject(new Error("WhatsApp did not request a pairing code before the timeout. Check the connection and try again."));
  }, timeoutMs);
  timer.unref?.();

  return {
    promise,
    resolve(value) {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
      return true;
    },
    reject(error) {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
      return true;
    },
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    }
  };
}

export function normalizePairingCode(value) {
  const code = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw new Error("WhatsApp returned an invalid pairing-code format.");
  }
  return code;
}

export function createOnceAsync(action) {
  let pending;
  return (...args) => {
    if (!pending) pending = Promise.resolve().then(() => action(...args));
    return pending;
  };
}
