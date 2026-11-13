import { EVENTS_CONTRACT, RPC_URL } from "@/lib/config";
import type { EventView } from "@/lib/near";

export type Rules = NonNullable<EventView["rules"]>;

/** The rules new events copy (`get_config`, read at most hourly), so the docs describe this escrow. Null on the v2 escrow or when the RPC fails: no court. */
export async function escrowRules(): Promise<Rules | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "r", method: "query", params: { request_type: "call_function", finality: "final", account_id: EVENTS_CONTRACT, method_name: "get_config", args_base64: btoa("{}") } }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    const bytes = (await res.json()).result?.result;
    return bytes ? (JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))).rules ?? null) : null;
  } catch {
    return null;
  }
}
