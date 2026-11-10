"use client";

type Props = { ticket: boolean; amount: string };

/** Secondary payment details; the key commitment stays visible beside registration. */
export function DepositRulesTooltip({ ticket, amount }: Props) {
  return (
    <details className="gc-deposit-rules text-sm">
      <summary className="text-accent font-medium cursor-pointer py-2">{ticket ? "Ticket details" : "Deposit details"}</summary>
      <div className="pt-2 pb-1 space-y-2 text-muted leading-relaxed">
        <p>{ticket
          ? `Your ${amount} ticket goes to the host as soon as you register. Tickets are not refunded, even if the host cancels.`
          : `Your ${amount} deposit is held in a NEAR smart contract. After the host closes the event, checked-in guests receive equal shares of the pool in their Near Me balances. You cannot cancel your registration.`}</p>
        {!ticket && <p>If the host cancels, refunds are credited to guests’ Near Me balances. If the event remains open 30 days after it ends, anyone can request a refund for all guests.</p>}
        <p>No platform fee. Network and swap fees may apply when moving funds.</p>
      </div>
    </details>
  );
}
