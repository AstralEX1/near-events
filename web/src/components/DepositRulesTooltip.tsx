"use client";

/** `oracle`: a v3 Deposit event (host bond, published list, disputes); older escrows close with the host's list. */
type Props = { ticket: boolean; amount: string; oracle?: boolean };

/** Secondary payment details; the key commitment stays visible beside registration. */
export function DepositRulesTooltip({ ticket, amount, oracle }: Props) {
  return (
    <details className="gc-deposit-rules text-sm">
      <summary className="text-accent font-medium cursor-pointer py-2">{ticket ? "Ticket details" : "Deposit details"}</summary>
      <div className="pt-2 pb-1 space-y-2 text-muted leading-relaxed">
        {ticket ? (
          <p>Your {amount} ticket goes to the host as soon as you register. Tickets are not refunded, even if the host cancels.</p>
        ) : oracle ? (
          <>
            <p>Your {amount} deposit is held in a NEAR smart contract. You cannot cancel your registration.</p>
            <p>
              Registration closes when the event starts. After the event the host publishes who came. For 12 hours any
              guest can dispute the list by locking one deposit, and a council of 5 decides by vote. Then guests who came
              split the pool in their Nearvent balances.
            </p>
            <p>
              The host locks a bond of one deposit per seat first and loses it if a dispute proves the list wrong. If the host
              cancels before the start, everyone is refunded. If the host publishes no list within 3 days, the list counts
              as empty: guests who came can still prove it, and everyone else gets the deposit back plus a share of the bond.
            </p>
          </>
        ) : (
          <>
            <p>Your {amount} deposit is held in a NEAR smart contract. After the host closes the event, checked-in guests receive equal shares of the pool in their Nearvent balances. You cannot cancel your registration.</p>
            <p>If the host cancels, refunds are credited to guests’ Nearvent balances. If the event remains open 30 days after it ends, anyone can request a refund for all guests.</p>
          </>
        )}
        <p>No platform fee. Network and swap fees may apply when moving funds.</p>
      </div>
    </details>
  );
}
