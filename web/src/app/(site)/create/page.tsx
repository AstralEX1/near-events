"use client";

import { SlAmount, SlCopy } from "@/components/SlUi";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bondPerSeatText, events, formatNear, formatUsdc, FREE_MAX_CAPACITY, FREE_MAX_DAYS, FREE_MAX_EVENTS, hoursText, hostBondFor, MAX_CAPACITY, needsBond, toUnits, type EventMode, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Cover } from "@/components/ui";
import { EventThemePicker } from "@/components/EventThemePicker";
import { EventPageBackground, EventPoster } from "@/components/EventVisual";
import { createRandomEventVisual, createRandomVisual, type EventVisualConfig } from "@/lib/event-visuals";
import { rememberEventVisual } from "@/lib/event-visual-client";
import { SignInOptions } from "@/components/SignIn";
import { LOCAL_TZ, city, dayLabel, fromEpoch, gmtLabel, toEpoch } from "@/lib/time";
import { detectEventSource, IMPORT_ENDPOINT, locationProblem, type EventDetails, type ImportedEvent } from "@/lib/eventImport";
import { MODE_HINTS, createStep, integrationUrl, parseMode, startUrl, validAmount, type JoinMode } from "@/lib/flow";
import { MAX_FREE_CAPACITY } from "@/lib/freeEventsShared";
import { ApprovalToggle } from "@/components/ApprovalToggle";
import { cohosts as cohostsApi } from "@/lib/cohostsClient";
import { cohostsProblem, splitCohosts } from "@/lib/cohostsShared";
import { StartStep } from "@/components/StartStep";
import { buildRule, rulePastEvents, ruleProblem, type AccessChoice } from "@/lib/access";


const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

interface When {
  start: number;
  end: number;
  tz: string;
}

export default function CreatePage() {
  return (
    <Suspense>
      <CreateRoute />
    </Suspense>
  );
}

/** /create starts with how guests pay, then opens the detailed form. flow=widget is the Integrate flow. */
function CreateRoute() {
  const params = useSearchParams();
  const step = createStep(params);
  if (step === "form") return <CreateEvent />;
  return <StartStep widget={step === "start-widget"} initial={{ mode: params.get("mode"), amount: params.get("amount"), link: params.get("import") }} />;
}

