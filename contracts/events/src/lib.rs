//! Near Events — Kickback-style event escrow, v3: optimistic attendance.
//!
//! Guests register by sending an equal USDC deposit with `ft_transfer_call`.
//! Check-in at the door happens off-chain (the host or the door team the host
//! keeps on the Near Events server mark guests there).
//!
//! An event runs in one of two modes, never both. `Ticket` is a plain paid
//! ticket: the price is credited to the host's balance right at registration;
//! `finalize` and `cancel` only close the event and refund nothing.
//! `Deposit` (the default) is the Kickback pool, guarded by an optimistic
//! oracle (see "Deposit events" below). The amount a guest pays lives in
//! `deposit` in both modes.
//!
//! Deposit events follow the `Rules` the owner set when they were created
//! (`set_rules`; defaults: no court; window 12 h, publish 72 h, court 7 days;
//! with a court, at least 2 deposits per seat). Without a court (`rules.dao = None`) there
//! is no bond and no dispute: the host's list pays out when published. With one:
//! 1. The host (or anyone for them) locks a bond of `bond_per_seat` deposits per
//!    seat (`host_bond` message). Registration opens only after that and closes
//!    at `starts_at`, and the host can never take a seat.
//! 2. After `ends_at` the host publishes who came (`finalize`, within
//!    `submit_hours`). Nothing is paid yet: the event is `Submitted`.
//! 3. For `challenge_hours` any guest may dispute one record by locking a
//!    bond equal to the deposit (`dispute` message): "I came" only for oneself,
//!    "X did not come" only about another guest. One dispute per record.
//! 4. The event's DAO (a Sputnik DAO whose council votes on proposals) calls
//!    `resolve_dispute` itself. A dispute it does not decide within
//!    `resolve_hours` after the window expires: the host's record stands and
//!    the challenger gets the bond back.
//! 5. Anyone calls `settle` once the window is over and no dispute is waiting.
//!    Money (all on internal balances): the pool is split by the final list;
//!    the host bond goes back to the host, or, if any dispute was upheld,
//!    `HOST_TREASURY_BPS` of it to the treasury and the rest to the winners
//!    (at most `MAX_WIN_DEPOSITS` deposits each, the excess to the treasury);
//!    a dismissed challenger bond goes `CHALLENGER_TREASURY_BPS` to the treasury
//!    and the rest to the people who came. Every unit that comes in is paid out.
//! 6. A host who publishes no list in time loses the bond: anyone calls
//!    `refund`, which publishes an empty list in the host's place and opens the
//!    dispute window. Guests who came can still prove it ("I came") and then
//!    split the pool; if nobody proves it, everyone gets the deposit back. The
//!    bond goes to the winners and the treasury, or, with no winner, to all
//!    guests and the treasury. So abandoning never
//!    beats publishing an honest list. The host may `cancel` only before
//!    `starts_at` (or before the bond).
//!
//! Payouts land on an internal balance that the owner can withdraw to any
//! NEAR account or into their NEAR Intents balance (`intents.near`, from where
//! 1Click takes it to any chain).
//!
//! Intents payments withdraw from the payer's own verifier balance. The token
//! resolver returns unused USDC to the sender, and the verifier credits its
//! original withdrawal owner. Never send solver-owned swaps directly to the
//! escrow. Only the NEAR Intents verifier names a guest other than the sender.
//!
//! Free tier: an event of up to `FREE_MAX_CAPACITY` seats that ends within
//! `FREE_MAX_HORIZON_MS` is free, up to `FREE_MAX_EVENTS` free events per host
//! in any `FREE_WINDOW_MS` (closing one early does not give its slot back).
//! With the sponsored mode on, only sponsored hosts get the free tier. The
//! contract pays for storage from its own NEAR balance, which the operator
//! keeps topped up. Anything else the host pays for: `create_event` takes the
//! storage cost (`create_event_cost`) as attached NEAR, returns the excess, and
//! gives back the share nobody used when the event closes. The deposit has a
//! floor so seats always cost guests something.
//!
//! Accounts that live in NEAR Intents (EVM, Solana, passkey wallets) act as
//! hosts through the verifier's `auth_call` intent, which calls `on_auth`.
//!
//! The owner can replace the code (`upgrade`) until `freeze`, which is one-way.
//! The escrow account keeps no access keys, so after `freeze` nobody can
//! change the code. The owner also runs both host lists (whitelist, sponsored)
//! and sets the `Rules` for future events (`set_rules`).
//!
//! Access rule (optional, set at creation): only guests with a history at the
//! same host's earlier finalized events may register — at least `min_attended`
//! visits and at most `max_no_shows` no-shows among `past_events` — until
//! `open_to_all_at`, if given. `check_access` shows the result for any account.
//!
//! Reputation counters and the score are computed off-chain from these
//! records (`get_events`, `get_guests`, `get_disputes`).

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

// Sizes below are the measured worst case (64-char accounts, 120-char title)
// plus ~25%: see `storage_reserves_cover_the_measured_worst_case` in `tests.rs`,
// which checks real storage stays under them. Open events reserved storage with
// these numbers: an upgrade must not change them while events are open.
/// Storage for one registration and its indexes. Each seat also reserves
/// a separate balance entry and a possible dispute for settlement.
pub const STORAGE_BYTES_PER_GUEST: u64 = 310;
const BALANCE_BYTES: u64 = 176;
/// A dispute, kept inside the disputed guest's registration.
const DISPUTE_BYTES: u64 = 110;
/// One entry in `whitelist`.
const WHITELIST_BYTES: u64 = 140;
/// A host's free-tier log (creation times of the last free events).
const FREE_LOG_BYTES: u64 = 160;
/// Reserved per taken seat until the event closes: the guest's balance entry and a dispute.
const SETTLE_BYTES: u64 = BALANCE_BYTES + DISPUTE_BYTES;
const SEAT_BYTES: u64 = STORAGE_BYTES_PER_GUEST + SETTLE_BYTES;
/// Per event: the balance entries of the host and of the treasury.
const EVENT_BALANCES_BYTES: u64 = 2 * BALANCE_BYTES;
const MAX_VIEW_PAGE: u32 = 100;
/// Upper bound for one event record: max-length title, the largest access
/// rule, the DAO and treasury accounts, the dispute counters and the vector slot.
const EVENT_RECORD_BYTES: u64 = 760;
/// Most past events an access rule may look at.
pub const MAX_RULE_EVENTS: usize = 10;
/// Largest event the contract pays storage for.
pub const FREE_MAX_CAPACITY: u32 = 50;
/// The free tier gives a host this many events...
pub const FREE_MAX_EVENTS: usize = 2;
/// ...in any window of this length, counted at creation.
pub const FREE_WINDOW_MS: u64 = 30 * DAY_MS;
/// A free event must end within this time, so spam reservations expire fast.
pub const FREE_MAX_HORIZON_MS: u64 = 60 * DAY_MS;
/// Smallest deposit: 0.1 USDC (6 decimals). Stops events with a dust deposit
/// where seats cost us storage but cost guests nothing.
pub const MIN_DEPOSIT: u128 = 100_000;
/// `settle` walks every guest in one call; the sandbox measures the gas at
/// this capacity with a dispute on every record.
pub const MAX_CAPACITY: u32 = 300;
/// Ticket events: after `ends_at` + this grace period, anyone can `cancel` an unclosed event.
pub const ABANDON_GRACE_MS: u64 = 30 * DAY_MS;

/// One hour of the oracle's deadlines (`Rules`). Testnet rehearsal builds
/// (`--features short-windows`, refused outside testnet and sandbox) make it
/// 10 seconds, so a whole dispute cycle fits in minutes.
pub const ORACLE_HOUR_MS: u64 = if cfg!(feature = "short-windows") { 10_000 } else { HOUR_MS };
/// Share of a lost host bond that goes to the treasury (the rest to the winners).
/// 5000 keeps a lying host from winning its own bond back through a sock-puppet dispute.
pub const HOST_TREASURY_BPS: u128 = 5_000;
/// Share of a dismissed challenger bond that goes to the treasury (the rest to the people who came).
pub const CHALLENGER_TREASURY_BPS: u128 = 5_000;
/// Most one winner takes from a lost host bond, in deposits; the rest goes to the treasury.
/// Without it a false claim against a 300-seat bond pays at a 0.7% council error rate (audit 2).
pub const MAX_WIN_DEPOSITS: u128 = 5;
const BPS: u128 = 10_000;

