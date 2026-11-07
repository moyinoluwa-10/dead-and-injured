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

/** A short label such as "iOS Safari" for logs. Deliberately coarse: no versions, nothing identifying. */
export function describeClient(userAgent: string | undefined): string {
  if (!userAgent) return "unknown client";
  const os = /iPhone|iPad|iPod/i.test(userAgent)
    ? "iOS"
    : /Android/i.test(userAgent)
      ? "Android"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : /node|undici/i.test(userAgent)
              ? "Node"
              : "other OS";
  // Order matters: Chrome and Edge identify as Safari too, and iOS browsers all say "Safari".
  const browser = /CriOS/i.test(userAgent)
    ? "Chrome"
    : /FxiOS|Firefox/i.test(userAgent)
      ? "Firefox"
      : /EdgiOS|Edg\//i.test(userAgent)
        ? "Edge"
        : /Chrome/i.test(userAgent)
          ? "Chrome"
          : /Safari/i.test(userAgent)
            ? "Safari"
            : "";
  return browser ? `${os} ${browser}` : os;
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
