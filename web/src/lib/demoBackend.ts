"use client";

// Demo mode: the whole site runs on made-up events kept in this browser.
// Nothing reaches our server or the blockchain: window.fetch answers chain views
// (RPC) and /api/* from local state, and wallet calls change that state.
import { EVENTS_CONTRACT, INTENTS_CONTRACT, RPC_URL, USDC_CONTRACT } from "./config";
import { formatUsdc, registrationEndsAt, toUnits, type EventMetadata, type EventMode, type EventView, type GuestStatus, type GuestView } from "./near";
import type { EventDetails } from "./eventImport";
import type { EventVisualConfig } from "./event-visuals";
import { freeEventProblem, type FreeEvent, type FreeEventInput } from "./freeEventsShared";
import { cleanProfile, type Profile } from "./profilesShared";
import { normalizeCohosts } from "./cohostsShared";
import type { Call } from "./wallet";
import { reputationIndex, emptyReputation } from "./reputationShared";

export const DEMO_ACCOUNT = "you.demo";
const KEY = "nearvent:demo";

type Free = FreeEventInput & { id: string; host: string; created_at: number; guests: string[]; requests: string[] };

interface State {
  nextId: number;
  events: EventView[];
  guests: Record<number, GuestView[]>;
  /** Escrow `balance_of`: payouts and refunds waiting to be withdrawn. */
  escrow: Record<string, string>;
  usdc: Record<string, string>;
  intents: Record<string, string>;
  details: Record<number, EventDetails>;
  visuals: Record<number, EventVisualConfig>;
  checkins: Record<number, Record<string, { at: number; by: string }>>;
  cohosts: Record<number, string[]>;
  names: Record<number, Record<string, string>>;
  profiles: Record<string, Profile>;
  free: Record<string, Free>;
}

// ------------------------------------------------------------------ seed

const H = 3_600_000;
const D = 24 * H;
const PEOPLE = ["Maya", "Leo", "Nina", "Omar", "Sara", "Kai", "Ivan", "Zoe", "Ravi", "Lena", "Theo", "Ana", "Max", "Ida", "Noah", "Eva", "Sam", "Mia", "Tom", "Liv", "Ben", "Ava", "Jon"];
const acct = (name: string) => `${name.toLowerCase()}.demo`;
/** The escrow's defaults with no court, as on mainnet at the v3 launch. */
const RULES = { dao: null, treasury: "treasury.demo", bond_per_seat: 0, close_at_start: true, challenge_hours: 12, submit_hours: 72, resolve_hours: 168 };
/** What `get_event` adds in v3: Deposit registration closes at the start, the list is due `submit_hours` after the end, no bond. */
const v3 = (mode: EventMode, m: EventMetadata) => ({
  dao: null, rules: RULES, host_bond: "0", bond_due: "0",
  registration_ends_at: mode === "Deposit" ? m.starts_at : m.ends_at,
  submit_by: mode === "Deposit" ? m.ends_at + RULES.submit_hours * H : 0,
});
const map = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
// Real BaliSquad AI events (titles, posters, venues; used with BaliSquad's permission, 2026-11-13; Alex: AI and crypto only, none crypto found). Posters live in public/demo.
// They use the Paradise theme: nearvent-style themes print the title over the poster, which has its own text.
const poster = (name: string) => new URL(`/demo/balisquad-${name}.jpg`, location.origin).href;
const HOSTS = { bstc: "Bali Startup & Tech", spacexai: "SpaceXAI Bali", nebula: "Nebula Coworking", aialliance: "Bali AI Alliance" };