const HOUR_MS: u64 = 60 * 60 * 1000;
const DAY_MS: u64 = 24 * HOUR_MS;
const MAX_TITLE_LEN: usize = 120;
/// Events must end within a year, so every deadline is always reachable.
const MAX_EVENT_HORIZON_MS: u64 = 365 * DAY_MS;
const MAX_WHITELIST_BATCH: usize = 100;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_MIGRATE: Gas = Gas::from_tgas(30);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Events,
    Guests,
    GuestIndex,
    Balances,
    /// tp7's open-event counter, no longer used; kept so later prefixes don't shift.
    OpenEvents,
    /// v2's attendance counter, no longer used (the score lives off-chain).
    AttendedEvents,
    Whitelist,
    Sponsored,
    FreeLog,
}

/// Variants keep their Borsh order; new ones are appended.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventStatus {
    Open,
    /// Paid out (`Deposit`: settled; `Ticket`: closed by the host).
    Finalized,
    Cancelled,
    /// Deposit: the host published the list; disputes, then `settle`.
    Submitted,
    /// Deposit: the host published no list in time and nobody registered; the bond went back.
    /// (With guests an abandoned event goes to `Submitted` with an empty list.)
    Refunded,
}

/// How the money of an event works. One or the other, never mixed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum EventMode {
    /// Equal deposits; people who show up split the pool.
    #[default]
    Deposit,
    /// Paid ticket; the host gets the ticket money at registration.
    Ticket,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuestStatus {
    Registered,
    /// Final: set by `settle` (Deposit) or `finalize` (Ticket).
    Attended,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EventMetadata {
    pub title: String,
    /// Milliseconds since Unix epoch.
    pub starts_at: u64,
    pub ends_at: u64,
}

/// The owner's settings (`set_rules`). Each event copies them when it is
/// created, so a change applies to new events only.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    /// The court that decides disputes. `None`: no host bond and no disputes;
    /// the host's list is final when published (as before v3).
    pub dao: Option<AccountId>,
    /// Receives the treasury share of lost bonds.
    pub treasury: AccountId,
    /// Host bond in deposits per seat (bond = deposit × capacity × this); 2–10 with a court, 0 without.
    pub bond_per_seat: u8,
    /// Deposit events stop taking guests at `starts_at` instead of `ends_at`. Required with a court.
    pub close_at_start: bool,
    /// Disputes are accepted for this many hours after the list is published.
    pub challenge_hours: u16,
    /// The host publishes the list within this many hours after `ends_at`.
    pub submit_hours: u16,
    /// The court decides within this many hours after the window; later, open disputes expire.
    pub resolve_hours: u16,
}

impl Rules {
    /// No court until the owner names one.
    fn new(treasury: AccountId) -> Self {
        Rules { dao: None, treasury, bond_per_seat: 0, close_at_start: true, challenge_hours: 12, submit_hours: 72, resolve_hours: 168 }
    }

    /// Refuses settings that reopen a hole the court closes (audit E-2, E-H1) or overflow.
    fn check(&self) {
        let court = self.dao.is_some();
        require!(court == (self.bond_per_seat > 0), "A court needs a host bond, and a bond needs a court");
        require!(self.dao.as_ref() != Some(&self.treasury), "The court cannot receive the lost bonds it decides");
        require!(!court || self.close_at_start, "With a court, registration must close at the start");
        // Below 2 deposits per seat a caught host's no-shows win back half the bond by disputing
        // their own lies ("dilution", audit 2); short hours let a host publish when nobody looks,
        // abandon an honest late host, or outrun the council's voting period.
        require!(
            self.bond_per_seat <= 10
                && (!court || self.bond_per_seat >= 2)
                && (12..=168).contains(&self.challenge_hours)
                && (24..=720).contains(&self.submit_hours)
                && (72..=720).contains(&self.resolve_hours),
            "Rules out of range: bond 2-10 deposits per seat with a court, window 12-168 h, publish 24-720 h, court 72-720 h"
        );
    }
}

#[near(serializers = [borsh])]
pub struct Event {
    pub host: AccountId,
    pub metadata: EventMetadata,
    /// What each guest pays: the deposit, or the ticket price in `Ticket` mode.
    pub deposit: u128,
    pub mode: EventMode,
    pub capacity: u32,
    pub status: EventStatus,
    pub guest_count: u32,
    /// Deposit: the host's list adjusted by upheld disputes; final once settled.
    pub attended_count: u32,
    pub payout_per_attendee: u128,
    pub created_at: u64,
    /// When the event was finalized, cancelled or refunded; 0 before.
    pub closed_at: u64,
    /// NEAR (yocto) the host paid for storage; 0 on the free tier.
    storage_paid: u128,
    /// Who may register; `None` lets everyone in.
    pub access: Option<AccessRule>,
    /// The owner's `Rules` when the event was created (Ticket: no court, no bond).
    pub rules: Rules,
    /// Deposit: USDC locked by the host; 0 until the `host_bond` message.
    pub host_bond: u128,
    /// Deposit: when the host published the list; 0 before.
    pub submitted_at: u64,
    pub open_disputes: u32,
    pub upheld_disputes: u32,
    pub dismissed_disputes: u32,
    /// Deposit: the host published no list; `refund` published an empty one.
    pub abandoned: bool,
}

/// Registration limited to guests with a history at the same host's earlier events.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AccessRule {
    /// The host's own finalized events the rule looks at, 1 to `MAX_RULE_EVENTS`.
    pub past_events: Vec<u64>,
    /// The guest came to at least this many of them.
    pub min_attended: u8,
    /// And skipped at most this many (registered, never checked in at an
    /// event someone attended). `None`: no limit.
    pub max_no_shows: Option<u8>,
    /// From this time (ms) anyone may register. `None`: never.
    pub open_to_all_at: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct AccessCheck {
    pub allowed: bool,
    /// Visits and no-shows among the rule's past events.
    pub attended: u8,
    pub no_shows: u8,
}

#[near(serializers = [json])]
pub struct EventView {
    pub id: u64,
    pub host: AccountId,
    pub metadata: EventMetadata,
    /// What each guest pays (deposit or ticket price, see `mode`).
    pub deposit: U128,
    pub mode: EventMode,
    pub capacity: u32,
    pub status: EventStatus,
    pub guest_count: u32,
    pub attended_count: u32,
    pub total_pool: U128,
    pub payout_per_attendee: U128,
    pub created_at: u64,
    pub closed_at: u64,
    pub access: Option<AccessRule>,
    /// The court of this event (`rules.dao`); `None`: the host's list is final.
    pub dao: Option<AccountId>,
    pub rules: Rules,
    /// Locked host bond; 0 until paid. Registration opens once it equals `bond_due`.
    pub host_bond: U128,
    /// The bond this event needs: deposit × capacity × `rules.bond_per_seat`; 0 for Ticket or without a court.
    pub bond_due: U128,
    /// Registration is accepted until this time (exclusive): `starts_at` for Deposit with
    /// `rules.close_at_start`, else `ends_at`.
    pub registration_ends_at: u64,
    pub submitted_at: u64,
    /// Disputes are accepted until this time (exclusive); 0 before the list.
    pub challenge_ends_at: u64,
    /// The DAO's verdicts are accepted until this time (exclusive); 0 before the list.
    pub resolve_by: u64,
    /// The host must publish the list by this time (inclusive), Deposit only.
    pub submit_by: u64,
    pub open_disputes: u32,
    pub upheld_disputes: u32,
    pub dismissed_disputes: u32,
    /// The host published no list in time; the empty list was published for them.
    pub abandoned: bool,
}

#[near(serializers = [json])]
pub struct GuestView {
    pub account_id: AccountId,
    pub status: GuestStatus,
    pub registered_at: u64,
    /// Deposit: on the host's published list.
    pub listed: bool,
}

#[near(serializers = [borsh])]
pub struct GuestRecord {
    pub status: GuestStatus,
    pub registered_at: u64,
    /// Deposit: the host's published list marks this guest as came.
    pub listed: bool,
    /// The dispute about this record, if any.
    pub dispute: Option<Dispute>,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Dispute {
    pub challenger: AccountId,
    /// The claim: the guest came (`true`) or did not (`false`).
    pub attended: bool,
    pub created_at: u64,
    /// Paid through NEAR Intents, which names the challenger without proof.
    pub via_intents: bool,
    /// The DAO's verdict: `true` = the challenger is right.
    pub upheld: Option<bool>,
}

#[near(serializers = [json])]
pub struct DisputeView {
    pub target: AccountId,
    pub challenger: AccountId,
    pub attended: bool,
    pub created_at: u64,
    pub via_intents: bool,
    pub upheld: Option<bool>,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub usdc: AccountId,
    pub intents: Option<AccountId>,
    pub relayer: Option<AccountId>,
    pub owner: AccountId,
    /// True once `freeze` ran: the code can never change again.
    pub frozen: bool,
    /// On: only whitelisted hosts can create events.
    pub whitelist_mode: bool,
    /// On: only sponsored hosts get the free tier.
    pub sponsored_mode: bool,
    /// What new events copy.
    pub rules: Rules,
    /// 3 600 000 (1 h) in a release build; 10 000 only in a testnet rehearsal build.
    pub oracle_hour_ms: u64,
}

/// `msg` accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Take a seat for the sender. `guest` is only for payments relayed by
    /// NEAR Intents; from anyone else it must be absent or equal the sender.
    Register { event_id: u64, guest: Option<AccountId> },
    /// Lock the host bond of a Deposit event; anyone may pay it, it belongs to the host.
    HostBond { event_id: u64 },
    /// Dispute the host's record of `target`, claiming `attended`. The
    /// challenger is the sender, or `guest` for NEAR Intents payments.
    Dispute { event_id: u64, target: AccountId, attended: bool, guest: Option<AccountId> },
}

