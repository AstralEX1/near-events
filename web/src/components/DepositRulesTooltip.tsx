"use client";

/**
 * `oracle`: a v3 Deposit event with a court (host bond, published list, disputes); without one the host's list is final.
 * Durations come as text from `hoursText` ("12 hours", "3 days").
 */
type Props = { ticket: boolean; amount: string; oracle?: boolean; disputeWindow?: string; submit?: string; resolve?: string; perSeat?: string };

/** Secondary payment details; the key commitment stays visible beside registration. */
export function DepositRulesTooltip({ ticket, amount, oracle, disputeWindow = "12 hours", submit = "3 days", resolve = "7 days", perSeat = "2 deposits per seat" }: Props) {
  return (
    <details className="gc-fold text-sm">
      <summary className="text-accent">{ticket ? "Ticket details" : "Deposit details"}</summary>
      <div className="pb-1 space-y-2 text-muted leading-relaxed">
        {ticket ? (
          <p>Your {amount} ticket goes to the host as soon as you register. Tickets are not refunded, even if the host cancels.</p>
        ) : oracle ? (
          <>
            <p>Your {amount} deposit is held in a NEAR smart contract. You can’t cancel your registration.</p>
            <ol className="list-decimal pl-5 space-y-1 marker:text-muted">
              <li>Registration closes when the event starts.</li>
              <li>Within {submit} after the end, the host publishes who came.</li>
              <li>For {disputeWindow}, any guest can dispute one record by locking one deposit. A council of 5 decides within {resolve} after that (3 of 5 votes).</li>
              <li>Guests who came split the pool in their Nearvent balances.</li>
            </ol>
            <p>
              The host locks a bond of {perSeat} first and loses it if the council upholds a dispute. If the host cancels
              before the start, everyone is refunded. If the host publishes no list in time, it counts as empty: guests who
              came can prove it and split the pool. If nobody proves it, everyone gets the deposit back plus a share of the bond.
            </p>
          </>
        ) : (
          <>
            <p>Your {amount} deposit is held in a NEAR smart contract. You can’t cancel your registration. After the event the host publishes who came, and guests on the list split the pool in their Nearvent balances right away. The host’s list is final.</p>
            <p>If the host cancels, every deposit goes back to your Nearvent balance. If the host publishes no list within {submit} after the end, anyone can refund every guest.</p>
          </>
        )}
        <p>No platform fee. Network and swap fees may apply when moving funds.</p>
      </div>
    </details>
  );
}