function seed(): State {
  const now = Date.now();
  const s: State = {
    nextId: 1, events: [], guests: {}, escrow: {}, usdc: { [DEMO_ACCOUNT]: toUnits(50) }, intents: {},
    details: {}, visuals: {}, checkins: {}, cohosts: {}, names: {}, profiles: {}, free: {},
  };
  PEOPLE.forEach((name, i) => {
    s.profiles[acct(name)] = { username: name.toLowerCase(), first_name: name, last_name: "", avatar_url: null, avatar_seed: 7919 * (i + 1), links: {} };
  });
  Object.entries(HOSTS).forEach(([id, name], i) => {
    s.profiles[acct(id)] = { username: id, first_name: name, last_name: "", avatar_url: null, avatar_seed: 104729 * (i + 1), links: {} };
  });

  const add = (o: {
    host: string; title: string; starts: number; hours: number; usdc: number; mode: EventMode; capacity: number;
    guests: string[]; place: string; about: string; theme: EventVisualConfig["themeId"]; cover: string;
  }) => {
    const id = s.nextId++;
    s.events.push({
      id, host: o.host, metadata: { title: o.title, starts_at: o.starts, ends_at: o.starts + o.hours * H },
      deposit: toUnits(o.usdc), mode: o.mode, capacity: o.capacity, status: "Open", guest_count: o.guests.length,
      attended_count: 0, total_pool: (BigInt(toUnits(o.usdc)) * BigInt(o.guests.length)).toString(), payout_per_attendee: "0",
      created_at: Math.min(now, o.starts) - 7 * D, closed_at: 0,
      ...v3(o.mode, { title: o.title, starts_at: o.starts, ends_at: o.starts + o.hours * H }),
    });
    s.guests[id] = o.guests.map((a, i) => ({ account_id: a, status: "Registered", registered_at: Math.min(now, o.starts) - (6 - i * 0.2) * D }));
    s.names[id] = Object.fromEntries(o.guests.map((a) => [a, s.profiles[a]?.first_name ?? "You"]));
    s.details[id] = { location: map(o.place), description: o.about, cover_url: poster(o.cover) };
    s.visuals[id] = { themeId: o.theme, seed: 1000 + id * 37 };
    return id;
  };

  // A past event you went to: closed, so your payout waits in your balance.
  const past = add({
    host: acct("bstc"), title: "How I AI | Season 2 · Edition 18", starts: now - 6 * D, hours: 3, usdc: 5, mode: "Deposit", capacity: 20,
    guests: [DEMO_ACCOUNT, ...PEOPLE.slice(1, 10).map(acct)], place: "Seoul Soul Project, Canggu",
    about: "Season 2 launch night. Builders show the AI tools and workflows they use and how it turns into revenue. One minute each, raw and real.", theme: "paradise", cover: "how-i-ai",
  });
  finalize(s, past, [DEMO_ACCOUNT, ...PEOPLE.slice(1, 6).map(acct)]);

  // Your own event: it just ended, so you can check guests in and close it.
  add({
    host: DEMO_ACCOUNT, title: "Cursor Meetup - AI Agent 101", starts: now - 3 * H, hours: 2.5, usdc: 10, mode: "Deposit", capacity: 30,
    guests: PEOPLE.slice(3, 11).map(acct), place: "Bukit Hub Coworking, Bali",
    about: "An advanced Cursor AI meetup: pizza and drinks, credits from Cursor, ElevenLabs and friends, and Cursor swag.", theme: "paradise", cover: "cursor-meetup",
  });

  // Upcoming events to register for.
  add({
    host: acct("spacexai"), title: "Grok Bot Workshop Bali - SpaceXAI", starts: now + 3 * D, hours: 3, usdc: 5, mode: "Deposit", capacity: 40,
    guests: PEOPLE.slice(5, 16).map(acct), place: "Uluwatu, Bali",
    about: "Designers, PMs, founders, developers and AI beginners: share workflows built with Grok bot, pick up credits and learn from each other.", theme: "paradise", cover: "grok-workshop",
  });
  add({
    host: acct("nebula"), title: "How to Train and Build AI From Scratch", starts: now + 8 * D, hours: 3, usdc: 15, mode: "Ticket", capacity: 60,
    guests: PEOPLE.slice(0, 23).map(acct), place: "Nebula Coworking Space, Bali",
    about: "A hands-on LLM session: build small parts of a GPT-style language model together and see how LLMs work inside.", theme: "paradise", cover: "build-ai",
  });

  s.free.demoAiCoffee = {
    id: "demoAiCoffee", host: acct("aialliance"), created_at: now - 2 * D, title: "Bali AI Alliance: Coffee & Connections",
    starts_at: now + 2 * D, ends_at: now + 2 * D + 2 * H, capacity: 40, location: map("Bokashi Berawa, Canggu"),
    description: "Meet the people behind AI in Bali: a relaxed afternoon of coffee, ideas and new connections. Your first coffee is on us.", cover_url: poster("ai-alliance"),
    visual: { themeId: "paradise", seed: 4242 }, public: true, approval: false,
    guests: PEOPLE.slice(8, 20).map(acct), requests: [],
  };
  return s;
}

// ----------------------------------------------------------------- state

let memory: State | null = null;

