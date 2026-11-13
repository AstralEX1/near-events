"use client";

// NEAR Auth (Google / email / passkey) for guests without a crypto wallet.
// The user's key lives in the MPC network; each transaction is approved in an
// Auth0 popup, signed via the fast-auth contract (gas paid by our relayer) and
// sent from the user's own implicit account.
import type { FastAuthClient, FastAuthSigner } from "@fast-auth-near/browser-sdk";
import type { JavascriptProvider } from "@fast-auth-near/javascript-provider";
import { EVENTS_CONTRACT, FASTAUTH_CLIENT_ID, FASTAUTH_META_TX, NETWORK, RPC_URL, USDC_CONTRACT } from "./config";
import type { Call } from "./wallet";
const CONTRACTS =
  NETWORK === "mainnet"
    ? { fastAuthContractId: "fast-auth.near", mpcContractId: "v1.signer" }
    : { fastAuthContractId: "fast-auth.testnet", mpcContractId: "v1.signer-prod.testnet" };

interface Base {
  client: FastAuthClient<JavascriptProvider>;
  provider: JavascriptProvider;
}

interface Session extends Base {
  signer: FastAuthSigner<JavascriptProvider>;
  publicKey: string;
  accountId: string;
}

let base: Promise<Base> | null = null;
export const RETURN_KEY = "near-events:return-to";
let session: Promise<Session> | null = null;

/**
 * Loads the SDK ahead of time. Browsers only allow a popup right after a click,
 * so the click handler must reach `login()` without slow awaits in between.
 */
export function fastAuthPrepare(): Promise<Base> {
  base ??= (async () => {
    // Checked before the imports: the SDKs are ~500 KB of JS.
    if (!FASTAUTH_CLIENT_ID) throw new Error("Google and email sign-in is not set up yet. Use a wallet.");
    const [{ FastAuthClient }, { JavascriptProvider }, { connect }] = await Promise.all([
      import("@fast-auth-near/browser-sdk"),
      import("@fast-auth-near/javascript-provider"),
      import("near-api-js-v5"),
    ]);
    const provider = new JavascriptProvider({ network: NETWORK, clientId: FASTAUTH_CLIENT_ID });
    const { connection } = await connect({ networkId: NETWORK, nodeUrl: RPC_URL });
    // Types come from separate copies of near-api-js 5; they match at runtime.
    const client = new FastAuthClient(provider, connection as never, CONTRACTS);
    return { client, provider };
  })();
  return base;
}

async function openSession(b: Base): Promise<Session> {
  const signer = await b.client.getSigner();
  const publicKey = String(await signer.getPublicKey("ed25519"));
  const accountId = await implicitAccountId(publicKey);
  // The relayer creates a brand-new account: 0.5 NEAR for gas on testnet, just its storage on mainnet.
  await fetch("/api/fastauth/fund", { method: "POST", body: JSON.stringify({ accountId }) }).catch(() => {});
  return { ...b, signer, publicKey, accountId };
}

async function implicitAccountId(publicKey: string): Promise<string> {
  const { utils } = await import("near-api-js-v5");
  const bytes = utils.PublicKey.fromString(publicKey).data;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Opens the Google/email popup and returns the user's NEAR account. If the
 * browser blocks popups, falls back to a full-page redirect (the page then
 * reloads and `fastAuthRestore` finishes the sign-in).
 */
export async function fastAuthLogin(): Promise<string> {
  const b = await fastAuthPrepare();
  try {
    await b.client.login();
  } catch (e) {
    if (!/popup/i.test(String(e))) throw e;
    // Auth0 only accepts the site root as callback; remember where to come back to.
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);
    localStorage.setItem("near-events:login", "email");
    await b.client.login({ redirectUri: window.location.origin });
    return new Promise(() => {}); // The page is navigating away.
  }
  session = openSession(b);
  try {
    return (await session).accountId;
  } catch (e) {
    session = null;
    throw e;
  }
}

/** Finishes a redirect sign-in or restores a live Auth0 session, without a popup. */
export async function fastAuthRestore(): Promise<string | null> {
  try {
    const b = await fastAuthPrepare();
    if (!(await b.provider.isLoggedIn())) return null;
    const url = new URL(window.location.href);
    if (url.searchParams.has("code")) {
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      window.history.replaceState(null, "", url.toString());
    }
    session = openSession(b);
    return (await session).accountId;
  } catch {
    session = null;
    return null;
  }
}

export async function fastAuthLogout(): Promise<void> {
  const b = await base?.catch(() => null);
  session = null;
  // The provider directly: FastAuthClient.logout passes its args on as one array, so Auth0
  // never sees openUrl: false and sends the whole page to its logout URL (every NEAR wallet sign-in).
  await b?.provider.logout({ openUrl: false }).catch(() => {});
}

/** Re-open the Auth0/MPC session after a reload, or throw a clear error. */
export async function fastAuthEnsure(): Promise<string> {
  if (session) {
    const s = await session;
    if (s.accountId) return s.accountId;
  }
  const id = await fastAuthRestore();
  if (!id) throw new Error("Sign in with Google or email again.");
  return id;
}

