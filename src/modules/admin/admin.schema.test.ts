import assert from "node:assert/strict";
import test from "node:test";
import { adminEmailSchema } from "./admin.schema";

test("admin email accepts a bounded subject and plain-text message", () => {
  const parsed = adminEmailSchema.safeParse({
    subject: "Account update",
    message: "Please contact support.",
  });

  assert.equal(parsed.success, true);
});

test("admin email rejects header newlines in the subject", () => {
  const parsed = adminEmailSchema.safeParse({
    subject: "Account update\r\nBcc: attacker@example.test",
    message: "Please contact support.",
  });

  assert.equal(parsed.success, false);
});
