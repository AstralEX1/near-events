import { EVENTS_CONTRACT } from "./config";

// Shared by the browser and lib/staff.ts: what a wallet signs at sign-in to prove its
// account (no transaction, no cost); the server answers with a 1-day session token.
export const STAFF_MESSAGE = "Sign in to Nearvent";
/** The method the Google/email proof transaction names. It does not exist on the contract and is never sent. */
export const STAFF_PROOF_METHOD = "near_events_staff_sign_in";
/** What an EVM wallet signs (ERC-191) to prove its address; `at` (ms) keeps the proof fresh. */
export const evmStaffMessage = (address: string, at: number) =>
  `${STAFF_MESSAGE}\nAccount: ${address}\nContract: ${EVENTS_CONTRACT}\nTime: ${at}`;
