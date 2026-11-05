# Put Near Me on your website

Any business that runs events (a community, a coworking, a run club) can take
deposit-backed registrations on its own site. The guest never leaves the page,
the money sits in the Near Me contract, and there is no platform fee.

Using a coding agent? Send it the prompt in [AI_INSTALL.md](AI_INSTALL.md).

Product path: **Integrate widget** at **`/widget`** — choose Luma (payment link) or your landing
(embed). Fastest for a host: open **`/widget`** (the "Integrate"
link in the header, or "Put it on your website" on your event page), pick the
event, match your colors, copy the code.

## 1. Script + element (recommended)

```html
<script src="https://YOUR-NEAR-ME-HOST/embed.js" async></script>

<near-event event="6"></near-event>
```

That renders an event card (title, date, place, who is going, pool) with a
**Register · 3 USDC deposit** button. The card sizes itself to its content.

Just the button, for sites that already have their own event cards:

```html
<near-event event="7" mode="button"></near-event>
<near-event event="7" mode="button" label="Save my seat"></near-event>
```

Or your own button:

```html
<button onclick="NearEvents.open(8)">I'm in</button>
```

### Style attributes

| Attribute | Values | Default |
|---|---|---|
| `theme` | `light`, `dark`, `auto` (follows the visitor's OS) | `light` |
| `accent` | any hex color, e.g. `#ff401f` | Near Me purple |
| `font` | `geist`, `poppins`, `system` | `geist` |
| `display` | `serif` for a serif event title (Instrument Serif) | same font |
| `radius` | corner radius in px, 0 to 32 (buttons: any) | 16 |
| `label` | button text (`mode="button"` only) | `Register · <deposit> USDC` |
| `then` | your own registration form; guests go there after paying. `{account}` and `{event}` in the URL are filled in | none |

### Keep your own registration form

We can sit in front of the flow you already have instead of replacing it:

```html
<near-event event="6" then="https://lu.ma/your-event?ref={account}"></near-event>
```

The guest pays the deposit in our window, then gets a **Finish registration →**
button to your usual form (Luma, Typeform, Google Forms, your own page). The
`{account}` placeholder lets you match each form entry to a payment.

`NearEvents.open(id, { accent, theme, font, display, radius })` takes the same
style options for the sign-up window.

### Knowing who registered

```js
document.querySelector("near-event").addEventListener("registered", (e) => {
  console.log(e.detail); // { eventId: 6, accountId: "…" }
});
// or, for every embed on the page:
window.addEventListener("near-events:registered", (e) => { /* toast, CRM, WhatsApp invite… */ });
```

The account id is the guest's NEAR account. It is already public on-chain in
the event's guest list, so nothing private is shared.

## 2. Iframe (when the site builder doesn't allow scripts)

```html
<iframe src="https://YOUR-NEAR-ME-HOST/embed/e/6?accent=%23ff401f&font=poppins"
  title="Event registration" loading="lazy"
  style="width:100%;max-width:560px;height:260px;border:0"></iframe>
```

Same card and the same query parameters as the style attributes above. You set
the height yourself and don't get the `registered` event.

## 3. Plain link

`https://YOUR-NEAR-ME-HOST/e/6` works anywhere: Instagram bio, WhatsApp,
email, QR code at the venue.

## How it works

```
your page ── embed.js ──► <iframe /embed/e/:id>  (card, read-only)
                │                   │ click "Register"
                │                   ▼
                │          window /embed/e/:id/join  (sign in + pay deposit)
                │                   │ postMessage "near-events:registered"
                ◄───────────────────┘ (via the card, or straight to your page)
```

- Sign-up happens in a small window on the Near Me domain, not inside the
  iframe. Wallet pop-ups, Google/email sign-in (FastAuth) and 1Click payment
  all need a normal top-level page; inside a third-party iframe browsers block
  their storage and pop-ups. On phones the window opens as a new tab.
- Only the card (`/embed/e/:id`) may be framed by other sites
  (`frame-ancestors *`). Every other page, including the sign-up window where
  guests approve transactions, sends `frame-ancestors 'self'`, so nobody can
  overlay it on another site (clickjacking).
- `GET /api/embed/:id` returns a public summary (title, time, deposit, going,
  capacity, status) with `Access-Control-Allow-Origin: *`. `embed.js` uses it
  for button labels; you can use it to render your own listing.
- `embed.js` has no dependencies and works with any site builder (Webflow,
  Tilda, WordPress, Wix custom code) and in React/Vue (custom elements are
  supported natively).

## Host onboarding, start to finish

1. **Create the event** at `/create` with a NEAR wallet or Google/email. Add the
   door person as co-host.
2. **Open `/widget`**, pick the event, choose a style preset or your own colors,
   copy the code.
3. **Paste it** into the site where the event should appear.
4. **On the day**, the host or a co-host opens the event's *Manage* page and
   checks people in. Closing the event pays everyone who came.

## Before giving it to a client

The snippet needs a public HTTPS host for the web app (see `docs/DEPLOY.md`).
`localhost` only works on your own machine. On mainnet the same code takes real
USDC from any chain through 1Click.