/// `msg` accepted by `on_auth`: the same actions as the direct methods, done
/// by the Intents account that signed the `auth_call` intent.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AuthMsg {
    CreateEvent { metadata: EventMetadata, deposit: U128, capacity: u32, mode: Option<EventMode>, access: Option<AccessRule> },
    Finalize { event_id: u64, attended: Vec<AccountId> },
    Cancel { event_id: u64 },
    SetWhitelistMode { enabled: bool },
    AddToWhitelist { accounts: Vec<AccountId> },
    RemoveFromWhitelist { accounts: Vec<AccountId> },
    SetSponsoredMode { enabled: bool },
    AddSponsored { accounts: Vec<AccountId> },
    RemoveSponsored { accounts: Vec<AccountId> },
}

/// The two owner-run host lists.
#[derive(Clone, Copy)]
enum HostList {
    /// When its mode is on, only these hosts can create events.
    Whitelist,
    /// When its mode is on, only these hosts get the free tier.
    Sponsored,
}

impl HostList {
    fn name(self) -> &'static str {
        match self {
            HostList::Whitelist => "whitelist",
            HostList::Sponsored => "sponsored",
        }
    }
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Default)]
struct Balance {
    available: u128,
    pending: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    usdc: AccountId,
    /// NEAR Intents verifier (`intents.near` on mainnet).
    intents: Option<AccountId>,
    events: Vector<Event>,
    guests: LookupMap<(u64, AccountId), GuestRecord>,
    guest_index: LookupMap<(u64, u32), AccountId>,
    balances: LookupMap<AccountId, Balance>,
    reserved_bytes: u64,
    /// Optional account allowed to call `payout_to_intents` for other users (web relayer).
    relayer: Option<AccountId>,
    /// Upgrades the code until `frozen`, runs both host lists and the dispute settings.
    owner: AccountId,
    frozen: bool,
    /// When on, only whitelisted hosts can create events.
    whitelist_mode: bool,
    whitelist: LookupSet<AccountId>,
    /// When on, only sponsored hosts get the free tier.
    sponsored_mode: bool,
    sponsored: LookupSet<AccountId>,
    /// Creation times of each host's last `FREE_MAX_EVENTS` free events, oldest first.
    free_log: LookupMap<AccountId, [u64; FREE_MAX_EVENTS]>,
    /// The settings new events copy (`set_rules`).
    rules: Rules,
}

/// The state root before v3 (the tp7 escrow on mainnet): the same fields
/// without `rules`. The collections keep their storage prefixes.
#[near(serializers = [borsh])]
struct V2State {
    usdc: AccountId,
    intents: Option<AccountId>,
    events: Vector<Event>,
    guests: LookupMap<(u64, AccountId), GuestRecord>,
    guest_index: LookupMap<(u64, u32), AccountId>,
    balances: LookupMap<AccountId, Balance>,
    reserved_bytes: u64,
    /// v2's on-chain attendance counter (prefix `AttendedEvents`); dropped, the score lives off-chain.
    _attended_events: LookupMap<AccountId, u32>,
    relayer: Option<AccountId>,
    owner: AccountId,
    frozen: bool,
    whitelist_mode: bool,
    whitelist: LookupSet<AccountId>,
    sponsored_mode: bool,
    sponsored: LookupSet<AccountId>,
    free_log: LookupMap<AccountId, [u64; FREE_MAX_EVENTS]>,
}

#[near]
impl Contract {
    /// Starts without a court (`Rules::new`); the owner names one with `set_rules`.
    #[init]
    #[private]
    pub fn new(usdc: AccountId, intents: Option<AccountId>, relayer: Option<AccountId>, owner: AccountId) -> Self {
        require_rehearsal_network();
        Self {
            usdc,
            intents,
            events: Vector::new(StorageKey::Events),
            guests: LookupMap::new(StorageKey::Guests),
            guest_index: LookupMap::new(StorageKey::GuestIndex),
            balances: LookupMap::new(StorageKey::Balances),
            relayer,
            reserved_bytes: 0,
            rules: Rules::new(owner.clone()),
            owner,
            frozen: false,
            whitelist_mode: false,
            whitelist: LookupSet::new(StorageKey::Whitelist),
            sponsored_mode: false,
            sponsored: LookupSet::new(StorageKey::Sponsored),
            free_log: LookupMap::new(StorageKey::FreeLog),
        }
    }

    // ---------------------------------------------------------------- host

    /// Creates an event hosted by the caller. Free tier (see the crate docs):
    /// the contract pays for storage and any attached NEAR is returned.
    /// Otherwise the caller attaches at least `create_event_cost` and gets
    /// the excess back. A Deposit event opens for registration once its host
    /// bond is paid.
    #[payable]
    pub fn create_event(
        &mut self,
        metadata: EventMetadata,
        deposit: U128,
        capacity: u32,
        mode: Option<EventMode>,
        access: Option<AccessRule>,
    ) -> u64 {
        let attached = env::attached_deposit().as_yoctonear();
        self.create_event_for(env::predecessor_account_id(), metadata, deposit, capacity, mode, access, attached)
    }

    /// Host only, once `ends_at` has passed, with the guests who came
    /// (`attended`, checked in at the door off-chain). Unknown accounts fail
    /// the call, duplicates count once.
    /// `Deposit`: publishes the list (within `rules.submit_hours`). With a court
    /// the dispute window opens and `settle` pays out later; without one it pays
    /// out now. With no guests it closes at once.
    /// `Ticket`: just closes the event; the host was paid at registration.
    #[payable]
    pub fn finalize(&mut self, event_id: u64, attended: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.finalize_by(&env::predecessor_account_id(), event_id, attended);
    }

    /// Cancels the event and refunds every guest deposit and the host bond
    /// (`Ticket` mode refunds nothing: the host already has the money).
    /// `Deposit`: the host only, before `starts_at` (any time before the bond).
    /// `Ticket`: the host any time while open; anyone else once
    /// `ABANDON_GRACE_MS` has passed after `ends_at`.
    #[payable]
    pub fn cancel(&mut self, event_id: u64) {
        near_sdk::assert_one_yocto();
        self.cancel_by(&env::predecessor_account_id(), event_id);
    }

    /// Entry point of the NEAR Intents `auth_call` intent: the verifier has
    /// checked the signature of `signer_id`, who then acts as the caller.
    /// No NEAR may be attached: the verifier would not refund it on failure,
    /// so paid (beyond free tier) events need a NEAR wallet.
    #[payable]
    pub fn on_auth(&mut self, signer_id: AccountId, msg: String) -> PromiseOrValue<()> {
        require!(Some(&env::predecessor_account_id()) == self.intents.as_ref(), "Only the NEAR Intents verifier");
        require!(env::attached_deposit().is_zero(), "Attach no NEAR to Intents calls");
        let action: AuthMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"));
        match action {
            AuthMsg::CreateEvent { metadata, deposit, capacity, mode, access } => {
                self.create_event_for(signer_id, metadata, deposit, capacity, mode, access, 0);
            }
            AuthMsg::Finalize { event_id, attended } => self.finalize_by(&signer_id, event_id, attended),
            AuthMsg::Cancel { event_id } => self.cancel_by(&signer_id, event_id),
            AuthMsg::SetWhitelistMode { enabled } => self.set_list_mode(&signer_id, HostList::Whitelist, enabled),
            AuthMsg::AddToWhitelist { accounts } => self.list_add(&signer_id, HostList::Whitelist, accounts),
            AuthMsg::RemoveFromWhitelist { accounts } => self.list_remove(&signer_id, HostList::Whitelist, accounts),
            AuthMsg::SetSponsoredMode { enabled } => self.set_list_mode(&signer_id, HostList::Sponsored, enabled),
            AuthMsg::AddSponsored { accounts } => self.list_add(&signer_id, HostList::Sponsored, accounts),
            AuthMsg::RemoveSponsored { accounts } => self.list_remove(&signer_id, HostList::Sponsored, accounts),
        }
        PromiseOrValue::Value(())
    }

    // ------------------------------------------------------------- disputes

