"use client";

import { useCallback, useEffect, useRef } from "react";
import Tooltip from "./sl-ui/deposit-tooltip/NextClient";

type Props = { ticket: boolean; amount: string };

/** A source-preserving SL UI tooltip, fitted to the event registration card. */
export function DepositRulesTooltip({ ticket, amount }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const openObserverRef = useRef<MutationObserver | null>(null);
  const copyRef = useRef({ title: "", body: "" });
  copyRef.current = ticket
    ? {
        title: "Ticket rules",
        body: `Your ${amount} ticket is held in a NEAR smart contract. The host can receive it only after the event starts. If the host cancels, or does not close the event within 30 days, you get a refund. The host can also refund you on request. There is no platform fee.`,
      }
    : {
        title: "Deposit rules",
        body: `Your ${amount} deposit is held in a NEAR smart contract. If the host checks you in, you get it back plus an equal share of deposits from people who did not come. You cannot cancel after registering. If the host cancels, or does not close the event within 30 days, you get a refund. There is no platform fee.`,
      };

  const configure = useCallback(() => {
    const component = hostRef.current?.querySelector<HTMLElement>("[data-sl-react]");
    const mount = component?.querySelector<HTMLElement>(":scope > div");
    const root = mount?.shadowRoot?.querySelector<HTMLElement>(".overlay-demo");
    const trigger = root?.querySelector<HTMLButtonElement>("[data-trigger]");
    const panel = root?.querySelector<HTMLElement>("[role='tooltip']");
    const launch = root?.querySelector<HTMLElement>(".overlay-launch");
    const icon = trigger?.querySelector<HTMLElement>(".menu-glyph");
    const label = trigger?.querySelector<HTMLElement>("span");
    const heading = panel?.querySelector<HTMLElement>("strong");
    const body = panel?.querySelector<HTMLElement>("span");
    const feedback = root?.querySelector<HTMLElement>("[data-feedback]");
    if (!root || !trigger || !panel || !launch || !label || !heading || !body) return;

    root.style.minHeight = "0";
    root.style.display = "block";
    root.style.width = "240px";
    root.style.overflow = "visible";
    launch.style.width = "100%";
    launch.style.textAlign = "left";
    trigger.style.justifyContent = "flex-start";
    trigger.style.gap = "5px";
    trigger.style.width = "auto";
    trigger.style.minHeight = "0";
    trigger.style.padding = "0";
    trigger.style.border = "0";
    trigger.style.borderRadius = "0";
    trigger.style.background = "transparent";
    trigger.style.boxShadow = "none";
    trigger.style.color = "var(--accent, #8b7fff)";
    trigger.style.fontSize = "12px";
    if (icon) {
      icon.style.width = "16px";
      icon.style.height = "16px";
    }
    panel.style.width = "min(256px, calc(100vw - 64px))";
    panel.style.padding = "14px 16px";
    panel.style.lineHeight = "1.5";
    label.textContent = "How the deposit works";
    heading.textContent = copyRef.current.title;
    body.textContent = copyRef.current.body;
    if (feedback) feedback.hidden = true;

    if (!openObserverRef.current) {
      const updateOpenState = () => {
        const open = root.dataset.open === "true";
        const height = open
          ? Math.ceil(panel.getBoundingClientRect().height + trigger.getBoundingClientRect().height + 32)
          : 0;
        root.style.minHeight = `${height}px`;
        if (open) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const overflow = panel.getBoundingClientRect().bottom - (window.innerHeight - 16);
            if (overflow > 0) window.scrollBy({ top: overflow, behavior: "smooth" });
          }));
        }
      };
      const observer = new MutationObserver(updateOpenState);
      observer.observe(root, { attributes: true, attributeFilter: ["data-open"] });
      openObserverRef.current = observer;
      updateOpenState();
    }
  }, []);

  useEffect(() => {
    configure();
    return () => {
      openObserverRef.current?.disconnect();
      openObserverRef.current = null;
    };
  }, [amount, configure, ticket]);

  return (
    <div ref={hostRef} className="inline-block align-middle">
      <Tooltip
        className="!inline-block !w-[15rem] !max-w-[15rem] align-baseline"
        onReady={configure}
      />
    </div>
  );
}