function load(): State {
  if (!memory) {
    try {
      memory = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {}
    memory ??= seed();
    // Saved demos from before v3 had a pretend host bond and no deadlines.
    for (const e of memory.events) Object.assign(e, v3(e.mode, e.metadata));
  }
  return memory;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage full or blocked: the demo keeps working until the page reloads.
  }
}

const isOn = () => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return memory !== null;
  }
};

function move(book: Record<string, string>, account: string, delta: bigint, short = "Not enough USDC") {
  const next = BigInt(book[account] ?? "0") + delta;
  if (next < 0n) throw new Error(short);
  book[account] = next.toString();
}

const statusOf = (s: State, id: number, account: string): GuestStatus | null =>
  s.guests[id]?.find((g) => g.account_id === account)?.status ?? null;

function eventOf(s: State, id: unknown): EventView {
  const e = s.events.find((x) => x.id === id);
  if (!e) throw new Error("Event not found");
  return e;
}

/** Same rules as the escrow: show-ups split the pool; nobody checked in means everyone gets the deposit back. */
function finalize(s: State, id: number, attended: string[]) {
  const e = eventOf(s, id);
  const came = s.guests[id].filter((g) => attended.includes(g.account_id));
  came.forEach((g) => (g.status = "Attended"));
  e.attended_count = came.length;
  if (e.mode === "Deposit") {
    if (came.length) {
      const share = BigInt(e.total_pool) / BigInt(came.length);
      came.forEach((g) => move(s.escrow, g.account_id, share));
      e.payout_per_attendee = share.toString();
    } else {
      s.guests[id].forEach((g) => move(s.escrow, g.account_id, BigInt(e.deposit)));
    }
  }
  e.status = "Finalized";
  e.closed_at = Date.now();
}

// ---------------------------------------------------------------- wallet

/** The demo account if demo mode is on in this browser. */
export function demoRestore(): string | null {
  return isOn() ? DEMO_ACCOUNT : null;
}

/** Turns demo mode on with fresh made-up events (or the ones from last time). */
export function demoLogin(): string {
  load();
  save();
  window.fetch = demoFetch;
  return DEMO_ACCOUNT;
}

/** Leaves demo mode and forgets everything done in it. */
export function demoLogout() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.fetch = realFetch;
}

/** Applies one wallet call to the local state, like the escrow would. */
export async function demoSend(call: Call): Promise<void> {
  await new Promise((r) => setTimeout(r, 600)); // feels like a wallet confirming
  const s = load();
  const me = DEMO_ACCOUNT;
  const a = call.args as Record<string, any>;
  switch (`${call.receiverId} ${call.methodName}`) {
    case `${EVENTS_CONTRACT} create_event`: {
      const id = s.nextId++;
      s.events.push({
        id, host: me, metadata: a.metadata, deposit: a.deposit, mode: a.mode, capacity: a.capacity, status: "Open",
        guest_count: 0, attended_count: 0, total_pool: "0", payout_per_attendee: "0", created_at: Date.now(), closed_at: 0,
        ...v3(a.mode ?? "Deposit", a.metadata),
      });
      s.guests[id] = [];
      break;
    }
    case `${USDC_CONTRACT} ft_transfer_call`: {
      const msg = JSON.parse(a.msg ?? "{}");
      const e = eventOf(s, msg.event_id);
      if (a.receiver_id !== EVENTS_CONTRACT || msg.action !== "register" || a.amount !== e.deposit) throw new Error("Bad registration");
      if (e.status !== "Open" || Date.now() >= registrationEndsAt(e)) throw new Error("Registration is closed");
      if (statusOf(s, e.id, me)) throw new Error("You are already registered");
      if (e.guest_count >= e.capacity) throw new Error("This event is full");
      move(s.usdc, me, -BigInt(e.deposit));
      if (e.mode === "Ticket") move(s.escrow, e.host, BigInt(e.deposit));
      s.guests[e.id].push({ account_id: me, status: "Registered", registered_at: Date.now() });
      e.guest_count++;
      e.total_pool = (BigInt(e.total_pool) + BigInt(e.deposit)).toString();
      break;
    }
    case `${EVENTS_CONTRACT} finalize`: {
      const e = eventOf(s, a.event_id);
      if (e.host !== me) throw new Error("Only the host can close the event");
      if (e.status !== "Open") throw new Error("The event is already closed");
      if (Date.now() < e.metadata.ends_at) throw new Error("The event has not ended yet");
      finalize(s, e.id, a.attended ?? []);
      break;
    }
    case `${EVENTS_CONTRACT} refund`: {
      // No court: the empty list refunds every guest at once.
      const e = eventOf(s, a.event_id);
      if (e.mode !== "Deposit" || e.status !== "Open" || Date.now() <= (e.submit_by ?? Infinity)) throw new Error("Nothing to refund yet");
      finalize(s, e.id, []);
      break;
    }
    case `${EVENTS_CONTRACT} cancel`: {
      const e = eventOf(s, a.event_id);
      if (e.host !== me) throw new Error("Only the host can cancel the event");
      if (e.status !== "Open") throw new Error("The event is already closed");
      if (e.mode === "Deposit") s.guests[e.id].forEach((g) => move(s.escrow, g.account_id, BigInt(e.deposit)));
      e.status = "Cancelled";
      e.closed_at = Date.now();
      break;
    }
    case `${EVENTS_CONTRACT} withdraw`:
      move(s.escrow, me, -BigInt(a.amount), "Not enough balance");
      if (a.to_intents) move(s.intents, a.receiver_id, BigInt(a.amount));
      break;
    case `${USDC_CONTRACT} storage_deposit`:
      break;
    case `${USDC_CONTRACT} ft_transfer`:
      move(s.usdc, me, -BigInt(a.amount));
      break;
    case `${INTENTS_CONTRACT} mt_transfer`:
      move(s.intents, me, -BigInt(a.amount));
      move(s.intents, a.receiver_id, BigInt(a.amount));
      break;
    case `${INTENTS_CONTRACT} ft_withdraw`:
      move(s.intents, me, -BigInt(a.amount));
      break;
    default:
      throw new Error(`${call.methodName} is not part of the demo`);
  }
  save();
}