    /// The event's DAO only (`dao` in `get_event`), through an approved
    /// proposal. `upheld = true`: the challenger is right. Before
    /// `resolve_by`, once per dispute; anything else panics, so the proposal
    /// fails and nothing changes.
    pub fn resolve_dispute(&mut self, event_id: u64, target: AccountId, upheld: bool) {
        let event = self.event(event_id);
        require!(event.rules.dao.as_ref() == Some(&env::predecessor_account_id()), "Only this event's DAO");
        require!(event.status == EventStatus::Submitted, "Event is closed");
        require!(env::block_timestamp_ms() < resolve_by(event), "Too late: the dispute has expired");
        let record = self
            .guests
            .get_mut(&(event_id, target.clone()))
            .unwrap_or_else(|| env::panic_str("Not a guest of this event"));
        let dispute = record.dispute.as_mut().unwrap_or_else(|| env::panic_str("No dispute about this guest"));
        require!(dispute.upheld.is_none(), "This dispute is already resolved");
        dispute.upheld = Some(upheld);
        let (claim, challenger) = (dispute.attended, dispute.challenger.clone());
        let event = self.event_mut(event_id);
        event.open_disputes -= 1;
        if upheld {
            event.upheld_disputes += 1;
            if claim {
                event.attended_count += 1;
            } else {
                event.attended_count -= 1;
            }
        } else {
            event.dismissed_disputes += 1;
        }
        emit(
            "dispute_resolved",
            json!({ "event_id": event_id, "target": target, "challenger": challenger, "upheld": upheld }),
        );
    }

    /// Pays out a Deposit event once the dispute window is over and no
    /// dispute is waiting for the DAO (or `resolve_by` has passed). Anyone may call it.
    pub fn settle(&mut self, event_id: u64) {
        let now = env::block_timestamp_ms();
        let event = self.event(event_id);
        require!(event.status == EventStatus::Submitted, "Nothing to settle");
        require!(now >= challenge_ends_at(event), "The dispute window is still open");
        require!(event.open_disputes == 0 || now >= resolve_by(event), "Disputes are waiting for the DAO");
        self.settle_money(event_id);
    }

    /// For a Deposit event whose host published no list by `submit_by`: anyone
    /// publishes an empty list in the host's place and opens the dispute window
    /// (then `settle`; the host bond is lost, see the crate docs). With no
    /// guests the event just closes (`Refunded`) and the bond goes back.
    pub fn refund(&mut self, event_id: u64) {
        let event = self.event(event_id);
        require!(event.mode == EventMode::Deposit, "Only Deposit events are refunded");
        require!(event.status == EventStatus::Open, "Nothing to refund");
        require!(env::block_timestamp_ms() > submit_by(event), "The host can still publish the list");
        // Without a list a host's sybils and its no-shows could all walk away
        // refunded; an empty list keeps the attendees' claims alive.
        self.publish(event_id, true);
    }

    // --------------------------------------------------------------- owner

    /// The settings (`Rules`) for events created from now on: each event keeps
    /// its copy, so running events (also after `freeze`) cannot be changed.
    /// Owner only.
    #[payable]
    pub fn set_rules(&mut self, rules: Rules) {
        near_sdk::assert_one_yocto();
        self.require_owner(&env::predecessor_account_id());
        rules.check();
        self.rules = rules;
        emit("rules_set", json!(self.rules));
    }

    /// Whitelist mode on: only whitelisted hosts can create events. Owner only.
    #[payable]
    pub fn set_whitelist_mode(&mut self, enabled: bool) {
        near_sdk::assert_one_yocto();
        self.set_list_mode(&env::predecessor_account_id(), HostList::Whitelist, enabled);
    }

    /// Owner only. Up to 100 accounts per call; storage comes from the pool.
    #[payable]
    pub fn add_to_whitelist(&mut self, accounts: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.list_add(&env::predecessor_account_id(), HostList::Whitelist, accounts);
    }

    #[payable]
    pub fn remove_from_whitelist(&mut self, accounts: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.list_remove(&env::predecessor_account_id(), HostList::Whitelist, accounts);
    }

    /// Sponsored mode on: only sponsored hosts get the free tier. Owner only.
    #[payable]
    pub fn set_sponsored_mode(&mut self, enabled: bool) {
        near_sdk::assert_one_yocto();
        self.set_list_mode(&env::predecessor_account_id(), HostList::Sponsored, enabled);
    }

    /// Owner only. Up to 100 accounts per call; storage comes from the pool.
    #[payable]
    pub fn add_sponsored(&mut self, accounts: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.list_add(&env::predecessor_account_id(), HostList::Sponsored, accounts);
    }

    #[payable]
    pub fn remove_sponsored(&mut self, accounts: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.list_remove(&env::predecessor_account_id(), HostList::Sponsored, accounts);
    }

    /// Replaces the code with the call input (raw WASM, not JSON) and runs
    /// the new code's `migrate` in the same batch: if `migrate` fails, the old
    /// code stays. Owner only, until `freeze`.
    #[payable]
    pub fn upgrade(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        require!(!self.frozen, "The code is frozen");
        let code = env::input()
            .filter(|code| !code.is_empty())
            .unwrap_or_else(|| env::panic_str("Pass the new WASM as the call input"));
        emit("upgrade", json!({ "code_bytes": code.len() }));
        Promise::new(env::current_account_id())
            .deploy_contract(code)
            .function_call("migrate".to_string(), Vec::new(), NearToken::from_yoctonear(0), GAS_MIGRATE)
            .as_return()
    }

