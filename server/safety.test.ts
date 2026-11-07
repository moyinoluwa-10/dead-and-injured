import { test } from "node:test";
import assert from "node:assert/strict";
import { describeClient, isPrivateAddress, safely, uniqueName } from "./safety";

test("describeClient gives a coarse label and never the raw user agent", () => {
  const cases: [string | undefined, string][] = [
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "iOS Safari",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
      "iOS Chrome",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "Android Chrome",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0",
      "Windows Edge",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "macOS Safari",
    ],
    [undefined, "unknown client"],
  ];
  for (const [ua, expected] of cases) assert.equal(describeClient(ua), expected);
});

test("safely passes arguments through and swallows errors", () => {
  const seen: unknown[] = [];
  safely("ok", (a: number, b: number) => seen.push(a + b))(1, 2);
  assert.deepEqual(seen, [3]);

  const reported: unknown[] = [];
  const log = console.error;
  console.error = () => {};
  try {
    const wrapped = safely(
      "boom",
      () => {
        throw new Error("boom");
      },
      (err) => reported.push(err)
    );
    assert.doesNotThrow(() => wrapped());
    assert.equal((reported[0] as Error).message, "boom");

    // even a failing error reporter must not escape
    const nested = safely(
      "boom",
      () => {
        throw new Error("boom");
      },
      () => {
        throw new Error("reporter failed");
      }
    );
    assert.doesNotThrow(() => nested());
  } finally {
    console.error = log;
  }
});

test("isPrivateAddress", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.1", "fd12::1", "fe80::1"]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "203.0.113.5", "2001:db8::1", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(a), false, a);
  }
});

test("uniqueName adds a numeric suffix and respects the length limit", () => {
  const taken = new Set(["don", "don (2)"]);
  const isTaken = (n: string) => taken.has(n.toLowerCase());
  assert.equal(uniqueName("Ada", isTaken, 20), "Ada");
  assert.equal(uniqueName("Don", isTaken, 20), "Don (3)");
  assert.equal(uniqueName("DON", isTaken, 20), "DON (3)");

  const long = "x".repeat(20);
  const result = uniqueName(long, (n) => n === long, 20);
  assert.equal(result.length, 20);
  assert.ok(result.endsWith(" (2)"));
});
