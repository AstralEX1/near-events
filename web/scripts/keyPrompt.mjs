// Prompts for the deploy and owner scripts. A key is read from ~/.near-credentials or typed at a
// hidden prompt (private key or seed phrase); it is never printed or saved.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseSeedPhrase } from "near-seed-phrase";
import { KeyPair } from "near-api-js";

export const fail = (msg) => { console.error(msg); process.exit(1); };
const cancel = () => fail("\nCancelled; nothing was sent.");

// `muted` hides what is typed for a key.
let rl, muted = false, waiting = false, closed = false;
export async function ask(question, hidden = false) {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: new Writable({ write: (c, e, cb) => { if (!muted) process.stdout.write(c, e); cb(); } }), terminal: Boolean(process.stdin.isTTY) });
    rl.on("SIGINT", cancel); // Ctrl+C
    rl.on("close", () => { closed = true; if (waiting) cancel(); }); // Ctrl+D, or piped input ended, while a question is open
  }
  if (closed) cancel();
  process.stdout.write(question);
  muted = hidden;
  waiting = true;
  const answer = (await rl.question("")).trim();
  waiting = false;
  muted = false;
  if (hidden) process.stdout.write("\n");
  return answer;
}
export const closePrompts = () => rl?.close();

export const credPath = (network, account) => `${homedir()}/.near-credentials/${network}/${account}.json`;

// A full-access key of `account`, from its credentials file or the hidden prompt.
export async function accountKey(provider, network, account) {
  const secret = existsSync(credPath(network, account))
    ? JSON.parse(readFileSync(credPath(network, account), "utf8")).private_key
    : await ask(`Private key (ed25519:...) or seed phrase of ${account} (hidden, not saved): `, true);
  if (!secret) fail(`No key for ${account}`);
  let key;
  try { key = KeyPair.fromString(/\s/.test(secret) ? parseSeedPhrase(secret).secretKey : secret); } catch { fail("That is not a NEAR private key or seed phrase"); }
  const access = await provider.viewAccessKey({ accountId: account, publicKey: key.getPublicKey().toString() }).catch(() => null);
  if (access?.permission !== "FullAccess") fail(`This key is not a full-access key of ${account}`);
  return key;
}