    /// Run by `upgrade` on the new code: keeps a v3 root, or turns the older
    /// root (tp7, mainnet) into v3 with no court yet. The older `Event` records
    /// do not decode as v3, so that path needs an escrow without events; any
    /// panic here rolls the whole upgrade back.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        // An `upgrade` to a rehearsal build would shrink the deadlines of running events.
        require_rehearsal_network();
        let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        if let Ok(state) = near_sdk::borsh::from_slice::<Self>(&raw) {
            return state;
        }
        let old: V2State = near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("Unknown state layout"));
        require!(old.events.len() == 0, "Events exist: their records need a migration");
        Self {
            usdc: old.usdc,
            intents: old.intents,
            events: old.events,
            guests: old.guests,
            guest_index: old.guest_index,
            balances: old.balances,
            reserved_bytes: old.reserved_bytes,
            relayer: old.relayer,
            rules: Rules::new(old.owner.clone()),
            owner: old.owner,
            frozen: old.frozen,
            whitelist_mode: old.whitelist_mode,
            whitelist: old.whitelist,
            sponsored_mode: old.sponsored_mode,
            sponsored: old.sponsored,
            free_log: old.free_log,
        }
    }

    /// Makes the code permanent: `upgrade` stops working for good. One-way.
    /// The owner keeps running both host lists and the dispute settings.
    #[payable]
    pub fn freeze(&mut self) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        require!(!self.frozen, "Already frozen");
        self.frozen = true;
        emit("code_frozen", json!({}));
    }

    // --------------------------------------------------------------- guest

    /// Withdraws USDC from the internal balance. `receiver_id` defaults to the
    /// caller. With `to_intents`, the USDC is deposited into the receiver's
    /// NEAR Intents balance, from where it can be swapped or sent to any chain.
    /// Requires 1 yoctoNEAR so only a full-access key can move funds.
    #[payable]
    pub fn withdraw(
        &mut self,
        amount: Option<U128>,
        receiver_id: Option<AccountId>,
        to_intents: Option<bool>,
    ) -> Promise {
        near_sdk::assert_one_yocto();
        let owner = env::predecessor_account_id();
        let receiver = receiver_id.unwrap_or_else(|| owner.clone());
        self.send_out(owner, receiver, amount, to_intents.unwrap_or(false))
    }

    /// Moves an account's balance into that same account's NEAR Intents
    /// balance. Only the owner or the configured relayer may call it — funds
    /// still can only go to that owner. The relayer path is how guests who
    /// signed in with an EVM or Solana wallet get paid: their NEAR Events
    /// account is their Intents account (e.g. `0xabc…`), which cannot call
    /// this contract itself.
    pub fn payout_to_intents(&mut self, account_id: AccountId, amount: Option<U128>) -> Promise {
        let predecessor = env::predecessor_account_id();
        require!(
            predecessor == account_id || Some(&predecessor) == self.relayer.as_ref(),
            "Only the owner or the relayer"
        );
        self.send_out(account_id.clone(), account_id, amount, true)
    }

    /// Restores whatever did not leave the contract.
    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, amount: U128, to_intents: bool) -> U128 {
        let sent = match env::promise_result_checked(0, 64) {
            Ok(value) if to_intents => {
                serde_json::from_slice::<U128>(&value).map(|u| u.0.min(amount.0)).unwrap_or(0)
            }
            Ok(_) => amount.0,
            Err(_) => 0,
        };
        let unsent = amount.0 - sent;
        let balance = self.balances.get_mut(&owner).expect("Missing pending withdrawal");
        balance.pending -= amount.0;
        balance.available += unsent;
        if balance.available == 0 && balance.pending == 0 {
            self.balances.remove(&owner);
        }
        if unsent > 0 {
            emit("withdraw_failed", json!({ "account_id": owner, "amount": U128(unsent) }));
        }
        U128(sent)
    }

    // --------------------------------------------------------------- views

    pub fn get_event(&self, event_id: u64) -> Option<EventView> {
        self.events.get(u32::try_from(event_id).ok()?).map(|e| view_event(event_id, e))
    }

    /// The newest events first, up to 100.
    pub fn get_recent_events(&self, limit: Option<u64>) -> Vec<EventView> {
        let limit = limit.unwrap_or(50).min(100);
        let end = u64::from(self.events.len());
        (end.saturating_sub(limit)..end).rev()
            .map(|id| view_event(id, &self.events[id as u32]))
            .collect()
    }

    /// Every event in creation order, a page of up to 100 from `from_index`.
    pub fn get_events(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<EventView> {
        let from = from_index.unwrap_or(0);
        let end = u64::from(self.events.len()).min(from.saturating_add(limit.unwrap_or(50).min(100)));
        (from..end).map(|id| view_event(id, &self.events[id as u32])).collect()
    }

    pub fn get_guests(&self, event_id: u64, from_index: Option<u32>, limit: Option<u32>) -> Vec<GuestView> {
        self.guest_page(event_id, from_index, limit)
            .map(|(account, record)| GuestView {
                account_id: account,
                status: record.status,
                registered_at: record.registered_at,
                listed: record.listed,
            })
            .collect()
    }

    /// Disputes among the guests at indexes `from_index..from_index + limit`
    /// (registration order), so pages line up with `get_guests`.
    pub fn get_disputes(&self, event_id: u64, from_index: Option<u32>, limit: Option<u32>) -> Vec<DisputeView> {
        self.guest_page(event_id, from_index, limit)
            .filter_map(|(target, record)| {
                record.dispute.as_ref().map(|d| DisputeView {
                    target,
                    challenger: d.challenger.clone(),
                    attended: d.attended,
                    created_at: d.created_at,
                    via_intents: d.via_intents,
                    upheld: d.upheld,
                })
            })
            .collect()
    }

    pub fn get_guest_status(&self, event_id: u64, account_id: AccountId) -> Option<GuestStatus> {
        self.guests.get(&(event_id, account_id)).map(|r| r.status)
    }

    pub fn get_guest_statuses(&self, account_id: AccountId, event_ids: Vec<u64>) -> Vec<Option<GuestStatus>> {
        require!(event_ids.len() <= MAX_VIEW_PAGE as usize, "Too many events");
        event_ids.into_iter().map(|id| self.get_guest_status(id, account_id.clone())).collect()
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance(&account_id))
    }

    /// Whether `account_id` may register under the event's access rule right
    /// now, with their visits and no-shows among the rule's past events.
    pub fn check_access(&self, event_id: u64, account_id: AccountId) -> AccessCheck {
        self.access_check(event_id, &account_id)
    }

    /// NEAR (yocto) `host` must attach to create an event of `capacity` seats
    /// now; 0 on the free tier. Pass `ends_at` to apply the free tier's end
    /// date limit as well. With the whitelist mode on, check `can_create` too.
    pub fn create_event_cost(&self, host: AccountId, capacity: u32, ends_at: Option<u64>) -> U128 {
        U128(self.event_cost(&host, capacity, ends_at))
    }

    /// Whether `host` may create events at all (whitelist mode).
    pub fn can_create(&self, host: AccountId) -> bool {
        !self.whitelist_mode || self.whitelist.contains(&host)
    }

    pub fn is_whitelisted(&self, account_id: AccountId) -> bool {
        self.whitelist.contains(&account_id)
    }

    pub fn is_sponsored(&self, account_id: AccountId) -> bool {
        self.sponsored.contains(&account_id)
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            usdc: self.usdc.clone(),
            intents: self.intents.clone(),
            relayer: self.relayer.clone(),
            owner: self.owner.clone(),
            frozen: self.frozen,
            whitelist_mode: self.whitelist_mode,
            sponsored_mode: self.sponsored_mode,
            rules: self.rules.clone(),
            oracle_hour_ms: ORACLE_HOUR_MS,
        }
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Returns the unused amount to the token resolver. A `host_bond` or
    /// `dispute` that the escrow refuses panics, so the resolver returns all of it.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        let msg: TransferMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"));
        match msg {
            TransferMsg::Register { event_id, guest } => {
                let named = guest.clone().unwrap_or_else(|| sender_id.clone());
                // Everyone else registers only themselves; paying for another guest is refused.
                if let (Some(guest), _) = self.payer(&sender_id, guest) {
                    if let Some(deposit) = self.get_event_deposit(event_id) {
                        if amount.0 >= deposit && self.refusal(event_id, &guest).is_none() {
                            self.register(event_id, guest, sender_id);
                            return PromiseOrValue::Value(U128(amount.0 - deposit));
                        }
                    }
                }
                emit("register_failed", json!({ "event_id": event_id, "guest": named, "amount": amount }));
                PromiseOrValue::Value(amount)
            }
            TransferMsg::HostBond { event_id } => {
                let bond = self.lock_host_bond(event_id, amount.0, &sender_id);
                PromiseOrValue::Value(U128(amount.0 - bond))
            }
            TransferMsg::Dispute { event_id, target, attended, guest } => {
                let (challenger, via_intents) = self.payer(&sender_id, guest);
                let challenger = challenger.unwrap_or_else(|| env::panic_str("Dispute only in your own name"));
                let bond = self.open_dispute(event_id, challenger, via_intents, target, attended, amount.0);
                PromiseOrValue::Value(U128(amount.0 - bond))
            }
        }
    }
}

impl Contract {
    fn create_event_for(
        &mut self,
        host: AccountId,
        metadata: EventMetadata,
        deposit: U128,
        capacity: u32,
        mode: Option<EventMode>,
        access: Option<AccessRule>,
        attached: u128,
    ) -> u64 {
        let mode = mode.unwrap_or_default();
        require!(self.can_create(host.clone()), "Only whitelisted hosts can create events");
        validate_metadata(&metadata);
        if let Some(rule) = &access {
            self.validate_access(&host, &metadata, rule);
        }
        require!(deposit.0 >= MIN_DEPOSIT, "Deposit must be at least 0.1 USDC");
        // The host bond and every pool sum must fit in u128: the largest is the
        // bond at 10 deposits × 300 seats × HOST_TREASURY_BPS in `split_lost` (1.5e7 deposits).
        require!(deposit.0 <= u128::MAX / 1_000_000_000, "Deposit is too large");
        require!(capacity > 0 && capacity <= MAX_CAPACITY, "Capacity out of range");
        let mut rules = self.rules.clone();
        if mode == EventMode::Ticket {
            // Tickets are paid at registration: nothing for a court to decide.
            (rules.dao, rules.bond_per_seat) = (None, 0);
        }
        require!(rules.dao.as_ref() != Some(&host), "The dispute DAO cannot host a Deposit event it would judge");
        // A host who is the treasury would win back its own lost bond.
        require!(rules.dao.is_none() || rules.treasury != host, "The treasury cannot host a Deposit event");
        let dao = rules.dao.clone();
        // The whole event, full house included, must be paid for up front.
        let reserve = SEAT_BYTES * u64::from(capacity) + EVENT_BALANCES_BYTES;
        let cost = self.event_cost(&host, capacity, Some(metadata.ends_at));
        if cost == 0 {
            self.require_storage_pool(EVENT_RECORD_BYTES + reserve + FREE_LOG_BYTES);
            let mut log = self.free_log.get(&host).copied().unwrap_or_default();
            log.rotate_left(1);
            log[FREE_MAX_EVENTS - 1] = env::block_timestamp_ms();
            self.free_log.insert(host.clone(), log);
        } else {
            require!(
                attached >= cost,
                format!(
                    "This event is beyond the free tier (up to {} seats, {} free events in 30 days, ending within 60 days{}). Attach {} yoctoNEAR for its storage",
                    FREE_MAX_CAPACITY,
                    FREE_MAX_EVENTS,
                    if self.sponsored_mode { ", sponsored hosts" } else { "" },
                    cost
                )
            );
        }
        if attached > cost {
            Promise::new(host.clone()).transfer(NearToken::from_yoctonear(attached - cost)).detach();
        }
        self.reserved_bytes += reserve;

        let id = self.events.len() as u64;
        self.events.push(Event {
            host: host.clone(),
            metadata,
            deposit: deposit.0,
            mode,
            capacity,
            status: EventStatus::Open,
            guest_count: 0,
            attended_count: 0,
            payout_per_attendee: 0,
            created_at: env::block_timestamp_ms(),
            closed_at: 0,
            storage_paid: cost,
            access,
            rules,
            host_bond: 0,
            submitted_at: 0,
            open_disputes: 0,
            upheld_disputes: 0,
            dismissed_disputes: 0,
            abandoned: false,
        });

        emit("event_created", json!({ "event_id": id, "host": host, "deposit": deposit, "mode": mode, "dao": dao }));
        id
    }