// ----------------------------------------------------------------- fetch

const realFetch: typeof fetch = typeof window === "undefined" ? fetch : window.fetch.bind(window);

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (error: string, status = 400) => reply({ error }, status);

async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.href === new URL(RPC_URL).href) return rpc(await req.json().catch(() => null));
  // Importing a public Luma or BaliSquad page only reads that page, so it stays real.
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || /^\/api\/(luma|balisquad)\//.test(url.pathname)) return realFetch(input, init);
  try {
    return await api(req, url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}

function rpc(body: { id?: string; method?: string; params?: Record<string, string> } | null): Response {
  const p = body?.params ?? {};
  try {
    if (body?.method !== "query" || p.request_type !== "call_function") throw new Error("Not part of the demo");
    const value = view(load(), p.account_id, p.method_name, JSON.parse(atob(p.args_base64 ?? "") || "{}"));
    return reply({ jsonrpc: "2.0", id: body.id, result: { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [] } });
  } catch (e) {
    return reply({ jsonrpc: "2.0", id: body?.id, error: { message: e instanceof Error ? e.message : String(e) } });
  }
}

function view(s: State, contract: string, method: string, a: Record<string, any>): unknown {
  if (contract === EVENTS_CONTRACT) {
    switch (method) {
      case "get_recent_events": return [...s.events].sort((x, y) => y.id - x.id).slice(0, a.limit ?? 100);
      case "get_events": return [...s.events].sort((x, y) => x.id - y.id).slice(a.from_index ?? 0, (a.from_index ?? 0) + Math.min(a.limit ?? 50, 100));
      // Demo events have no access rules.
      case "check_access": return { allowed: true, attended: 0, no_shows: 0 };
      case "get_event": return s.events.find((e) => e.id === a.event_id) ?? null;
      case "get_guests": return s.guests[a.event_id] ?? [];
      case "get_guest_status": return statusOf(s, a.event_id, a.account_id);
      case "get_guest_statuses": return (a.event_ids as number[]).map((id) => statusOf(s, id, a.account_id));
      case "balance_of": return s.escrow[a.account_id] ?? "0";
      case "can_create": return true;
      case "create_event_cost": return "0";
      case "get_config": return { owner: "owner.demo", rules: RULES, oracle_hour_ms: H };
      // Demo events close at once (no dispute window), so there are never disputes.
      case "get_disputes": return [];
    }
  }
  if (contract === USDC_CONTRACT && method === "ft_balance_of") return s.usdc[a.account_id] ?? "0";
  if (contract === USDC_CONTRACT && method === "storage_balance_of") return { total: "1250000000000000000000", available: "0" };
  if (contract === INTENTS_CONTRACT && method === "mt_balance_of") return s.intents[a.account_id] ?? "0";
  if (contract === INTENTS_CONTRACT && method === "current_salt") return "00000000";
  throw new Error(`${method} is not part of the demo`);
}

const asDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("Could not read the photo"));
  reader.readAsDataURL(blob);
});