/** Create an event with its public details and escrow options. */
function CreateEvent() {
  const { accountId, kind, send, staffToken } = useWallet();
  // Host's own cover photo as a JPEG data URL; uploaded after the event is created.
  const [photo, setPhoto] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const integrate = params.get("flow") === "widget";
  // A link from the start step: Integrate, or a free event brought over from Luma/BaliSquad.
  const importOnArrival = params.get("import");
  const [form, setForm] = useState({
    title: "",
    location: "",
    description: "",
    cover_url: "",
    deposit: params.get("amount") ?? "10",
    capacity: "50",
    cohosts: "",
    mode: parseMode(params.get("mode")) ?? ("Deposit" as JoinMode),
  });
  // Site-only: private events are reachable by link but left out of public listings.
  const [isPublic, setIsPublic] = useState(true);
  // Free events only: guests request a spot and the host approves each one.
  const [approval, setApproval] = useState(false);
  // Who may register (escrow access rule): judged by the host's own finalized events.
  const [accessChoice, setAccessChoice] = useState<AccessChoice>("everyone");
  const [minVisits, setMinVisits] = useState("1");
  const [skipNoShows, setSkipNoShows] = useState(false);
  const [regularsHours, setRegularsHours] = useState("24"); // the default event (tomorrow) ends after 24 hours
  const [pastEvents, setPastEvents] = useState<number[]>([]);
  const [when, setWhen] = useState<When | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(Boolean(importOnArrival));
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EventView | null>(null);
  const [createdDetails, setCreatedDetails] = useState<EventDetails | null>(null);
  const [createdCohosts, setCreatedCohosts] = useState<string[]>([]);
  const [eventVisual, setEventVisual] = useState<EventVisualConfig>({ themeId: "studio", seed: 0 });
  const [createdVisual, setCreatedVisual] = useState<EventVisualConfig | null>(null);
  const [detailsSaveError, setDetailsSaveError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [visualSaveError, setVisualSaveError] = useState<string | null>(null);
  const [savingVisual, setSavingVisual] = useState(false);
  const [savesDone, setSavesDone] = useState(false);
  // Like Luma, the form is open to everyone; signing in is asked for on "Create Event".
  const [askSignIn, setAskSignIn] = useState(false);
  // Integrate flow: after Import only a short summary is shown; "Edit details" opens the full form.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (accountId) setAskSignIn(false);
  }, [accountId]);

  // "Duplicate event" (Luma, Hi.Events): /create?from=<id> copies everything but the date.
  useEffect(() => {
    const from = Number(new URLSearchParams(window.location.search).get("from"));
    if (!Number.isInteger(from) || !window.location.search.includes("from=")) return;
    events.get(from).then((e) => {
      if (!e) return;
      setForm((f) => ({
        ...f,
        title: e.metadata.title,
        deposit: String(Number(e.deposit) / 1e6),
        mode: e.mode ?? "Deposit",
        capacity: String(e.capacity),
      }));
      cohostsApi.get(from).then((list) => setForm((f) => ({ ...f, cohosts: list.join(", ") }))).catch(() => {});
      fetch(`/api/event-details?e=${encodeURIComponent(String(from))}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((json) => {
          const details = json?.details as EventDetails | null | undefined;
          if (!details) return;
          const { public: listed, ...rest } = details;
          setForm((f) => ({ ...f, ...rest, cover_url: rest.cover_url ?? "" }));
          setIsPublic(listed !== false);
        })
        .catch(() => {});
      fetch(`/api/event-visuals?ids=${encodeURIComponent(String(from))}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((json) => {
          const visual = json?.visuals?.[String(from)] as EventVisualConfig | undefined;
          if (visual) setEventVisual(visual);
        })
        .catch(() => {});
    });
  }, []);

  // Start with a varied preview; a duplicated event can replace this with its saved look.
  useEffect(() => setEventVisual(createRandomEventVisual()), []);

  // Default to tomorrow, on the hour, for two hours (set on the client, not during prerender).
  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setMinutes(0, 0, 0);
    setWhen((w) => w ?? { start: start.getTime(), end: start.getTime() + 2 * 3600_000, tz: LOCAL_TZ });
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const importEvent = async (link: string, onArrival = false) => {
    setImporting(true);
    setError(null);
    try {
      const source = detectEventSource(link) ?? "Luma";
      const r = await fetch(`${IMPORT_ENDPOINT[source]}?url=${encodeURIComponent(link)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      const event = j as ImportedEvent;
      setForm((f) => ({ ...f, title: event.title, location: event.location, description: event.description, cover_url: event.cover_url ?? "" }));
      if (source === "BaliSquad") setEventVisual(createRandomVisual("paradise"));
      setWhen((w) => ({ tz: w?.tz ?? LOCAL_TZ, start: event.starts_at, end: event.ends_at }));
      setImported(source);
      setImportOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (onArrival) setArrivalError(message);
      else setError(message);
    } finally {
      setImporting(false);
    }
  };

  // The link came from the start step, so import it right away, once.
  const arrivalImportStarted = useRef(false);
  useEffect(() => {
    if (!importOnArrival || arrivalImportStarted.current) return;
    arrivalImportStarted.current = true;
    void importEvent(importOnArrival, true);
  }, [importOnArrival]);

  // Integrate flow ends in the event's Integration tab, once its details are saved
  // (and, with a court, after the success screen has said that the bond comes first).
  const saved = Boolean(created) && savesDone && !savingDetails && !savingVisual && !detailsSaveError && !visualSaveError;
  useEffect(() => {
    if (integrate && saved && created && !needsBond(created)) router.replace(integrationUrl(created.id));
  }, [integrate, saved, created, router]);
  // The owner's rules for new events: whether a court and a host bond apply (null until read, or on an older escrow).
  const [rules, setRules] = useState<EventView["rules"] | null>(null);
  useEffect(() => {
    events.config().then((c) => setRules(c.rules ?? null)).catch(() => {});
  }, []);

  const free = form.mode === "Free";
  const maxSeats = free ? MAX_FREE_CAPACITY : MAX_CAPACITY;
  const amountOk = free || validAmount(form.deposit);
  const seats = Number(form.capacity);
  const seatsOk = Number.isInteger(seats) && seats >= 1 && seats <= maxSeats;
  const doorTeamProblem = free ? null : cohostsProblem(form.cohosts);
  const accessRule = (now: number) => free ? null : buildRule(accessChoice, {
    pastEvents, minAttended: Number(minVisits), skipNoShows, openToAllAt: now + Number(regularsHours) * 3_600_000,
  });
  const accessProblem = when
    ? ruleProblem(accessRule(Date.now()), form.mode === "Deposit" && (rules?.close_at_start ?? true) ? when.start : when.end)
    : null;
  // Past events can only be added as Free: a deposit or ticket for something already over makes no sense.
  // Deposit events stop taking guests (and the host bond) at the start, so the start must be ahead.
  const lateStart = form.mode === "Deposit" && (rules?.close_at_start ?? true) && !!when && when.end >= Date.now() && when.start < Date.now() + 5 * 60_000
    ? "Deposit events close registration at the start. Pick a start time in the future." : null;
  const missing = !free && when && when.end < Date.now() ? "Pick Free to add a past event" : lateStart ? lateStart : !amountOk ? "Set the amount: at least 0.1 USDC" : !seatsOk ? `Set the capacity: 1 to ${maxSeats}` : doorTeamProblem ?? accessProblem ?? undefined;
  // yoctoNEAR the host pays for storage beyond the free tier; "0" when free.
  const [storageCost, setStorageCost] = useState("0");
  const endsAt = when?.end;
  useEffect(() => {
    if (free || !accountId || !seatsOk) return setStorageCost("0");
    let live = true;
    const timer = setTimeout(() => {
      events.createCost(accountId, seats, endsAt).then((c) => live && setStorageCost(c)).catch(() => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [free, accountId, seats, seatsOk, endsAt]);
  useEffect(() => {
    if (!accountId) return setPastEvents([]);
    let live = true;
    events.all().then((all) => live && setPastEvents(rulePastEvents(all, accountId))).catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId]);
  const costNote = storageCost !== "0" && (
    <p className="text-sm text-muted">
      {kind === "evm" ? "EVM wallets can create free-tier events only." : `Created at your expense: ~${formatNear(storageCost)} NEAR (storage).`} Free events are up to {FREE_MAX_CAPACITY} seats, {FREE_MAX_EVENTS} per 30 days, ending within {FREE_MAX_DAYS} days.
    </p>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when || missing) return;
    const badLocation = locationProblem(form.location);
    if (badLocation) return setError(badLocation);
    if (!accountId) return setAskSignIn(true);
    if (when.end <= when.start) return setError("The event has to end after it starts.");
    setBusy(true);
    setError(null);
    let transactionSent = false;
    try {
      const capacity = Number(form.capacity);
      const title = form.title.trim();
      const encoder = new TextEncoder();
      if (encoder.encode(title).length > 120) {
        throw new Error("Title is too long. Shorten it and try again.");
      }
      const location = form.location.trim();
      const description = form.description.trim();
      // Only an imported event fills cover_url; a bad link is dropped, the theme cover shows instead.
      const coverUrl = safeImageUrl(form.cover_url.trim());
      if (encoder.encode(description).length > 10_000) throw new Error("Event details are too long. Shorten them and try again.");
      if (free) {
        // No chain: save on our server and open the event page.
        const token = await staffToken();
        const cover = photo ? await uploadCover(photo, token) : coverUrl;
        const response = await fetch("/api/free-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "create", event: { title, starts_at: when.start, ends_at: when.end, capacity, location, description, cover_url: cover, visual: eventVisual, public: isPublic, approval } }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || typeof json.id !== "string") throw new Error(json.error ?? "Could not create the event");
        router.push(`/f/${json.id}`);
        return;
      }
      if (!(await events.canCreate(accountId))) {
        throw new Error("Deposit and ticket events are open to verified hosts only. Contact Nearvent to get verified, or pick Free.");
      }
      // Checked again right before signing: the host may have used a free event meanwhile.
      const deposit = BigInt(await events.createCost(accountId, capacity, when.end));
      const submittedAt = Date.now();
      // Theme, image, font and random-seed choices are presentation data; save them off-chain below.
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              starts_at: when.start,
              ends_at: when.end,
            },
            deposit: toUnits(form.deposit),
            capacity,
            mode: form.mode as EventMode,
            access: accessRule(Date.now()),
          },
          deposit,
        },
      ]);
      transactionSent = true;
      const matches = (ev: EventView) => ev.host === accountId
        && ev.metadata.title === title
        && ev.metadata.starts_at === when.start
        && ev.metadata.ends_at === when.end
        && ev.created_at >= submittedAt - 60_000;
      let latest: EventView | undefined;
      for (let attempt = 0; attempt < 4 && !latest; attempt++) {
        latest = (await events.list().catch(() => [])).find(matches);
        if (!latest && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!latest) {
        setError("The event may already be created, but its page could not be loaded. Refresh before trying again.");
        return;
      }
      setCreated(latest);
      setCreatedVisual(eventVisual);
      const details: EventDetails = { location, description, cover_url: coverUrl };
      if (photo) details.cover_url = photo;
      if (!isPublic) details.public = false;
      // The door team lives on our server too (api/cohosts), saved with the details.
      const doorTeam = splitCohosts(form.cohosts).filter((a) => a !== accountId);
      setCreatedCohosts(doorTeam);
      const hasDetails = Boolean(location || description || details.cover_url || doorTeam.length || !isPublic);
      if (hasDetails) setCreatedDetails(details);
      let token: string | null = null;
      try {
        token = await staffToken();
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : "Could not authorize off-chain event settings";
        setVisualSaveError(message);
        if (hasDetails) setDetailsSaveError(message);
      }

      setSavingVisual(true);
      if (token) {
        try {
          await saveVisual(latest.id, eventVisual, token);
          rememberEventVisual(latest.id, eventVisual);
          setVisualSaveError(null);
        } catch (saveError) {
          setVisualSaveError(saveError instanceof Error ? saveError.message : "Could not save event visual");
        } finally {
          setSavingVisual(false);
        }
      } else {
        setSavingVisual(false);
      }

      if (hasDetails && token) {
        setCreatedDetails(details);
        setSavingDetails(true);
        try {
          await saveDetails(latest.id, details, doorTeam, token);
          setDetailsSaveError(null);
        } catch (saveError) {
          setDetailsSaveError(saveError instanceof Error ? saveError.message : "Could not save event details");
        } finally {
          setSavingDetails(false);
        }
      }
      setSavesDone(true);
    } catch (err) {
      setError(transactionSent
        ? "The event may already be created. Refresh before trying again to avoid creating a duplicate."
        : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const retryDetailsSave = async () => {
    if (!created || !createdDetails) return;
    setSavingDetails(true);
    try {
      const token = await staffToken();
      await saveDetails(created.id, createdDetails, createdCohosts, token);
      setDetailsSaveError(null);
    } catch (saveError) {
      setDetailsSaveError(saveError instanceof Error ? saveError.message : "Could not save event details");
    } finally {
      setSavingDetails(false);
    }
  };

  const retryVisualSave = async () => {
    if (!created || !createdVisual) return;
    setSavingVisual(true);
    try {
      const token = await staffToken();
      await saveVisual(created.id, createdVisual, token);
      rememberEventVisual(created.id, createdVisual);
      setVisualSaveError(null);
    } catch (saveError) {
      setVisualSaveError(saveError instanceof Error ? saveError.message : "Could not save event visual");
    } finally {
      setSavingVisual(false);
    }
  };

  if (arrivalError) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <p className="text-sm text-warn break-words">{arrivalError}</p>
        <Link href={startUrl({ mode: form.mode, amount: form.deposit, link: importOnArrival ?? undefined }, true)} className="btn btn-ghost inline-flex">
          Back
        </Link>
      </div>
    );
  }
  if (importOnArrival && !imported && importing) return <p className="max-w-2xl mx-auto text-sm text-muted" role="status">Importing…</p>;
  if (created && integrate && !needsBond(created) && !detailsSaveError && !visualSaveError) return <p className="max-w-2xl mx-auto text-sm text-muted" role="status">Opening integration…</p>;
  if (created) return <Created event={created} visual={createdVisual} coverUrl={createdDetails?.cover_url} detailsSaveError={detailsSaveError} savingDetails={savingDetails} onRetry={retryDetailsSave} visualSaveError={visualSaveError} savingVisual={savingVisual} onRetryVisual={retryVisualSave} />;

  const summaryReady = integrate && !!imported && !editing && !missing && !!when && when.end > when.start && !!form.title.trim() && !locationProblem(form.location);
  if (summaryReady && when) {
    return (
      <>
        <EventPageBackground visual={eventVisual} />
        <ImportSummary
          form={form}
          when={when}
          visual={eventVisual}
          imported={imported}
          busy={busy}
          error={error}
          note={costNote}
          onSubmit={submit}
          onEdit={() => setEditing(true)}
          visibility={<PublicChip isPublic={isPublic} onToggle={() => setIsPublic(!isPublic)} />}
          backHref={startUrl({ mode: form.mode, amount: form.deposit, link: importOnArrival ?? undefined }, true)}
        />
        {askSignIn && <SignInDialog onClose={() => setAskSignIn(false)} />}
      </>
    );
  }

  return (
    <>
      <EventPageBackground visual={eventVisual} />
      <form onSubmit={submit} className="max-w-[920px] mx-auto pb-40 grid grid-cols-1 gap-6 md:gap-8 md:grid-cols-[300px_minmax(0,1fr)] items-start">
        <div className="relative min-w-0 z-20 md:sticky md:top-20">
          <EventThemePicker value={eventVisual} title={form.title} coverUrl={safeImageUrl(form.cover_url)} photo={photo} onPhoto={setPhoto} onChange={setEventVisual} />
        </div>
        <div className="gc-create-form min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="lu-chip">
              {accountId ? <span className="truncate max-w-44">{accountId}</span> : "Your events"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className="lu-chip lu-hover" onClick={() => setImportOpen(!importOpen)}>
                {imported ? `✓ Imported from ${imported}` : "Import event"}
              </button>
              <PublicChip isPublic={isPublic} onToggle={() => setIsPublic(!isPublic)} />
            </div>
          </div>
          {importOpen && (
            <div className="lu-field p-2 flex gap-2">
              <input
                autoFocus
                className="flex-1 min-w-0 bg-transparent px-2 outline-none text-sm"
                placeholder="Paste a Luma or BaliSquad event link"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <button type="button" className="btn btn-primary !py-1.5 text-sm" disabled={!importUrl.trim() || importing} onClick={() => importEvent(importUrl)}>
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          )}

          <textarea
            required
            maxLength={120}
            rows={1}
            value={form.title}
            onChange={(e) => set("title")(e.target.value)}
            placeholder="Event Name"
            aria-label="Event name"
            className="w-full resize-none bg-transparent text-[40px] leading-[1.15] font-semibold tracking-tight outline-none placeholder:text-muted/75 [field-sizing:content]"
          />

          {when && <WhenBlock when={when} onChange={setWhen} />}

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="label">Location (optional)</span>
              <input
                className="lu-field w-full px-3 py-2 text-sm"
                inputMode="url"
                autoComplete="off"
                value={form.location}
                onChange={(e) => {
                  setError(null);
                  set("location")(e.target.value);
                }}
                placeholder="Google Maps link"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Event details (optional)</span>
              <textarea
                className="lu-field w-full px-3 py-2 text-sm min-h-28 resize-y"
                maxLength={10_000}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder="Description, host contacts, and useful links"
              />
            </label>
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium text-muted">Event Options</div>
            <div className="rounded-xl overflow-hidden flex flex-col lu-rows">
              {/* One or the other, never both: a deposit pool or a paid ticket. */}
              <div className="lu-row">
                <Icon d="M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2M4 12a8 8 0 1016 0 8 8 0 00-16 0z" className="text-muted" />
                <span className="flex-1">Guests pay</span>
                <div className="flex gap-1 rounded-full p-0.5" style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }} role="radiogroup" aria-label="Guests pay">
                  {(integrate ? ["Deposit", "Ticket"] as const : ["Deposit", "Ticket", "Free"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={form.mode === m}
                      onClick={() => setForm((f) => ({ ...f, mode: m }))}
                      data-tooltip={MODE_HINTS[m]}
                      className={`px-3 py-1 rounded-full text-sm ${form.mode === m ? "bg-accent text-white" : "text-muted"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {!free && <OptionRow
                icon="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4zM14 6v12"
                label={form.mode === "Ticket" ? "Ticket price" : "Deposit"}
                value={`${form.deposit} USDC`}
                attention={!amountOk}
                title={form.mode === "Ticket" ? "Ticket price" : "Deposit"}
                help={
                  form.mode === "Ticket"
                    ? "Each guest pays this for a ticket. It goes to your balance as soon as they register. Tickets are not refunded if you cancel."
                    : depositHint(rules ?? null, amountOk && seatsOk ? BigInt(toUnits(form.deposit)) * BigInt(seats) : null)
                }
              >
                <SlAmount value={form.deposit} onChange={set("deposit")} label={form.mode === "Ticket" ? "Ticket price" : "Deposit"} />
              </OptionRow>}
              <OptionRow
                icon="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8"
                label="Capacity"
                value={form.capacity}
                attention={!seatsOk}
                title="Max capacity"
                help={free ? `Up to ${maxSeats} guests. Registration closes when it's full.` : `Up to ${MAX_CAPACITY} guests. Free up to ${FREE_MAX_CAPACITY} seats and ${FREE_MAX_EVENTS} events per 30 days; bigger events pay a little NEAR for storage. Registration closes when it's full.`}
              >
                <input className="input" type="number" min="1" max={maxSeats} required value={form.capacity} onChange={(e) => set("capacity")(e.target.value)} />
              </OptionRow>
              {free && <ApprovalToggle checked={approval} onChange={setApproval} />}
              {/* Door check-in is for paid events; free events only keep an RSVP list. */}
              {!free && <OptionRow
                icon="M9 11l2 2 4-4M4 4h16v16H4z"
                label="Door team"
                value={splitCohosts(form.cohosts).length ? `${splitCohosts(form.cohosts).length} people` : "Just you"}
                title="Door team"
                attention={!!doorTeamProblem}
                help="NEAR accounts or 0x addresses that can check guests in, separated by commas. You can change this later in Manage."
              >
                <input className="input" value={form.cohosts} onChange={(e) => set("cohosts")(e.target.value)} placeholder="alice.near, bob.near" />
              </OptionRow>}
              {!free && <AccessOption
                choice={accessChoice} onChoice={setAccessChoice}
                pastCount={pastEvents.length}
                minVisits={minVisits} onMinVisits={setMinVisits}
                skipNoShows={skipNoShows} onSkipNoShows={setSkipNoShows}
                hours={regularsHours} onHours={setRegularsHours}
                problem={accessProblem}
              />}
            </div>
          </div>

          {costNote}
          {lateStart && <p className="text-sm text-muted">{lateStart}</p>}
          {when && when.end < Date.now() && (
            <p className="text-sm text-muted">
              {free ? "This date is in the past. The event goes to Past, and guests can add themselves as attended." : "Paid events need a future date. Pick Free to add a past event."}
            </p>
          )}
          {error && <p className="text-sm text-warn break-words">{error}</p>}
          <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy || !!missing} data-tooltip={missing}>
            {busy && <span className="gc-spinner" aria-hidden="true" />}
            {busy ? (free ? "Creating…" : "Confirm in your wallet…") : integrate ? "Integrate" : "Create Event"}
          </button>
        </div>
      </form>
      {askSignIn && <SignInDialog onClose={() => setAskSignIn(false)} />}
    </>
  );
}

/** Integrate flow, right after Import: what will be created, one button, and a way to edit details first. */
/** Public events show in Events; private ones only by link. Stored off-chain as `public`. */
function PublicChip({ isPublic, onToggle }: { isPublic: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="lu-chip lu-hover" aria-pressed={!isPublic} data-tooltip={isPublic ? "Shown in Events. Click to make it link-only." : "Only people with the link see it. Click to list it in Events."} onClick={onToggle}>
      <Icon d={isPublic ? "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" : "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3"} size={14} />
      {isPublic ? "Public" : "Private"}
    </button>
  );
}

function ImportSummary({ form, when, visual, imported, busy, error, note, onSubmit, onEdit, backHref, visibility }: {
  form: { title: string; location: string; cover_url: string; deposit: string; capacity: string; mode: JoinMode };
  when: When;
  visual: EventVisualConfig;
  imported: string;
  busy: boolean;
  error: string | null;
  note?: ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  onEdit: () => void;
  backHref: string;
  visibility: ReactNode;
}) {
  const start = fromEpoch(when.start, when.tz);
  return (
    <form onSubmit={onSubmit} className="gc-create-form max-w-xl mx-auto space-y-5">
      <div className="flex gap-4 items-center">
        {/* Thumbnail only: the theme label and title would be unreadable at this size. */}
        <EventPoster title={form.title} visual={visual} coverUrl={safeImageUrl(form.cover_url)} className="w-24 h-24 rounded-xl shrink-0 [&>div.relative]:hidden [&>span]:hidden" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-good font-medium">✓ Imported from {imported}</span>{visibility}</div>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{form.title}</h1>
        </div>
      </div>
      <dl className="lu-field divide-y divide-border text-sm">
        <SummaryRow label="When">
          {dayLabel(start.date)}, {start.time} {gmtLabel(when.tz, when.start)}
        </SummaryRow>
        {form.location.trim() && <SummaryRow label="Where">Google Maps</SummaryRow>}
        <SummaryRow label={form.mode === "Ticket" ? "Ticket" : "Deposit"}>
          {form.deposit} USDC · {form.capacity} seats
        </SummaryRow>
      </dl>
      {note}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy}>
        {busy ? "Confirm in your wallet…" : "Integrate"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <Link href={backHref} className="text-muted hover:text-text">
          Back
        </Link>
        <button type="button" className="text-muted hover:text-text underline underline-offset-4" onClick={onEdit}>
          Edit details
        </button>
      </div>
    </form>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Shown when a guest presses "Create Event": the form stays filled in behind it. */
function SignInDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Sign in" className="w-full max-w-[360px] rounded-2xl bg-surface text-text border border-border shadow-2xl p-5 space-y-4">
        <div className="space-y-1">
          <div className="w-11 h-11 !rounded-full lu-field flex items-center justify-center mb-3">
            <Icon d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5" size={18} />
          </div>
          <div className="text-lg font-semibold">Sign in to create</div>
          <p className="text-sm text-muted">Your event stays filled in. A NEAR wallet, Google/email or an EVM wallet all work.</p>
        </div>
        <SignInOptions />
        <p className="text-[11px] text-muted/80">Free up to {FREE_MAX_CAPACITY} seats and {FREE_MAX_EVENTS} events per 30 days.</p>
      </div>
    </div>
  );
}

function Icon({ d, size = 16, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Closes when you click outside it or press Escape. */
function Popover({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`absolute z-40 mt-1 rounded-xl border border-border bg-surface text-text shadow-xl ${className}`}>
      {children}
    </div>
  );
}

/** Start/End with a little timeline on the left and the time zone box on the right. */
function WhenBlock({ when, onChange }: { when: When; onChange: (w: When) => void }) {
  const s = fromEpoch(when.start, when.tz);
  const e = fromEpoch(when.end, when.tz);
  // Moving the start keeps the length of the event, like Luma.
  const setStart = (date: string, time: string) => {
    const start = toEpoch(date, time, when.tz);
    onChange({ ...when, start, end: start + (when.end - when.start) });
  };
  const setEnd = (date: string, time: string) => onChange({ ...when, end: toEpoch(date, time, when.tz) });
  // Changing the zone keeps the wall-clock times the host typed.
  const setTz = (tz: string) => onChange({ tz, start: toEpoch(s.date, s.time, tz), end: toEpoch(e.date, e.time, tz) });

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="lu-field relative flex-1 py-1.5 pl-3 pr-1.5">
        <span aria-hidden className="absolute left-[17px] top-[26px] bottom-[26px] border-l border-dashed border-muted/50" />
        <DTRow label="Start" dot="fill" date={s.date} time={s.time} onChange={setStart} />
        <DTRow label="End" dot="ring" date={e.date} time={e.time} onChange={setEnd} invalid={when.end <= when.start} />
      </div>
      <TzBox tz={when.tz} at={when.start} onChange={setTz} />
    </div>
  );
}

function DTRow({ label, dot, date, time, onChange, invalid }: { label: string; dot: "fill" | "ring"; date: string; time: string; onChange: (d: string, t: string) => void; invalid?: boolean }) {
  const dateRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <span className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 ${dot === "fill" ? "bg-muted" : "border border-muted bg-[var(--bg)]"}`} />
      <span className="flex-1 text-muted">{label}</span>
      <div className={`flex ml-auto rounded-lg gap-px ${invalid ? "ring-1 ring-warn" : ""}`}>
        <label className="lu-pill rounded-l-lg relative cursor-pointer w-[124px]">
          {dayLabel(date)}
          <input
            ref={dateRef}
            type="date"
            aria-label={`${label} date`}
            value={date}
            onChange={(ev) => ev.target.value && onChange(ev.target.value, time)}
            onClick={() => dateRef.current?.showPicker?.()}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <div className="relative">
          <button type="button" aria-label={`${label} time`} className="lu-pill rounded-r-lg w-[72px] tabular-nums" onClick={() => setSlots(!slots)}>
            {time}
          </button>
          {slots && (
            <Popover onClose={() => setSlots(false)} className="right-0 w-28 max-h-64 overflow-y-auto p-1">
              <input
                type="time"
                aria-label={`${label} exact time`}
                defaultValue={time}
                onChange={(ev) => ev.target.value && onChange(date, ev.target.value)}
                className="w-full px-2 py-1 mb-1 rounded-md bg-transparent border border-border text-sm"
              />
              {SLOTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  ref={(el) => {
                    if (el && t === time && el.parentElement) el.parentElement.scrollTop = el.offsetTop - 96;
                  }}
                  onClick={() => {
                    onChange(date, t);
                    setSlots(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 rounded-md text-sm tabular-nums hover:bg-border/60 ${t === time ? "bg-border/60 font-medium" : ""}`}
                >
                  {t}
                </button>
              ))}
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}