    fn finalize_by(&mut self, caller: &AccountId, event_id: u64, attended: Vec<AccountId>) {
        let event = self.event(event_id);
        require!(*caller == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        // Before the end the host can only cancel, which refunds everyone.
        require!(env::block_timestamp_ms() >= event.metadata.ends_at, "The event has not ended yet");
        let ticket = event.mode == EventMode::Ticket;
        require!(
            ticket || env::block_timestamp_ms() <= submit_by(event),
            "Too late to publish the list: the event can only be refunded"
        );
        require!(attended.len() <= MAX_CAPACITY as usize, "Too many accounts");

        let mut came = 0u32;
        for account in &attended {
            let record = self
                .guests
                .get_mut(&(event_id, account.clone()))
                .unwrap_or_else(|| env::panic_str(&format!("{} is not registered", account)));
            // Duplicates count once. Ticket: the final status now. Deposit: the host's claim, final at `settle`.
            if !record.listed {
                record.listed = true;
                if ticket {
                    record.status = GuestStatus::Attended;
                }
                came += 1;
            }
        }
        self.event_mut(event_id).attended_count = came;
        if ticket {
            return self.finalize_tickets(event_id);
        }
        self.publish(event_id, false);
    }

    /// Publishes a Deposit event's list (`abandoned`: the empty one `refund`
    /// publishes for the host). No guests: closes at once, bond back. No court:
    /// the list is final and pays out now; with one, the dispute window opens.
    fn publish(&mut self, event_id: u64, abandoned: bool) {
        let event = self.event_mut(event_id);
        let (n, came) = (event.guest_count, event.attended_count);
        if n == 0 {
            let status = if abandoned { EventStatus::Refunded } else { EventStatus::Finalized };
            return self.close_with_refunds(event_id, status);
        }
        event.status = EventStatus::Submitted;
        event.submitted_at = env::block_timestamp_ms();
        event.abandoned = abandoned;
        let (challenge_ends, court) = (challenge_ends_at(event), event.rules.dao.is_some());
        emit(
            "attendance_submitted",
            json!({ "event_id": event_id, "attended": came, "guests": n, "challenge_ends_at": challenge_ends, "abandoned": abandoned }),
        );
        if !court {
            self.settle_money(event_id);
        }
    }

    fn cancel_by(&mut self, caller: &AccountId, event_id: u64) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        if event.mode == EventMode::Deposit {
            require!(*caller == event.host, "Only the host can cancel");
            require!(
                event.host_bond == 0 || env::block_timestamp_ms() < event.metadata.starts_at,
                "The event has started: publish the list instead (everyone on it gets their deposit back)"
            );
        } else if *caller != event.host {
            require!(
                env::block_timestamp_ms() > event.metadata.ends_at + ABANDON_GRACE_MS,
                "Only the host can cancel before 30 days after the event ends"
            );
        }
        self.close_with_refunds(event_id, EventStatus::Cancelled);
    }

    /// Takes the host bond for a Deposit event that has none yet; returns the
    /// amount kept (exactly the bond). Panics otherwise, so all of it comes back.
    fn lock_host_bond(&mut self, event_id: u64, amount: u128, payer: &AccountId) -> u128 {
        let event = self.event(event_id);
        let bond = bond_due(event);
        require!(bond > 0, "This event takes no host bond");
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(env::block_timestamp_ms() < registration_ends(event), "Registration has closed");
        require!(event.host_bond == 0, "The host bond is already paid");
        require!(amount >= bond, format!("The host bond is {}", bond));
        let host = event.host.clone();
        self.event_mut(event_id).host_bond = bond;
        emit("host_bond_paid", json!({ "event_id": event_id, "host": host, "paid_by": payer, "amount": U128(bond) }));
        bond
    }

    /// Records a dispute; returns the bond kept (exactly the deposit). Panics
    /// on any broken rule, so the whole payment comes back.
    fn open_dispute(
        &mut self,
        event_id: u64,
        challenger: AccountId,
        via_intents: bool,
        target: AccountId,
        attended: bool,
        amount: u128,
    ) -> u128 {
        let now = env::block_timestamp_ms();
        let event = self.event(event_id);
        require!(event.status == EventStatus::Submitted, "Disputes open once the host publishes the list");
        require!(now < challenge_ends_at(event), "The dispute window is over");
        let bond = event.deposit;
        require!(amount >= bond, format!("The dispute bond is {} (one deposit)", bond));
        require!(self.guests.contains_key(&(event_id, challenger.clone())), "Only guests of this event can dispute");
        if attended {
            require!(challenger == target, "Only the guest can claim they came");
        } else {
            require!(challenger != target, "Nobody disputes their own presence");
        }
        let record = self
            .guests
            .get_mut(&(event_id, target.clone()))
            .unwrap_or_else(|| env::panic_str("Not a guest of this event"));
        require!(record.dispute.is_none(), "This record is already disputed");
        require!(record.listed != attended, "The host's list already says so");
        record.dispute = Some(Dispute { challenger: challenger.clone(), attended, created_at: now, via_intents, upheld: None });
        self.event_mut(event_id).open_disputes += 1;
        self.reserved_bytes -= DISPUTE_BYTES;
        emit(
            "dispute_opened",
            json!({ "event_id": event_id, "target": target, "challenger": challenger, "attended": attended, "via_intents": via_intents, "bond": U128(bond) }),
        );
        bond
    }

    /// The settlement of a Deposit event in one pass over its guests. Every
    /// unit in (pool + host bond + challenger bonds) is credited to someone.
    fn settle_money(&mut self, event_id: u64) {
        let e = self.event(event_id);
        let (host, d, n, a, w) = (e.host.clone(), e.deposit, e.guest_count, e.attended_count, e.upheld_disputes);
        let (bond, lost, dismissed, abandoned) = (e.host_bond, d * u128::from(e.dismissed_disputes), e.dismissed_disputes, e.abandoned);
        let pool = d * u128::from(n);
        // Nobody came: everyone gets the deposit back.
        let share = if a > 0 { pool / u128::from(a) } else { d };
        let (lost_part, mut treasury_total) = split_lost(lost, CHALLENGER_TREASURY_BPS, if a > 0 { a } else { n });
        let mut host_total = if a > 0 { pool - share * u128::from(a) } else { 0 };
        // The bond: to the winners if any record was proven wrong; an abandoned
        // event loses it anyway, to every guest; otherwise back to the host.
        let (mut win_part, mut guest_part) = (0, 0);
        if w > 0 || abandoned {
            let (mut part, mut rest) = split_lost(bond, HOST_TREASURY_BPS, if w > 0 { w } else { n });
            // A winner's prize is capped; guests of an abandoned event are not (they cannot cause it).
            if w > 0 && part > MAX_WIN_DEPOSITS * d {
                rest += (part - MAX_WIN_DEPOSITS * d) * u128::from(w);
                part = MAX_WIN_DEPOSITS * d;
            }
            treasury_total += rest;
            if w > 0 { win_part = part } else { guest_part = part }
        } else {
            host_total += bond;
        }
        let mut expired = 0u32;
        for i in 0..n {
            let account = self.guest_index[&(event_id, i)].clone();
            let record = &self.guests[&(event_id, account.clone())];
            let came = match &record.dispute {
                Some(dispute) if dispute.upheld == Some(true) => dispute.attended,
                _ => record.listed,
            };
            // Upheld: bond back plus a share of the host bond. Undecided by
            // `resolve_by`: expired, the host's record stands, bond back.
            let payback = record.dispute.as_ref().and_then(|dispute| match dispute.upheld {
                Some(true) => Some((dispute.challenger.clone(), d + win_part, false)),
                None => Some((dispute.challenger.clone(), d, true)),
                Some(false) => None,
            });
            if a == 0 || came {
                self.credit(&account, share + lost_part);
            }
            self.credit(&account, guest_part);
            if came {
                self.guests.get_mut(&(event_id, account)).unwrap().status = GuestStatus::Attended;
            }
            if let Some((challenger, amount, was_expired)) = payback {
                expired += u32::from(was_expired);
                self.credit(&challenger, amount);
            }
        }
        self.credit(&host, host_total);
        let treasury = self.event(event_id).rules.treasury.clone();
        self.credit(&treasury, treasury_total);
        let share = if a > 0 { share } else { 0 };
        self.event_mut(event_id).payout_per_attendee = share;
        self.mark_closed(event_id, EventStatus::Finalized);
        emit(
            "settled",
            json!({
                "event_id": event_id, "attended": a, "payout_per_attendee": U128(share),
                "upheld": w, "dismissed": dismissed, "expired": expired,
                "host": U128(host_total), "treasury": U128(treasury_total),
                "per_winner": U128(win_part), "per_taker_from_lost_bonds": U128(lost_part),
                "abandoned": abandoned, "bond_per_guest": U128(guest_part),
            }),
        );
    }