async function api(req: Request, url: URL): Promise<Response> {
  const s = load();
  const me = DEMO_ACCOUNT;
  const q = url.searchParams;
  const post = req.method === "POST";
  if (url.pathname === "/api/covers" && post) return reply({ url: await asDataUrl(await req.blob()) }); // the photo stays in this browser
    const body: Record<string, any> = post ? await req.json().catch(() => ({})) : {};
  const ids = (q.get("ids") ?? q.get("e") ?? "").split(",").filter(Boolean).map(Number);
  const done = (out: unknown = { ok: true }) => (save(), reply(out));
  const hosted = (id: unknown) => {
    const e = eventOf(s, id);
    if (e.host !== me) throw new Error("Only the event host can change this");
    return e;
  };

  switch (url.pathname) {
    case "/api/event-details":
      if (!post) {
        if (q.has("private")) return reply({ ids: Object.keys(s.details).map(Number).filter((id) => s.details[id].public === false) });
        return reply({ details: s.details[ids[0]] ?? null });
      }
      hosted(body.eventId);
      s.details[body.eventId] = { ...body.details, public: body.details?.public ?? s.details[body.eventId]?.public };
      return done();

    case "/api/event-visuals":
      if (!post) return reply({
        visuals: Object.fromEntries(ids.filter((id) => s.visuals[id]).map((id) => [id, s.visuals[id]])),
        covers: Object.fromEntries(ids.filter((id) => s.details[id]?.cover_url).map((id) => [id, s.details[id].cover_url])),
      });
      hosted(body.eventId);
      s.visuals[body.eventId] = body.visual;
      return done();

    case "/api/cohosts": {
      if (!post) return reply({ cohosts: q.has("e") ? s.cohosts[ids[0]] ?? [] : Object.fromEntries(ids.map((id) => [id, s.cohosts[id] ?? []])) });
      const e = hosted(body.eventId);
      const list = normalizeCohosts(body.cohosts, e.host);
      if (!list) return fail("Use up to 10 NEAR accounts");
      s.cohosts[e.id] = list;
      return done({ ok: true, cohosts: list });
    }

    case "/api/checkin": {
      if (!post) return reply({ checkedIn: s.checkins[ids[0]] ?? {} });
      const e = eventOf(s, body.event);
      if (e.host !== me && !(s.cohosts[e.id] ?? []).includes(me)) return fail("Only the host or the door team can check guests in", 403);
      if (e.status !== "Open") return fail("The event is closed", 409);
      if (!statusOf(s, e.id, body.account)) return fail(`${body.account} is not registered`, 404);
      const list = (s.checkins[e.id] ??= {});
      if (body.on === false) delete list[body.account];
      else list[body.account] = { at: Date.now(), by: me };
      return done({ ok: true, checkedIn: list });
    }

    case "/api/guest-names": {
      if (!post) return reply({ names: s.names[ids[0]] ?? {} });
      const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
      if (!name || new TextEncoder().encode(name).length > 80) return fail("Enter a name (up to 80 characters).");
      eventOf(s, body.eventId);
      (s.names[body.eventId] ??= {})[me] = name;
      return done({ ok: true, name });
    }

    case "/api/profiles": {
      if (!post) {
        const wanted = (q.get("a") ?? "").split(",");
        return reply({ profiles: Object.fromEntries(wanted.filter((a) => s.profiles[a]).map((a) => [a, s.profiles[a]])) });
      }
      // Photos are data: URLs in the demo; the real check only accepts uploaded paths.
      const photo = typeof body.avatar_url === "string" && body.avatar_url.startsWith("data:") ? body.avatar_url : null;
      const result = cleanProfile(photo ? { ...body, avatar_url: null } : body);
      if ("error" in result) return fail(result.error);
      const profile = { ...result.profile, avatar_url: photo ?? result.profile.avatar_url };
      const taken = profile.username && Object.entries(s.profiles).some(([a, p]) => a !== me && p.username === profile.username);
      if (taken) return fail("This username is taken", 409);
      s.profiles[me] = profile;
      return done({ profile });
    }

    case "/api/free-events":
      return freeEvents(s, q, post, body, done);

    case "/api/faucet":
      move(s.usdc, me, BigInt(toUnits(20)));
      return done();

    case "/api/oneclick/tokens":
      return reply([
        { assetId: "demo:usdc-base", decimals: 6, blockchain: "base", symbol: "USDC" },
        { assetId: "demo:usdc-eth", decimals: 6, blockchain: "eth", symbol: "USDC" },
        { assetId: "demo:usdc-sol", decimals: 6, blockchain: "sol", symbol: "USDC" },
      ]);

    case "/api/oneclick/quote": {
      const amount = String(body.amount ?? "0");
      return reply({ quote: { depositAddress: `demo-${crypto.randomUUID()}`, amountIn: amount, amountInFormatted: formatUsdc(amount), amountOut: amount, amountOutFormatted: formatUsdc(amount), timeEstimate: 10 } });
    }

    case "/api/oneclick/status":
      return reply({ status: "SUCCESS" });

    case "/api/telegram/link":
      return reply({ bot: null });

    case "/api/keeper/event":
      return reply({ results: [] });

    case "/api/reputation": {
      const facts = { events: s.events, guests: s.guests, disputes: {} };
      const index = reputationIndex(facts, []);
      const accounts = (q.get("a") ?? "").split(",").filter(Boolean);
      return reply({ version: 1, accounts: Object.fromEntries(accounts.map((a) => [a, index.get(a) ?? emptyReputation(facts, a)])) });
    }
  }
  return fail("This is not part of the demo", 404);
}

