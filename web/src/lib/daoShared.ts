/** Accounts made by the Sputnik DAO factory: sputnik-dao.near on mainnet, sputnikv2.testnet on testnet. */
export const isDaoAccount = (account: string) => /\.(sputnik-dao\.near|sputnikv2\.testnet)$/.test(account);

export type Policy = { roles: { name: string; kind: unknown }[]; proposal_bond?: string };

/** The accounts of the policy's `council` group. */
export function councilOf(policy: Policy): string[] {
  const council = policy.roles.find((r) => r.name === "council")?.kind as { Group?: string[] } | undefined;
  return council?.Group ?? [];
}

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** `add_proposal` arguments for a DAO proposal that calls one method on another contract. */
export function functionCallProposal(o: {
  description: string;
  receiverId: string;
  method: string;
  args: object;
  /** yoctoNEAR the call attaches. */
  deposit: string;
  /** Gas for the call, in gas units. */
  gas: string;
}) {
  return {
    proposal: {
      description: o.description,
      kind: {
        FunctionCall: {
          receiver_id: o.receiverId,
          actions: [{ method_name: o.method, args: toBase64(JSON.stringify(o.args)), deposit: o.deposit, gas: o.gas }],
        },
      },
    },
  };
}
