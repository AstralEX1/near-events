import{retainFont as B}from"./react-font.mjs";const T="copy";const I='<button class="sl-copy" id="copy-button" type="button" aria-label="Copy text" data-state="idle" disabled>\n          <span class="sl-copy__surface" aria-hidden="true">\n            <span class="sl-copy__wash"></span>\n            <span class="sl-copy__icon">\n              <svg class="sl-copy__sheets" viewBox="0 0 24 24" fill="none" focusable="false"><rect class="sl-copy__back" x="3.5" y="3.5" width="12" height="14" rx="3"/><rect class="sl-copy__front" x="8.5" y="7.5" width="12" height="14" rx="3"/></svg>\n              <svg class="sl-copy__check" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 12.5 9.2 17.5 20 6.5" pathLength="1"/></svg>\n            </span>\n            <span class="sl-copy__label">Copy</span>\n          </span>\n        </button>\n  <p class="copy-feedback" role="status" aria-live="polite" aria-atomic="true"></p>';const P=`@font-face { font-family: 'Instrument Sans'; src: url('./instrument-sans-variable.woff2') format('woff2'); font-weight: 400 700; font-style: normal; font-display: swap; }
/* Independent button styles. Colors and preview scale are editable tokens. */
.sl-copy {
  --copy-unit: 1px;
  --copy-ink: #222222;
  --copy-hover: #2e2e2e;
  --copy-feedback: #3f3f3f;
  --copy-text: #fafafa;
  --copy-focus: #5a5a5a;
  --copy-ease: cubic-bezier(.22, 1, .36, 1);
  position: relative;
  display: block;
  width: calc(184 * var(--copy-unit));
  height: calc(52 * var(--copy-unit));
  padding: 0;
  border: 0;
  border-radius: calc(13 * var(--copy-unit));
  appearance: none;
  background: transparent;
  color: var(--copy-text);
  font: 550 calc(19 * var(--copy-unit))/1.1 'Instrument Sans', sans-serif;
  letter-spacing: -.02em;
  font-synthesis: none;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.sl-copy *, .sl-copy *::before, .sl-copy *::after { box-sizing: border-box; }
.sl-copy:focus-visible { outline: 2px solid var(--copy-focus); outline-offset: 6px; }
.sl-copy[aria-disabled="true"] { cursor: wait; }
.sl-copy:disabled { cursor: not-allowed; opacity: .5; }
.sl-copy__surface {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  isolation: isolate;
  border-radius: inherit;
  background-color: var(--copy-ink);
  background-image: linear-gradient(155deg, #ffffff06, transparent 68%);
  box-shadow: inset 0 1px #ffffff12, 0 1px 2px #0000000d;
  transition: transform 350ms var(--copy-ease), background-color 350ms ease, box-shadow 350ms ease;
}
@media (hover: hover) {
  .sl-copy:not(:disabled):not([aria-disabled="true"]):hover .sl-copy__surface { transform: translateY(-2px); background-color: var(--copy-hover); box-shadow: inset 0 1px #ffffff17, 0 6px 12px -8px #00000047; }
}
.sl-copy:not(:disabled):not([aria-disabled="true"]):active .sl-copy__surface { transform: translateY(1px) scale(.98); transition-duration: 120ms; }
.sl-copy__wash { position: absolute; inset: 0; z-index: -1; background: var(--copy-feedback); opacity: 0; transition: opacity 650ms cubic-bezier(.4, 0, .2, 1); }
.sl-copy[data-state="copied"] .sl-copy__wash { opacity: 1; }
.sl-copy__label { position: relative; display: block; white-space: nowrap; }
.sl-copy__icon { position: absolute; left: calc(25 * var(--copy-unit)); top: 50%; width: calc(21 * var(--copy-unit)); height: calc(24 * var(--copy-unit)); transform: translateY(-50%); }
.sl-copy__icon svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.sl-copy__sheets { opacity: 1; transition: opacity 240ms ease 240ms; }
.sl-copy__back { transition: transform 460ms var(--copy-ease); }
.sl-copy__front { fill: var(--copy-ink); transition: transform 460ms var(--copy-ease), fill 350ms ease; }
@media (hover: hover) {
  .sl-copy:hover .sl-copy__front { fill: var(--copy-hover); }
}
.sl-copy__check { opacity: 0; transition: opacity 200ms ease; }
.sl-copy__check path { stroke-width: 2.5; stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset 400ms var(--copy-ease); }
.sl-copy[data-state="copied"] .sl-copy__back { transform: translate(2.5px, 2px); }
.sl-copy[data-state="copied"] .sl-copy__front { transform: translate(-2.5px, -2px); fill: var(--copy-feedback); }
.sl-copy[data-state="copied"] .sl-copy__sheets { opacity: 0; transition-delay: 200ms; }
.sl-copy[data-state="copied"] .sl-copy__check { opacity: 1; transition-delay: 440ms; }
.sl-copy[data-state="copied"] .sl-copy__check path { stroke-dashoffset: 0; transition-delay: 440ms; }
.sl-copy[data-state="idle"] .sl-copy__check path { transition-delay: 0ms; }
@media (prefers-reduced-motion: reduce) {
  .sl-copy .sl-copy__surface, .sl-copy:hover .sl-copy__surface, .sl-copy:active .sl-copy__surface { transform: none; }
  .sl-copy *, .sl-copy svg, .sl-copy path, .sl-copy rect { transition: none !important; animation: none !important; }
  .sl-copy:active .sl-copy__surface { opacity: .9; }
}
@media (forced-colors: active) {
  .sl-copy__surface { border: 1px solid ButtonText; background: ButtonFace; color: ButtonText; }
  .sl-copy__wash { display: none; }
  .sl-copy__front { fill: ButtonFace !important; }
  .sl-copy:focus-visible { outline-color: Highlight; }
}

.copy-feedback{margin:0;color:#545454;font-size:12px;line-height:1.5;text-align:center}`;function F(){return(()=>{const r=new WeakMap;function k(e,{getText:s,feedback:d,holdMs:f=1700,writeText:h}={}){if(r.has(e))return r.get(e);if(!e||typeof s!=="function")throw new TypeError("A button and getText callback are required.");const o=e.querySelector(".sl-copy__label");if(!o)throw new TypeError("The button needs a .sl-copy__label element.");const p=matchMedia("(prefers-reduced-motion: reduce)");const b=h||(a=>{if(!navigator.clipboard?.writeText)throw new Error("Clipboard access is unavailable.");return navigator.clipboard.writeText(a)});const n=Number.isFinite(f)?Math.max(800,f):1700;let t=0;let l=0;let i;let x=false;let c=false;let _;let E;let w="Copy";function u(a){if(d)d.textContent=a}function v(){x=false;e.removeAttribute("aria-busy");e.removeAttribute("aria-disabled")}function C(){clearTimeout(_);clearTimeout(E)}function g(){l++;i?.cancel();i=null;o.textContent=w;o.style.removeProperty("opacity")}async function m(a){if(a===w)return;w=a;const y=++l;const q=i?getComputedStyle(o).opacity:1;i?.cancel();if(p.matches||!o.animate){g();return}try{i=o.animate([{opacity:q},{opacity:0}],{duration:240,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});await i.finished;if(y!==l||c)return;o.style.opacity="0";i.cancel();o.textContent=a;i=o.animate([{opacity:0},{opacity:1}],{duration:360,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});await i.finished;if(y!==l||c)return;o.style.removeProperty("opacity");i.cancel();i=null}catch(z){if(z.name!=="AbortError"){if(y===l)g()}}}function M(){if(c)return;t++;C();v();e.dataset.state="idle";m("Copy");u("")}async function S(){if(c||x||e.disabled||e.getAttribute("aria-disabled")==="true")return;const a=++t;C();x=true;e.setAttribute("aria-busy","true");e.setAttribute("aria-disabled","true");u("");_=setTimeout(()=>{if(a===t&&!c){m("Copying");u("Waiting for clipboard permission.")}},700);try{const y=s();if(typeof y!=="string")throw new TypeError("getText must return a string.");await b(y);if(a!==t||c)return;clearTimeout(_);v();e.dataset.state="copied";m("Copied");u("Copied to clipboard.");E=setTimeout(()=>{if(a!==t||c)return;e.dataset.state="idle";m("Copy")},n)}catch{if(a!==t||c)return;clearTimeout(_);v();e.dataset.state="error";m("Try again");u("Clipboard access was blocked. Select the text and copy it manually, or try again.")}}function L(){if(p.matches)g()}e.addEventListener("click",S);p.addEventListener("change",L);e.disabled=false;const A={reset:M,destroy(){if(c)return;c=true;t++;C();w="Copy";g();v();e.dataset.state="idle";e.disabled=true;e.removeEventListener("click",S);p.removeEventListener("change",L);r.delete(e)}};r.set(e,A);return A}return{mount:k}})()}function D(r,k={},{preview:e=false}={}){if(!r||typeof r.attachShadow!=="function")throw new TypeError("A DOM host is required");const s=r.shadowRoot||r.attachShadow({mode:"open"});s.innerHTML=I;const d=r.ownerDocument.createElement("style");const f=new URL("./instrument-sans-variable.woff2",import.meta.url).href;d.textContent=P.replaceAll("./instrument-sans-variable.woff2",f)+':host{display:block;min-width:0;max-width:100%;font-family:"Instrument Sans",sans-serif}[hidden]{display:none!important}';s.prepend(d);const h=s.querySelector(".sl-copy");if(!h){s.replaceChildren();throw new Error("Missing component root")}const o=B(r.ownerDocument,f);let p,b=false;try{const n=F(),t={};if(T==="upload")t.input=s.querySelector('input[type="file"]');if(["like","copy","download","bookmark","playback","delete","upload","share","follow"].includes(T))t.feedback=s.querySelector("."+T+"-feedback");if(e&&typeof n.mountPreview!=="function")throw new Error("This source has no preview adapter; supply its documented application callbacks.");p=(e?n.mountPreview:n.mount)(h,{...t,...k});if(typeof p?.destroy!=="function")throw new Error("Missing source cleanup contract")}catch(n){o();s.replaceChildren();throw n}return new Proxy(p,{get(n,t){if(t==="destroy")return()=>{if(b)return;b=true;try{n.destroy()}finally{o();s.replaceChildren()}};const l=Reflect.get(n,t,n);return typeof l==="function"?l.bind(n):l}})}export{D as mountInto,T as variant};