function freeEvents(s: State, q: URLSearchParams, post: boolean, body: Record<string, any>, done: (out?: unknown) => Response): Response {
  const me = DEMO_ACCOUNT;
  const all = Object.values(s.free);
  const brief = ({ guests, requests: _, ...e }: Free): FreeEvent => ({ ...e, guest_count: guests.length });
  if (!post) {
    const attended = q.get("attended");
    if (attended !== null) return reply({ count: all.filter((e) => e.guests.includes(attended) && e.ends_at < Date.now()).length });
    if (q.has("mine")) return reply({ events: all.filter((e) => e.host === me || e.guests.includes(me)).map((e) => ({ ...brief(e), going: e.guests.includes(me) })) });
    const id = q.get("id");
    if (id === null) return reply({ events: all.filter((e) => e.public).map(brief) });
    const e = s.free[id];
    if (!e) return fail("Event not found", 404);
    return reply({ event: { ...brief(e), guests: e.guests, ...(e.host === me ? { requests: e.requests } : { requested: e.requests.includes(me) }) } });
  }

  if (body.action === "create") {
    // Photos are data: URLs in the demo; the real check only accepts http(s) links.
    const problem = freeEventProblem({ ...body.event, cover_url: body.event?.cover_url ? "https://demo.invalid/cover.jpg" : null });
    if (problem) return fail(problem);
    const id = `demo${crypto.randomUUID().slice(0, 8)}`;
    s.free[id] = { ...(body.event as FreeEventInput), approval: body.event.approval === true, id, host: me, created_at: Date.now(), guests: [], requests: [] };
    return done({ id });
  }
  const e = s.free[body.id];
  if (!e) return fail("Event not found", 404);
  if (body.action === "join" || body.action === "leave") {
    if (body.action === "leave") {
      e.guests = e.guests.filter((a) => a !== me);
      e.requests = e.requests.filter((a) => a !== me);
    } else if (!e.guests.includes(me)) {
      if (e.guests.length >= e.capacity) return fail("This event is full", 409);
      if (e.approval && me !== e.host) e.requests = [...new Set([...e.requests, me])];
      else e.guests.push(me);
    }
    return done();
  }
  if (e.host !== me) return fail("Only the host can change this", 403);
  if (body.action === "visibility") {
    e.public = body.public === true;
    return done();
  }
  if (body.action === "approve" || body.action === "decline") {
    if (!e.requests.includes(body.guest)) return fail("This request is no longer pending", 409);
    if (body.action === "approve" && e.guests.length >= e.capacity) return fail("This event is full", 409);
    e.requests = e.requests.filter((a) => a !== body.guest);
    if (body.action === "approve") e.guests.push(body.guest);
    return done();
  }
  return fail("Bad request");
}

// Pages read data right after load, so demo mode has to answer before any of them runs.
// Embed checkout (/embed/…, /p/…) is a real event on someone else's site, and demo ids
// (1, 2, …) overlap real ones, so it leaves the throwaway demo instead of showing a fake event.
if (typeof window !== "undefined" && isOn()) {
  if (location.pathname.startsWith("/embed/")) demoLogout();
  else window.fetch = demoFetch;
}
