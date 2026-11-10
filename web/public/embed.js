/*! Nearvent embed · https://github.com/AstralEX1/near-events · MIT
 *
 * <script src="https://YOUR-NEARVENT-HOST/embed.js" async></script>
 * <near-event event="3"></near-event>                       deposit block (iframe)
 * <near-event event="3" mode="button"></near-event>         just the button
 * <button onclick="NearEvents.open(3)">Join</button>        your own button
 *
 * Style: theme="light|dark|auto" accent="#ff4d1f" font="geist|poppins|system"
 *        display="serif" radius="12" label="Join the squad"
 * Flow:  then="https://lu.ma/your-event?ref={account}"  after paying, guests go on
 *        to your usual registration form; we just sit in front of it
 * Listen: element.addEventListener("registered", e => e.detail.accountId)
 *         window.addEventListener("near-events:registered", ...)
 */
(function () {
  if (window.NearEvents) return;
  var script = document.currentScript;
  var BASE = script && script.src ? new URL(script.src).origin : location.origin;
  // Passed through to the card and the sign-up window. `then` = the host's own
  // registration form, opened after the deposit is paid ({account} and {event} are filled in).
  var STYLE_ATTRS = ["theme", "accent", "font", "display", "radius", "then"];

  function query(opts) {
    var q = new URLSearchParams();
    STYLE_ATTRS.forEach(function (k) {
      if (opts && opts[k] != null && opts[k] !== "") q.set(k, String(opts[k]));
    });
    var s = q.toString();
    return s ? "?" + s : "";
  }

  function readOpts(el) {
    var o = {};
    STYLE_ATTRS.forEach(function (k) {
      var v = el.getAttribute(k);
      if (v != null) o[k] = v;
    });
    return o;
  }

  /** Opens the sign-up window. It reports back through postMessage. */
  function open(eventId, opts) {
    var url = BASE + "/embed/e/" + encodeURIComponent(eventId) + "/join" + query(opts);
    var w = window.open(url, "near-events-" + eventId, "popup,width=460,height=760");
    if (!w) location.href = url; // Pop-ups blocked: go there in this tab.
    return w;
  }

  // One listener for every embed on the page.
  var frames = new Set();
  var buttons = new Set();
  window.addEventListener("message", function (e) {
    if (e.origin !== BASE || !e.data || typeof e.data.type !== "string") return;
    var d = e.data;
    if (d.type === "near-events:resize") {
      frames.forEach(function (el) {
        if (el._frame && el._frame.contentWindow === e.source) el._frame.style.height = d.height + "px";
      });
    } else if (d.type === "near-events:registered") {
      var detail = { eventId: d.eventId, accountId: d.accountId };
      frames.forEach(function (el) {
        if (el._frame && el._frame.contentWindow === e.source) el._registered(detail);
      });
      buttons.forEach(function (el) {
        if (String(el.getAttribute("event")) === String(d.eventId)) el._registered(detail);
      });
      window.dispatchEvent(new CustomEvent("near-events:registered", { detail: detail }));
    }
  });

  var BUTTON_CSS =
    ":host{display:inline-block}" +
    "button{font:inherit;font-weight:600;cursor:pointer;border:0;color:#fff;background:var(--ne-accent,#d61f69);" +
    "border-radius:var(--ne-radius,12px);padding:.7em 1.2em;line-height:1.2;transition:opacity .15s}" +
    "button:hover{opacity:.9}button:disabled{opacity:.55;cursor:default}" +
    "small{display:block;margin-top:.35em;font-size:.75em;opacity:.7}";

  class NearEvent extends HTMLElement {
    static get observedAttributes() {
      return ["event", "mode", "label"].concat(STYLE_ATTRS);
    }
    connectedCallback() {
      this._render();
    }
    disconnectedCallback() {
      frames.delete(this);
      buttons.delete(this);
    }
    attributeChangedCallback() {
      if (this.isConnected) this._render();
    }
    _registered(detail) {
      this._registeredEventId = String(detail.eventId);
      this.dispatchEvent(new CustomEvent("registered", { detail: detail, bubbles: true, composed: true }));
      if (this._button) {
        this._button.textContent = "View pass / claim";
      }
    }
    _render() {
      var id = this.getAttribute("event");
      if (!id) return;
      var opts = readOpts(this);
      this.style.display = "block";
      frames.delete(this);
      buttons.delete(this);
      this._button = null;
      if (this.getAttribute("mode") === "button") return this._renderButton(id, opts);

      var src = BASE + "/embed/e/" + encodeURIComponent(id) + query(opts);
      if (this._frame && this._frame.src === src) return frames.add(this);
      var f = document.createElement("iframe");
      f.src = src;
      f.title = "Event deposit";
      f.loading = "lazy";
      f.style.cssText = "display:block;width:100%;max-width:560px;height:170px;border:0;background:transparent;color-scheme:normal";
      f.setAttribute("allowtransparency", "true");
      this.replaceChildren(f);
      this._frame = f;
      frames.add(this);
    }
    _renderButton(id, opts) {
      this.style.display = "inline-block";
      this._frame = null;
      var root = this.shadowRoot || this.attachShadow({ mode: "open" });
      var css = document.createElement("style");
      css.textContent = BUTTON_CSS;
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = this._registeredEventId === String(id) ? "View pass / claim" : this.getAttribute("label") || "Pay deposit";
      if (opts.accent) this.style.setProperty("--ne-accent", opts.accent);
      if (opts.radius) this.style.setProperty("--ne-radius", opts.radius + "px");
      b.addEventListener("click", function () {
        open(id, opts);
      });
      root.replaceChildren(css, b);
      this._button = b;
      buttons.add(this);

      var self = this;
      var custom = this.hasAttribute("label");
      fetch(BASE + "/api/embed/" + encodeURIComponent(id))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (e) {
          if (!e || self._button !== b) return;
          if (self._registeredEventId === String(id)) {
            b.textContent = "View pass / claim";
            return;
          }
          if (e.status === "Finalized") {
            b.textContent = e.mode === "Ticket" ? "View event" : "View payout";
          } else if (e.status === "Cancelled") {
            b.textContent = "View refund";
          } else if (e.full) {
            b.textContent = "Event full · view pass";
          } else if (e.status !== "Open") {
            b.textContent = "View event";
          } else if (!custom) {
            b.textContent = (e.mode === "Ticket" ? "Get ticket · " : "Pay deposit · ") + e.deposit_usdc + " USDC";
          }
        })
        .catch(function () {});
    }
  }

  if (!customElements.get("near-event")) customElements.define("near-event", NearEvent);
  window.NearEvents = { open: open, base: BASE };
})();
