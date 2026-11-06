import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, safely, uniqueName } from "./safety";

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