function TzBox({ tz, at, onChange }: { tz: string; at: number; onChange: (tz: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [LOCAL_TZ, "UTC"];
    }
  }, []);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((z) => !n || z.toLowerCase().replace(/_/g, " ").includes(n) || gmtLabel(z, at).toLowerCase().includes(n)).slice(0, 60);
  }, [all, q, at]);
  return (
    <div className="relative sm:w-[140px]">
      <button type="button" onClick={() => setOpen(!open)} className="lu-field lu-hover w-full h-full p-3 text-left flex sm:flex-col sm:justify-between gap-2" aria-label="Time zone">
        <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" className="text-muted" />
        <span>
          <span className="block text-sm font-medium">{gmtLabel(tz, at)}</span>
          <span className="block text-xs text-muted truncate">{city(tz)}</span>
        </span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="right-0 w-72 p-1">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a time zone" className="w-full px-3 py-2 mb-1 bg-transparent outline-none border-b border-border focus:border-accent text-sm" />
          <div className="max-h-64 overflow-y-auto">
            {list.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => {
                  onChange(z);
                  setOpen(false);
                }}
                className={`flex w-full gap-3 px-3 py-1.5 rounded-md text-sm text-left hover:bg-border/60 ${z === tz ? "font-medium bg-border/60" : ""}`}
              >
                <span className="text-muted tabular-nums w-20 shrink-0">{gmtLabel(z, at)}</span>
                <span className="truncate">{z.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

const ACCESS_LABELS: Record<AccessChoice, string> = {
  everyone: "Everyone",
  "regulars-first": "Regulars first",
  "regulars-only": "Regulars only",
};

/** Who can register: everyone, or regulars of the host's own finalized events (first for a while, or only). */
function AccessOption({ choice, onChoice, pastCount, minVisits, onMinVisits, skipNoShows, onSkipNoShows, hours, onHours, problem }: {
  choice: AccessChoice;
  onChoice: (c: AccessChoice) => void;
  pastCount: number;
  minVisits: string;
  onMinVisits: (v: string) => void;
  skipNoShows: boolean;
  onSkipNoShows: (v: boolean) => void;
  hours: string;
  onHours: (v: string) => void;
  problem: string | null;
}) {
  return (
    <OptionRow
      icon="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 0112 0v1M19 8v6M16 11h6"
      label="Who can register"
      value={ACCESS_LABELS[choice]}
      attention={!!problem}
      title="Who can register"
      help={pastCount === 0
        ? "Regulars are people who came to your earlier events. This opens after one of your events is finalized."
        : `Regulars are people who came to your last ${pastCount} finalized event${pastCount === 1 ? "" : "s"}. The escrow checks it and refunds anyone else.`}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Who can register">
          {(Object.keys(ACCESS_LABELS) as AccessChoice[]).map((c) => (
            <label key={c} className={`flex items-center gap-2 text-sm ${c !== "everyone" && pastCount === 0 ? "opacity-50" : ""}`}>
              <input type="radio" name="access" checked={choice === c} disabled={c !== "everyone" && pastCount === 0} onChange={() => onChoice(c)} />
              {ACCESS_LABELS[c]}
            </label>
          ))}
        </div>
        {choice !== "everyone" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Came to at least
              <input className="input w-16" type="number" min={1} max={pastCount} value={minVisits} onChange={(e) => onMinVisits(e.target.value)} />
              of your last {pastCount}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipNoShows} onChange={(e) => onSkipNoShows(e.target.checked)} />
              Keep out people who registered and didn’t come
            </label>
            {choice === "regulars-first" && (
              <label className="flex items-center gap-2 text-sm">
                Open to everyone after
                <select className="input w-24" value={hours} onChange={(e) => onHours(e.target.value)}>
                  {["24", "48", "72"].map((h) => <option key={h} value={h}>{h} hours</option>)}
                </select>
              </label>
            )}
            {problem && <p className="text-sm text-warn">{problem}</p>}
          </>
        )}
      </div>
    </OptionRow>
  );
}

