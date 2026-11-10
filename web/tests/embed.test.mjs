import assert from "node:assert/strict";
import test from "node:test";
import { embedReturnPath, embedVars, readEmbedStyle } from "../src/lib/embed.ts";

test("custom embed accents keep their foreground independent of app appearance", () => {
  for (const theme of ["light", "dark", "auto"]) {
    const vars = embedVars(readEmbedStyle(new URLSearchParams({ theme, accent: "#6550b9" })));
    assert.equal(vars["--accent"], "#6550b9");
    assert.equal(vars["--on-accent"], "#ffffff");
  }
});

test("embedReturnPath only accepts the matching internal join page", () => {
  assert.equal(embedReturnPath("/embed/e/12/join?theme=dark", 12), "/embed/e/12/join?theme=dark");
  assert.equal(embedReturnPath("/embed/e/12/join?theme=dark&ignored=value", 12), "/embed/e/12/join?theme=dark");
  assert.equal(embedReturnPath("https://attacker.example/", 12), null);
  assert.equal(embedReturnPath("/embed/e/13/join", 12), null);
  assert.equal(embedReturnPath("/e/12/pay", 12), null);
  assert.equal(embedReturnPath("/embed/e/12/join#fragment", 12), null);
});
