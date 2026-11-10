"use client";

type Props = { ticket: boolean; amount: string };

/** Secondary payment details; the key commitment stays visible beside registration. */
export function DepositRulesTooltip({ ticket, amount }: Props) {
  return (
    <details className="gc-deposit-rules text-sm">
      <summary className="text-accent font-medium cursor-pointer py-2">{ticket ? "Ticket details" : "Deposit details"}</summary>
      <div className="pt-2 pb-1 space-y-2 text-muted leading-relaxed">
        <p>{ticket
          ? `Your ${amount} ticket is held in a NEAR smart contract. Revenue is credited to the host when they close the event, after it starts.`
          : `Your ${amount} deposit is held in a NEAR smart contract. After the host closes the event, checked-in guests receive equal shares of the pool in their Nearvent balances. You cannot cancel your registration.`}</p>
        <p>If the host cancels, refunds are credited to guests’ Nearvent balances. If the event remains open 30 days after it ends, anyone can request a refund for all guests.</p>
        <p>No platform fee. Network and swap fees may apply when moving funds.</p>
      </div>
    </details>
  );
}