    /// Who a payment is for and whether NEAR Intents relayed it. Only the
    /// verifier may name another account (and must name one); from anyone
    /// else a different name gives `None`. Any Intents balance owner can name
    /// any account this way, so the name is unproven (`via_intents`).
    fn payer(&self, sender: &AccountId, named: Option<AccountId>) -> (Option<AccountId>, bool) {
        if Some(sender) == self.intents.as_ref() {
            // Otherwise the relay itself would take the seat or the dispute.
            require!(named.is_some(), "Payments via NEAR Intents must name the guest");
            return (named, true);
        }
        match named {
            Some(name) if name != *sender => (None, false),
            _ => (Some(sender.clone()), false),
        }
    }

    fn require_owner(&self, caller: &AccountId) {
        require!(*caller == self.owner, "Only the owner");
    }

    fn set_list_mode(&mut self, caller: &AccountId, list: HostList, enabled: bool) {
        self.require_owner(caller);
        match list {
            HostList::Whitelist => self.whitelist_mode = enabled,
            HostList::Sponsored => self.sponsored_mode = enabled,
        }
        emit(&format!("{}_mode", list.name()), json!({ "enabled": enabled }));
    }

    fn list_mut(&mut self, list: HostList) -> &mut LookupSet<AccountId> {
        match list {
            HostList::Whitelist => &mut self.whitelist,
            HostList::Sponsored => &mut self.sponsored,
        }
    }

    fn list_add(&mut self, caller: &AccountId, list: HostList, accounts: Vec<AccountId>) {
        self.require_owner(caller);
        require!(!accounts.is_empty() && accounts.len() <= MAX_WHITELIST_BATCH, "Pass 1 to 100 accounts");
        self.require_storage_pool(WHITELIST_BYTES * accounts.len() as u64);
        for account in &accounts {
            self.list_mut(list).insert(account.clone());
        }
        emit(&format!("{}_added", list.name()), json!({ "accounts": accounts }));
    }

    fn list_remove(&mut self, caller: &AccountId, list: HostList, accounts: Vec<AccountId>) {
        self.require_owner(caller);
        require!(!accounts.is_empty() && accounts.len() <= MAX_WHITELIST_BATCH, "Pass 1 to 100 accounts");
        for account in &accounts {
            self.list_mut(list).remove(account);
        }
        emit(&format!("{}_removed", list.name()), json!({ "accounts": accounts }));
    }

    /// Fewer than `FREE_MAX_EVENTS` free events in the last `FREE_WINDOW_MS`.
    fn free_slot_open(&self, host: &AccountId) -> bool {
        let oldest = self.free_log.get(host).map_or(0, |log| log[0]);
        oldest == 0 || env::block_timestamp_ms() >= oldest + FREE_WINDOW_MS
    }

    /// Storage cost of a new event; 0 when free.
    fn event_cost(&self, host: &AccountId, capacity: u32, ends_at: Option<u64>) -> u128 {
        let free = capacity <= FREE_MAX_CAPACITY
            && self.free_slot_open(host)
            && ends_at.map_or(true, |end| end <= env::block_timestamp_ms() + FREE_MAX_HORIZON_MS)
            && (!self.sponsored_mode || self.sponsored.contains(host));
        if free {
            0
        } else {
            bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * u64::from(capacity) + EVENT_BALANCES_BYTES)
        }
    }

    /// `Ticket` mode close: the host was credited at each registration, so
    /// this only closes the event. `paid_to_host` is logged for indexers.
    fn finalize_tickets(&mut self, event_id: u64) {
        let event = self.event(event_id);
        let total = event.deposit * event.guest_count as u128;
        let attended = event.attended_count;
        self.mark_closed(event_id, EventStatus::Finalized);
        emit(
            "finalized",
            json!({ "event_id": event_id, "mode": EventMode::Ticket, "attended": attended, "paid_to_host": U128(total) }),
        );
    }

    fn validate_access(&self, host: &AccountId, metadata: &EventMetadata, rule: &AccessRule) {
        let n = rule.past_events.len();
        require!(n >= 1 && n <= MAX_RULE_EVENTS, "An access rule lists 1 to 10 past events");
        for (i, id) in rule.past_events.iter().enumerate() {
            require!(!rule.past_events[..i].contains(id), "Past events repeat");
            let past = self.event(*id);
            require!(past.host == *host, "Past events must be your own");
            require!(past.status == EventStatus::Finalized, "Past events must be finalized");
        }
        require!(
            usize::from(rule.min_attended) <= n && rule.max_no_shows.map_or(true, |m| usize::from(m) <= n),
            "The rule asks for more than its past events"
        );
        require!(rule.min_attended > 0 || rule.max_no_shows.is_some(), "The rule lets everyone in");
        require!(
            rule.open_to_all_at.map_or(true, |at| at < metadata.ends_at),
            "Open the event to all before it ends"
        );
    }

    fn access_check(&self, event_id: u64, guest: &AccountId) -> AccessCheck {
        let Some(rule) = &self.event(event_id).access else {
            return AccessCheck { allowed: true, attended: 0, no_shows: 0 };
        };
        let (mut attended, mut no_shows) = (0u8, 0u8);
        for &id in &rule.past_events {
            match self.guests.get(&(id, guest.clone())).map(|r| r.status) {
                Some(GuestStatus::Attended) => attended += 1,
                // An event closed with nobody checked in refunded everyone: not a no-show.
                Some(GuestStatus::Registered) if self.event(id).attended_count > 0 => no_shows += 1,
                _ => {}
            }
        }
        let open = rule.open_to_all_at.map_or(false, |at| env::block_timestamp_ms() >= at);
        let allowed = open || (attended >= rule.min_attended && rule.max_no_shows.map_or(true, |m| no_shows <= m));
        AccessCheck { allowed, attended, no_shows }
    }

    fn get_event_deposit(&self, event_id: u64) -> Option<u128> {
        self.events.get(u32::try_from(event_id).ok()?).map(|event| event.deposit)
    }

    fn guest_page(
        &self,
        event_id: u64,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> impl Iterator<Item = (AccountId, &GuestRecord)> + '_ {
        let count = self.event(event_id).guest_count;
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(MAX_CAPACITY);
        (from..(from.saturating_add(limit)).min(count)).map(move |i| {
            let account = self.guest_index[&(event_id, i)].clone();
            let record = &self.guests[&(event_id, account.clone())];
            (account, record)
        })
    }

    fn unreserved_storage(&self) -> u128 {
        free_storage_balance().saturating_sub(bytes_cost(self.reserved_bytes))
    }

    fn require_storage_pool(&self, bytes: u64) {
        require!(
            self.unreserved_storage() >= bytes_cost(bytes),
            "Near Events storage pool is empty, please try again later"
        );
    }

    /// Releases the event's unused reservation. A host who paid for storage
    /// gets back the share nobody used (empty seats, disputes never filed);
    /// the event record stays paid.
    fn mark_closed(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event_mut(event_id);
        event.status = status;
        event.closed_at = env::block_timestamp_ms();
        let host = event.host.clone();
        let empty = u64::from(event.capacity - event.guest_count);
        let filed = u64::from(event.open_disputes + event.upheld_disputes + event.dismissed_disputes);
        let unused_disputes = u64::from(event.guest_count) - filed;
        let release = SEAT_BYTES * empty + SETTLE_BYTES * u64::from(event.guest_count) - DISPUTE_BYTES * filed
            + EVENT_BALANCES_BYTES;
        let refund = bytes_cost(SEAT_BYTES * empty + DISPUTE_BYTES * unused_disputes)
            .min(event.storage_paid.saturating_sub(bytes_cost(EVENT_RECORD_BYTES + EVENT_BALANCES_BYTES)));
        self.reserved_bytes -= release;
        if refund > 0 {
            emit("storage_refund", json!({ "event_id": event_id, "host": host, "amount": U128(refund) }));
            Promise::new(host).transfer(NearToken::from_yoctonear(refund)).detach();
        }
    }

    fn event(&self, event_id: u64) -> &Event {
        self.events
            .get(u32::try_from(event_id).unwrap_or(u32::MAX))
            .unwrap_or_else(|| env::panic_str("Event not found"))
    }

    fn event_mut(&mut self, event_id: u64) -> &mut Event {
        self.events
            .get_mut(u32::try_from(event_id).unwrap_or(u32::MAX))
            .unwrap_or_else(|| env::panic_str("Event not found"))
    }

    fn send_out(&mut self, owner: AccountId, receiver: AccountId, amount: Option<U128>, to_intents: bool) -> Promise {
        let balance = self.balance(&owner);
        let amount = amount.map(|a| a.0).unwrap_or(balance);
        require!(amount > 0, "Nothing to withdraw");
        require!(amount <= balance, "Not enough balance");
        let entry = self.balances.get_mut(&owner).expect("Missing balance");
        entry.available -= amount;
        entry.pending += amount;
        emit(
            "withdraw",
            json!({ "account_id": owner, "receiver_id": receiver, "amount": U128(amount), "to_intents": to_intents }),
        );

        let token = ext_ft::ext(self.usdc.clone()).with_attached_deposit(NearToken::from_yoctonear(1));
        let transfer = if to_intents {
            let intents = self.intents.clone().unwrap_or_else(|| env::panic_str("Intents not configured"));
            // intents.near credits the account named in `msg`.
            token
                .with_static_gas(GAS_FT_TRANSFER_CALL)
                .ft_transfer_call(intents, U128(amount), Some("Near Events payout".into()), receiver.to_string())
        } else {
            token
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(receiver, U128(amount), Some("Near Events payout".into()))
        };
        transfer.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_WITHDRAW_CALLBACK)
                .on_withdraw(owner, U128(amount), to_intents),
        )
    }

    fn keyless_ok(&self, guest: &AccountId) -> bool {
        !guest.as_str().starts_with("0x") || guest.as_str().len() != 42
            || (self.intents.is_some() && self.relayer.is_some())
    }

    /// Why `guest` cannot take a seat now, or `None`: the one list of
    /// registration rules (`ft_on_transfer` refunds on it, `register` panics).
    fn refusal(&self, event_id: u64, guest: &AccountId) -> Option<&'static str> {
        let event = self.event(event_id);
        if event.status != EventStatus::Open {
            return Some("Event is closed");
        }
        if env::block_timestamp_ms() >= registration_ends(event) {
            return Some("Registration has closed");
        }
        if event.guest_count >= event.capacity {
            return Some("Event is full");
        }
        // Events with a bond open once it is in; the host never takes a seat.
        if (bond_due(event) > 0 && event.host_bond == 0) || *guest == event.host {
            return Some("Registration needs the host bond, and the host cannot take a seat");
        }
        if self.guests.contains_key(&(event_id, guest.clone())) {
            return Some("Already registered");
        }
        if !self.keyless_ok(guest) {
            return Some("Keyless registration requires Intents and a relayer");
        }
        if !self.access_check(event_id, guest).allowed {
            return Some("Only regulars can register yet");
        }
        None
    }

    /// Every seat was reserved when the event was created, so a registration
    /// only moves its bytes from the reservation into real storage.
    fn register(&mut self, event_id: u64, guest: AccountId, paid_by: AccountId) {
        if let Some(why) = self.refusal(event_id, &guest) {
            env::panic_str(why);
        }
        let index = self.event(event_id).guest_count;
        self.reserved_bytes -= STORAGE_BYTES_PER_GUEST;
        self.guests.insert(
            (event_id, guest.clone()),
            GuestRecord { status: GuestStatus::Registered, registered_at: env::block_timestamp_ms(), listed: false, dispute: None },
        );
        self.guest_index.insert((event_id, index), guest.clone());
        let event = self.event_mut(event_id);
        event.guest_count += 1;

        let (mode, host, deposit) = (event.mode, event.host.clone(), event.deposit);
        if mode == EventMode::Ticket {
            // The host's balance entry is already reserved (EVENT_BALANCES_BYTES per event).
            self.credit(&host, deposit);
        }

        emit("register", json!({ "event_id": event_id, "guest": guest, "paid_by": paid_by }));
    }

    /// Cancel: every deposit and the host bond come back.
    fn close_with_refunds(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event(event_id);
        let (deposit, guest_count, host, bond) = (event.deposit, event.guest_count, event.host.clone(), event.host_bond);
        // Ticket money went to the host at registration; nothing to refund.
        let guest_count = if event.mode == EventMode::Ticket { 0 } else { guest_count };
        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            self.credit(&account, deposit);
        }
        self.credit(&host, bond);
        self.mark_closed(event_id, status);
        emit("closed", json!({ "event_id": event_id, "status": status }));
    }

    fn balance(&self, account: &AccountId) -> u128 {
        self.balances.get(account).map_or(0, |balance| balance.available)
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount > 0 {
            self.balances.entry(account.clone()).or_default().available += amount;
        }
    }
}