/** Signs one call with the MPC key (Auth0 popup) and sends it. */
export async function fastAuthSend(call: Call): Promise<void> {
  await fastAuthEnsure();
  if (!session) throw new Error("Sign in with Google or email first");
  const s = await session;
  if (!s.accountId) throw new Error("Sign in with Google or email again.");
  if (FASTAUTH_META_TX) return relaySend(s, call);
  const { transactions, utils } = await import("near-api-js-v5");

  const key = await rpcQuery<{ nonce: number; block_hash: string }>({
    request_type: "view_access_key",
    finality: "final",
    account_id: s.accountId,
    public_key: s.publicKey,
  });
  const tx = transactions.createTransaction(
    s.accountId,
    utils.PublicKey.fromString(s.publicKey),
    call.receiverId,
    BigInt(key.nonce) + 1n,
    [transactions.functionCall(call.methodName, call.args, call.gas ?? 100_000_000_000_000n, call.deposit ?? 0n)],
    utils.serialize.base_decode(key.block_hash),
  );

  await s.signer.requestTransactionSignature({ transaction: tx as never });
  const { FastAuthSignature } = await import("@fast-auth-near/browser-sdk");
  const signature = FastAuthSignature.fromBase64((await mpcSign(s, "Could not sign the transaction")).signature);
  const outcome = await s.signer.sendTransaction(tx as never, signature, "ed25519");
  const status = outcome?.status as { Failure?: unknown } | undefined;
  if (status?.Failure) throw new Error(`Transaction failed: ${JSON.stringify(status.Failure)}`);
}

/**
 * Mainnet: the account holds no NEAR, so the MPC key signs a NEP-366 delegate
 * action and our relayer wraps it in its own transaction, paying the gas.
 */
async function relaySend(s: Session, call: Call): Promise<void> {
  // A USDC storage registration needs NEAR the account does not have; the relayer pays it instead.
  if (call.receiverId === USDC_CONTRACT && call.methodName === "storage_deposit") {
    return relay({ storageFor: (call.args as { account_id: string }).account_id });
  }
  const { transactions, utils } = await import("near-api-js-v5");
  const key = await rpcQuery<{ nonce: number; block_height: number }>({
    request_type: "view_access_key",
    finality: "final",
    account_id: s.accountId,
    public_key: s.publicKey,
  });
  const delegateAction = {
    senderId: s.accountId,
    receiverId: call.receiverId,
    actions: [transactions.functionCall(call.methodName, call.args, call.gas ?? 100_000_000_000_000n, call.deposit ?? 0n)],
    nonce: BigInt(key.nonce) + 1n,
    // About ten minutes for the Auth0 popup and the relay.
    maxBlockHeight: BigInt(key.block_height) + 600n,
    publicKey: utils.PublicKey.fromString(s.publicKey),
  };
  await s.signer.requestDelegateActionSignature({ delegateAction: delegateAction as never });
  const { signature, payload } = await mpcSign(s, "Could not sign the transaction");
  const { FastAuthSignature } = await import("@fast-auth-near/browser-sdk");
  const raw = FastAuthSignature.fromBase64(signature).recover("ed25519");
  // The relayer sends exactly the bytes the MPC network signed.
  await relay({ delegate: toB64(Uint8Array.from(payload)), signature: toB64(new Uint8Array(raw)) });
}

async function relay(body: object): Promise<void> {
  const res = await fetch("/api/fastauth/relay", { method: "POST", body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not send the transaction");
}

/** Asks the fast-auth contract (through our relayer) to sign the request the Auth0 popup approved. */
async function mpcSign(s: Session, failure: string): Promise<{ signature: string; payload: number[] }> {
  const { signatureRequest } = await s.signer.getSignatureRequest();
  const res = await fetch("/api/fastauth/sign", {
    method: "POST",
    body: JSON.stringify({
      guard_id: signatureRequest.guardId,
      verify_payload: signatureRequest.verifyPayload,
      sign_payload: signatureRequest.signPayload,
      algorithm: "eddsa",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? failure);
  return { signature: json.signature, payload: signatureRequest.signPayload as number[] };
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/**
 * Proves the Google/email account to our server without spending anything:
 * the MPC key signs a transaction that is never sent (see lib/staff.ts).
 */
export async function fastAuthProve(): Promise<{ transaction: string; signature: string }> {
  await fastAuthEnsure();
  if (!session) throw new Error("Sign in with Google or email first");
  const s = await session;
  if (!s.accountId) throw new Error("Sign in with Google or email again.");
  const { transactions, utils } = await import("near-api-js-v5");
  const { STAFF_PROOF_METHOD } = await import("./staffShared");
  const tx = transactions.createTransaction(
    s.accountId,
    utils.PublicKey.fromString(s.publicKey),
    EVENTS_CONTRACT,
    0n,
    [transactions.functionCall(STAFF_PROOF_METHOD, { at: Date.now() }, 1n, 0n)],
    new Uint8Array(32),
  );
  await s.signer.requestTransactionSignature({ transaction: tx as never });
  const { FastAuthSignature } = await import("@fast-auth-near/browser-sdk");
  const signature = FastAuthSignature.fromBase64((await mpcSign(s, "Could not sign in")).signature).recover("ed25519");
  return { transaction: toB64(tx.encode()), signature: toB64(new Uint8Array(signature)) };
}

async function rpcQuery<T>(params: object): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "q", method: "query", params }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) {
    throw new Error("Your account is not ready yet. Wait a few seconds and try again.");
  }
  return json.result as T;
}
