# Put Near Me on your website

Any business that runs events (a community, a coworking, a run club) can take
deposit-backed registrations on its own site. The guest never leaves the page,
the money sits in the Near Me contract, and there is no platform fee.

Using a coding agent? Send it the prompt in [AI_INSTALL.md](AI_INSTALL.md).

The widget is deposit-only: your event keeps living on your own site (title,
date, place, description), and the widget adds only the deposit. You don't
create the event again on Near Me. Open **`/widget`** (the "Integrate" link in
the header), fill in **Set up a deposit** (link to your event page, name,
start time, deposit, seats), sign once, match your colors, copy the code.

## 1. Script + element (recommended)

```html
<script src="https://YOUR-NEAR-ME-HOST/embed.js" async></script>

<near-event event="6"></near-event>
```

That renders a deposit box (amount, who is going, seats left, pool) with a
**Pay deposit · 3 USDC** button. It sizes itself to its content. It shows no
title, date or cover: your page already does.

Just the button:

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
| `label` | button text (`mode="button"` only) | `Pay deposit · <deposit> USDC` |
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

Same deposit box and the same query parameters as the style attributes above. You set
the height yourself and don't get the `registered` event.

## 3. Plain link

`https://YOUR-NEAR-ME-HOST/e/6` works anywhere: Instagram bio, WhatsApp,
email, QR code at the venue.

## How it works

```
your page ── embed.js ──► <iframe /embed/e/:id>  (deposit box, read-only)
                │                   │ click "Register"
                │                   ▼
                │          window /embed/e/:id/join  (sign in + pay deposit)
                │                   │ postMessage "near-events:registered"
                ◄───────────────────┘ (via the box, or straight to your page)
```

- Sign-up happens in a small window on the Near Me domain, not inside the
  iframe. Wallet pop-ups, Google/email sign-in (FastAuth) and 1Click payment
  all need a normal top-level page; inside a third-party iframe browsers block
  their storage and pop-ups. On phones the window opens as a new tab.
- Only the deposit box (`/embed/e/:id`) may be framed by other sites
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

1. **Open `/widget`** and fill in *Set up a deposit*: a link to your event page,
   the name guests see when paying, start time, deposit and seats. Sign in
   (NEAR wallet, EVM wallet or Google/email) and confirm once. The deposit
   escrow is created under your account; no event page on Near Me is needed.
2. Choose a style preset or your own colors, copy the code (or the AI prompt).
3. **Paste it** next to your event, where guests would sign up.
4. **On the day**, the host or a co-host opens the event's *Manage* page and
   checks people in. Closing the event pays everyone who came.

## Before giving it to a client

The snippet needs a public HTTPS host for the web app (see `docs/DEPLOY.md`).
`localhost` only works on your own machine. On mainnet the same code takes real
USDC from any chain through 1Click.