/// A lost bond split: `bps` of it plus the rounding remainder go to the
/// treasury, the rest equally to `takers`. Returns (per taker, treasury).
fn split_lost(amount: u128, bps: u128, takers: u32) -> (u128, u128) {
    if takers == 0 {
        return (0, amount);
    }
    let part = (amount - amount * bps / BPS) / u128::from(takers);
    (part, amount - part * u128::from(takers))
}

/// A `short-windows` build only on testnet or in the sandbox, at init and at upgrade.
fn require_rehearsal_network() {
    let account = env::current_account_id();
    require!(
        !cfg!(feature = "short-windows") || account.as_str().ends_with(".testnet") || account.as_str().ends_with(".test.near"),
        "A short-windows build runs on testnet only"
    );
}

fn hours(h: u16) -> u64 {
    u64::from(h) * ORACLE_HOUR_MS
}

/// Deposit events stop taking guests at `starts_at` (`close_at_start`): after that the host sees who came.
fn registration_ends(e: &Event) -> u64 {
    if e.mode == EventMode::Deposit && e.rules.close_at_start { e.metadata.starts_at } else { e.metadata.ends_at }
}

fn bond_due(e: &Event) -> u128 {
    if e.mode == EventMode::Deposit { e.deposit * u128::from(e.capacity) * u128::from(e.rules.bond_per_seat) } else { 0 }
}

fn challenge_ends_at(e: &Event) -> u64 {
    e.submitted_at + hours(e.rules.challenge_hours)
}

fn resolve_by(e: &Event) -> u64 {
    challenge_ends_at(e) + hours(e.rules.resolve_hours)
}

fn submit_by(e: &Event) -> u64 {
    e.metadata.ends_at + hours(e.rules.submit_hours)
}

fn bytes_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * bytes as u128
}

/// Contract NEAR not locked for storage already in use. NEAR attached to this
/// call is the caller's until kept, so it never counts as the pool.
fn free_storage_balance() -> u128 {
    env::account_balance()
        .as_yoctonear()
        .saturating_sub(env::attached_deposit().as_yoctonear())
        .saturating_sub(bytes_cost(env::storage_usage()))
}

fn validate_metadata(m: &EventMetadata) {
    require!(!m.title.trim().is_empty() && m.title.len() <= MAX_TITLE_LEN, "Bad title");
    require!(m.ends_at >= m.starts_at, "Event ends before it starts");
    require!(
        m.ends_at <= env::block_timestamp_ms() + MAX_EVENT_HORIZON_MS,
        "Event must end within a year"
    );
}

fn view_event(id: u64, e: &Event) -> EventView {
    let submitted = e.submitted_at > 0;
    EventView {
        id,
        host: e.host.clone(),
        metadata: e.metadata.clone(),
        deposit: U128(e.deposit),
        mode: e.mode,
        capacity: e.capacity,
        status: e.status,
        guest_count: e.guest_count,
        attended_count: e.attended_count,
        // Deposit mode: the pool attendees split. Ticket mode: ticket money
        // already credited to the host.
        total_pool: U128(e.deposit * e.guest_count as u128),
        payout_per_attendee: U128(e.payout_per_attendee),
        created_at: e.created_at,
        closed_at: e.closed_at,
        access: e.access.clone(),
        dao: e.rules.dao.clone(),
        rules: e.rules.clone(),
        host_bond: U128(e.host_bond),
        bond_due: U128(bond_due(e)),
        registration_ends_at: registration_ends(e),
        submitted_at: e.submitted_at,
        challenge_ends_at: if submitted { challenge_ends_at(e) } else { 0 },
        resolve_by: if submitted { resolve_by(e) } else { 0 },
        submit_by: if e.mode == EventMode::Deposit { submit_by(e) } else { 0 },
        open_disputes: e.open_disputes,
        upheld_disputes: e.upheld_disputes,
        dismissed_disputes: e.dismissed_disputes,
        abandoned: e.abandoned,
    }
}

/// NEP-297 event log.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "near-events", "version": "3.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
