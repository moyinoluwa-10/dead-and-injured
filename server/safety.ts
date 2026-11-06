/**
 * Wraps a callback so that an exception is logged instead of escaping. An uncaught
 * exception in an event handler or timer would otherwise end the whole process and
 * every game in it.
 */
export function safely<A extends unknown[]>(
  label: string,
  fn: (...args: A) => void,
  onError?: (err: unknown) => void
): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`error in ${label}`, err);
      try {
        onError?.(err);
      } catch (nested) {
        console.error(`error while reporting an error in ${label}`, nested);
      }
    }
  };
}

/** True for loopback and private-network addresses, which say nothing about who the real client is. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, "").toLowerCase();
  return (
    ip === "::1" ||
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^f[cd][0-9a-f]{2}:/.test(ip) ||
    /^fe80:/.test(ip)
  );
}

/** `base`, or `base (2)`, `base (3)`… so that no two players share a name (case-insensitive). */
export function uniqueName(base: string, isTaken: (candidate: string) => boolean, maxLength: number): string {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, Math.max(1, maxLength - suffix.length)) + suffix;
    if (!isTaken(candidate)) return candidate;
  }
}
