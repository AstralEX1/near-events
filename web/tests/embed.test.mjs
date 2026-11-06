import assert from "node:assert/strict";
import test from "node:test";
import { embedReturnPath } from "../src/lib/embed.ts";

test("embedReturnPath only accepts the matching internal join page", () => {
  assert.equal(embedReturnPath("/embed/e/12/join?theme=dark", 12), "/embed/e/12/join?theme=dark");
  assert.equal(embedReturnPath("/embed/e/12/join?theme=dark&ignored=value", 12), "/embed/e/12/join?theme=dark");
  assert.equal(embedReturnPath("https://attacker.example/", 12), null);
  assert.equal(embedReturnPath("/embed/e/13/join", 12), null);
  assert.equal(embedReturnPath("/e/12/pay", 12), null);
  assert.equal(embedReturnPath("/embed/e/12/join#fragment", 12), null);
});
