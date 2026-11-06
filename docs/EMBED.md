# Put Near Me on your website

Add a deposit-backed registration button to an event page you already have. A
click opens the Near Me checkout window while leaving the host page available
behind it when the browser allows a separate window. On phones it may open a
new tab; if a pop-up is blocked, checkout opens in the current tab. Deposits
stay in the Near Me contract, and there is no platform fee.

## Add a registration button

Create or import the event in Near Me. On the creation screen or in that event’s **Manage → Registration** tab, copy this code:

```html
<script src="https://YOUR-NEAR-ME-HOST/embed.js" async></script>
<near-event event="6" mode="button"></near-event>
```

The button shows the current deposit and opens the first-party Near Me
registration page. Once registration succeeds, it stays clickable as **View
pass / claim**. Guests can reopen it for their QR pass, and after the event
closes they can view their payout or refund there. Deposit guests who were
checked in can claim their payout; the page explains the outcome for everyone
else. If their wallet or sign-in session is not restored, checkout asks them to
sign in before showing their pass or payout.

The creation screen and Manage → Registration tab also give you a direct
checkout link, `/p/6`, for a message or a site builder that does not allow
scripts.

### Continue to your own registration form (optional)

If guests need to fill in your existing form after paying, add a `then` URL:

```html
<near-event event="6" mode="button"
  then="https://yoursite.com/register?account={account}&event={event}"></near-event>
```

After the deposit, checkout shows a **Finish registration** link to that form.
`{account}` and `{event}` are filled in. The URL must use HTTPS (localhost may
use HTTP for testing).

## Existing event-card embeds

Existing card embeds continue to work. For new integrations, use the button
above.

```html
<script src="https://YOUR-NEAR-ME-HOST/embed.js" async></script>
<near-event event="6"></near-event>
```

This renders an event card with its title, date, attendance, pool, and
registration button. You can keep your own button and open the same checkout
with `NearEvents.open(6)`.

The element supports these optional settings for existing integrations:

| Attribute | Values | Default |
|---|---|---|
| `theme` | `light`, `dark`, `auto` | `light` |
| `accent` | any hex color, e.g. `#ff401f` | Near Me purple |
| `font` | `geist`, `poppins`, `system` | `geist` |
| `display` | `serif` for an event title | same font |
| `radius` | corner radius in px, 0 to 32 | 16 |
| `label` | custom button label (`mode="button"` only) | `Register · <deposit> USDC` |

### Knowing who registered

```js
document.querySelector("near-event").addEventListener("registered", (e) => {
  console.log(e.detail); // { eventId: 6, accountId: "…" }
});
// Or listen for every button on the page:
window.addEventListener("near-events:registered", (e) => {
  /* e.detail = { eventId, accountId } */
});
```

The account id is the guest's NEAR account. It is already public on-chain in
the event's guest list, so nothing private is shared.

### Existing iframe cards

Sites that cannot load scripts can keep using the card iframe:

```html
<iframe src="https://YOUR-NEAR-ME-HOST/embed/e/6"
  title="Event registration" loading="lazy"
  style="width:100%;max-width:560px;height:260px;border:0"></iframe>
```

The iframe does not send the `registered` event to the host page. New
integrations should use the button snippet instead.

## Direct links

- Checkout: `https://YOUR-NEAR-ME-HOST/p/6`
- Event page: `https://YOUR-NEAR-ME-HOST/e/6`

The event page works in a social bio, email, message, or QR code at the venue.

## How it works

```
your event page ── button ──► Near Me checkout window
      ▲                               │
      └──── near-events:registered ───┘
                                      ├─ after registration: QR pass
                                      └─ after event close: payout/refund view
```

- Checkout runs on the Near Me domain as a top-level page, so wallet approvals,
  Google/email sign-in, and payment redirects can work. On desktop it may open
  in a separate window; on phones it may open a tab. A blocked pop-up falls back
  to the current tab.
- The checkout reports a successful registration to the opener with
  `near-events:registered`. The button remains available as **View pass / claim**
  to reopen the guest's pass or later payout page. Full, cancelled, and finalized
  events also leave the button clickable so a guest can view their pass, refund,
  or payout state.
- Only existing event cards (`/embed/e/:id`) may be framed by other sites.
  Checkout pages are not frameable, which protects wallet approvals from being
  overlaid by another page.
- `GET /api/embed/:id` returns a public event summary with CORS enabled. The
  button uses it to show the deposit and whether the event is full or closed.
- `embed.js` has no dependencies and works with common site builders and
  framework sites that allow custom HTML.

## Host setup

1. Create or import the event at `/create` and add the door person as a co-host.
2. Copy the button code or checkout link from the creation screen or that event’s Manage → Registration tab.
3. Add it to your event page.
4. Manage registrations and check-in in Near Me. Close the event there; eligible
   guests can then claim their payout from the same checkout page.

The snippet needs a public HTTPS host for the web app (see
[`DEPLOY.md`](DEPLOY.md)). `localhost` only works on your own machine. On
mainnet, guests can pay with USDC from other chains through 1Click.