function OptionRow({ icon, label, value, title, help, attention, children }: { icon: string; label: string; value: string; title: string; help: string; attention?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lu-row lu-hover text-left" onClick={() => setOpen(true)}>
        <Icon d={icon} className="text-muted" />
        <span className="flex-1">{label}</span>
        <span className={`font-medium ${attention ? "text-warn" : "text-muted"}`}>{value}</span>
        <Icon d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={14} className="text-muted" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface text-text border border-border shadow-2xl p-5 space-y-3" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setOpen(false))}>
            <div className="text-lg font-semibold">{title}</div>
            <p className="text-sm text-muted">{help}</p>
            {children}
            <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The Deposit help text under the amount; `pool` is deposit × seats in USDC units. */
function depositHint(rules: EventView["rules"] | null, pool: bigint | null): string {
  const base = "Each guest puts this down. People who come get it back plus a share of the no-shows.";
  if (!rules) return base;
  if (!rules.dao) return `${base} Your list of who came is final. Registration closes when the event ${rules.close_at_start ? "starts" : "ends"}.`;
  const bond = pool === null ? "deposit × seats" : `${formatUsdc(pool * BigInt(rules.bond_per_seat))} USDC`;
  return `${base} Before registration opens, you lock a bond of ${bondPerSeatText({ rules })} (${bond}). You get it back after the event unless the council upholds a dispute or you publish no list within ${hoursText(rules.submit_hours)}. Registration closes when the event starts.`;
}

/** After creating: share the event page, quick checkout, or simple site button. */
function Created({ event, visual, coverUrl, detailsSaveError, savingDetails, onRetry, visualSaveError, savingVisual, onRetryVisual }: {
  event: EventView;
  visual: EventVisualConfig | null;
  coverUrl?: string | null;
  detailsSaveError: string | null;
  savingDetails: boolean;
  onRetry: () => void;
  visualSaveError: string | null;
  savingVisual: boolean;
  onRetryVisual: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const page = `${origin}/e/${event.id}`;
  const checkout = `${origin}/p/${event.id}`;
  return (
    <div className="gc-created max-w-xl mx-auto space-y-6">
      <div className="flex gap-4 items-center">
        <div className="gc-created-cover relative shrink-0">
          <Cover event={event} visual={visual ?? undefined} coverUrl={coverUrl} className="w-20 h-20 rounded-xl [&>span]:hidden" />
          <svg viewBox="0 0 24 24" className="gc-created-check" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
        </div>
        <div>
          <div className="text-sm text-good font-medium">Event created</div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.metadata.title}</h1>
        </div>
      </div>

      {detailsSaveError && (
        <div className="card p-4 space-y-2 border-warn/50">
          <p className="text-sm text-warn">The event was created, but its public details or door team could not be saved: {detailsSaveError}</p>
          <button type="button" className="btn btn-ghost !py-1.5 text-sm" disabled={savingDetails} onClick={onRetry}>
            {savingDetails ? "Saving…" : "Retry saving details"}
          </button>
        </div>
      )}
      {savingDetails && <p className="text-sm text-muted">Saving public event details…</p>}
      {visualSaveError && (
        <div className="card p-4 space-y-2 border-warn/50">
          <p className="text-sm text-warn">The event was created, but its theme could not be saved: {visualSaveError}</p>
          <button type="button" className="btn btn-ghost !py-1.5 text-sm" disabled={savingVisual} onClick={onRetryVisual}>
            {savingVisual ? "Saving…" : "Retry saving theme"}
          </button>
        </div>
      )}
      {savingVisual && <p className="text-sm text-muted">Saving the event look off-chain…</p>}

      {needsBond(event) && (
        <div className="card p-4 space-y-2 border-accent/50">
          <p className="text-sm">Registration opens once you lock the {formatUsdc(hostBondFor(event))} USDC host bond. Lock it on the event page before the event starts.</p>
          <Link href={`/e/${event.id}`} className="btn btn-accent !py-2 text-sm">Lock Host Bond</Link>
        </div>
      )}

      <div className="space-y-3">
        <Way title="Event page" value={page} />
        <Way title="Quick checkout link" value={checkout} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/e/${event.id}`} className="btn btn-primary">
          Open Event Page
        </Link>
        <Link href={integrationUrl(event.id)} className="btn btn-ghost">
          Add to Your Site
        </Link>
        <Link href={`/e/${event.id}/manage`} className="btn btn-ghost">
          Manage Guests &amp; Check-In
        </Link>
      </div>
    </div>
  );
}

function safeImageUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function uploadCover(dataUrl: string, token: string): Promise<string> {
  const bytes = await (await fetch(dataUrl)).blob();
  const response = await fetch("/api/covers", { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${token}` }, body: bytes });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || typeof json.url !== "string") throw new Error(json.error ?? "Could not upload the cover photo");
  return json.url;
}

async function saveDetails(eventId: number, details: EventDetails, doorTeam: string[], token: string) {
  if (doorTeam.length) await cohostsApi.save(token, eventId, doorTeam);
  if (!details.location && !details.description && !details.cover_url && details.public !== false) return;
  if (details.cover_url?.startsWith("data:")) details = { ...details, cover_url: await uploadCover(details.cover_url, token) };
  const response = await fetch("/api/event-details", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, details }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save event details");
}

async function saveVisual(eventId: number, visual: EventVisualConfig, token: string) {
  const response = await fetch("/api/event-visuals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, visual }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save event visual");
}

function Way({ title, value }: { title: string; value: string }) {
  return (
    <div className="card p-4 space-y-2">
      <div className="font-medium">{title}</div>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{value}</code>
        {value && <SlCopy text={value} />}
      </div>
    </div>
  );
}
