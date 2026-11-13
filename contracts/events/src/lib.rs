//! Near Events — Kickback-style event escrow.
//!
//! Guests register by sending an equal USDC deposit with `ft_transfer_call`.
//! Check-in at the door happens off-chain (the host, the door team the host
//! keeps on the Near Events server, or the Telegram bot mark guests there).
//! The host then calls `finalize` once with the list of guests who came, and
//! the whole pool of deposits is split equally between them. No platform fee.
//!
//! Payouts land on an internal balance that the guest can withdraw to any
//! NEAR account, into their NEAR Intents balance (`intents.near`, from where
//! 1Click takes it to any chain).
//!
//! Intents registrations withdraw from the guest's own verifier balance.
//! The token resolver returns unused USDC to the sender, and the verifier
//! credits its original withdrawal owner. Never send solver-owned swaps
//! directly to the escrow.
//!
//! An event runs in one of two modes, never both. `Deposit` (the default) is
//! the Kickback pool above. `Ticket` is a plain paid ticket: the price is
//! credited to the host's balance right at registration; `finalize` and
//! `cancel` only close the event and refund nothing. The amount a guest pays
//! lives in `deposit` in both modes.
//!
//! A guest always pays for their own seat. Only the NEAR Intents verifier
//! names a guest other than the sender.
//!
//! Free tier: an event of up to `FREE_MAX_CAPACITY` seats that ends within
//! `FREE_MAX_HORIZON_MS` is free, up to `FREE_MAX_EVENTS` free events per host
//! in any `FREE_WINDOW_MS` (closing one early does not give its slot back).
//! With the sponsored mode on, only sponsored hosts get the free tier. The
//! contract pays for storage from its own NEAR balance, which the operator
//! keeps topped up. Anything else the host pays
//! for: `create_event` takes the storage cost (`create_event_cost`) as
//! attached NEAR, returns the excess, and gives back the share of empty seats
//! when the event closes. The deposit has a floor so seats always cost guests
//! something.
//!
//! Accounts that live in NEAR Intents (EVM, Solana, passkey wallets) act as
//! hosts through the verifier's `auth_call` intent, which calls `on_auth`.
//!
//! Host trust: the contract cannot see who came, so it trusts the host's
//! attendance list. With the whitelist mode on, only whitelisted (vetted)
//! hosts can create events at all. The host can close with `finalize` only
//! after `ends_at`; before that, only `cancel`, which refunds every deposit.
//! Registration closes at `ends_at`.
//!
//! The owner can replace the code (`upgrade`) until `freeze`, which is one-way.
//! The escrow account keeps no access keys, so after `freeze` nobody can
//! change the code. The owner also runs both host lists (whitelist, sponsored).
//!
//! Each guest's finalized attendances are counted (`get_attended_count`).
//!
//! Access rule (optional, set at creation): only guests with a history at the
//! same host's earlier finalized events may register — at least `min_attended`
//! visits and at most `max_no_shows` no-shows among `past_events` — until
//! `open_to_all_at`, if given. `check_access` shows the result for any account.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

// Sizes below are the measured worst case (64-char accounts, 120-char title)
// plus ~25%: event with the largest access rule 428 B, registration 247 B,
// balance entry 141 B, attendance counter 113 B, whitelist entry 109 B, free log 125 B.
// `tests.rs` checks real storage stays under them.
/// Storage for one registration and its indexes. Each seat also reserves
/// a separate balance entry and an attendance counter for settlement.
pub const STORAGE_BYTES_PER_GUEST: u64 = 310;
const BALANCE_BYTES: u64 = 176;
/// One entry in `attended_events`.
const ATTENDED_BYTES: u64 = 144;
/// One entry in `whitelist`.
const WHITELIST_BYTES: u64 = 140;
/// A host's free-tier log (creation times of the last free events).
const FREE_LOG_BYTES: u64 = 160;
/// Written per guest at settlement: their balance and attendance counter.
const SETTLE_BYTES: u64 = BALANCE_BYTES + ATTENDED_BYTES;
const SEAT_BYTES: u64 = STORAGE_BYTES_PER_GUEST + SETTLE_BYTES;
const MAX_VIEW_PAGE: u32 = 100;
/// Upper bound for one event record: max-length title, the largest access
/// rule and the vector slot.
const EVENT_RECORD_BYTES: u64 = 540;
/// Most past events an access rule may look at.
pub const MAX_RULE_EVENTS: usize = 10;
/// Largest event the contract pays storage for.
pub const FREE_MAX_CAPACITY: u32 = 50;
/// The free tier gives a host this many events...
pub const FREE_MAX_EVENTS: usize = 2;
/// ...in any window of this length, counted at creation.
pub const FREE_WINDOW_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// A free event must end within this time, so spam reservations expire fast.
pub const FREE_MAX_HORIZON_MS: u64 = 60 * 24 * 60 * 60 * 1000;
/// Smallest deposit: 0.1 USDC (6 decimals). Stops events with a dust deposit
/// where seats cost us storage but cost guests nothing.
pub const MIN_DEPOSIT: u128 = 100_000;
/// `finalize` walks every guest in one call: 300 guests use ~198 Tgas, well
/// under the 1000 Tgas transaction limit. Sandbox exercises this capacity.
pub const MAX_CAPACITY: u32 = 300;
/// After `ends_at` + this grace period, anyone can `cancel` an unfinalized event.
pub const ABANDON_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const MAX_TITLE_LEN: usize = 120;
/// Events must end within a year, so the abandoned-event refund is always reachable.
const MAX_EVENT_HORIZON_MS: u64 = 365 * 24 * 60 * 60 * 1000;
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
    AttendedEvents,
    Whitelist,
    Sponsored,
    FreeLog,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventStatus {
    Open,
    Finalized,
    Cancelled,
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
    pub attended_count: u32,
    pub payout_per_attendee: u128,
    pub created_at: u64,
    /// When the event was finalized or cancelled; 0 while open.
    pub closed_at: u64,
    /// NEAR (yocto) the host paid for storage; 0 on the free tier.
    storage_paid: u128,
    /// Who may register; `None` lets everyone in.
    pub access: Option<AccessRule>,
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
}

#[near(serializers = [json])]
pub struct GuestView {
    pub account_id: AccountId,
    pub status: GuestStatus,
    pub registered_at: u64,
}

#[near(serializers = [borsh])]
pub struct GuestRecord {
    pub status: GuestStatus,
    pub registered_at: u64,
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
}

/// `msg` accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Take a seat for the sender. `guest` is only for payments relayed by
    /// NEAR Intents; from anyone else it must be absent or equal the sender.
    Register { event_id: u64, guest: Option<AccountId> },
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
    /// Finalized events each guest was checked in at.
    attended_events: LookupMap<AccountId, u32>,
    /// Optional account allowed to call `payout_to_intents` for other users (web relayer).
    relayer: Option<AccountId>,
    /// Upgrades the code until `frozen`, and runs both host lists.
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
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(usdc: AccountId, intents: Option<AccountId>, relayer: Option<AccountId>, owner: AccountId) -> Self {
        Self {
            usdc,
            intents,
            events: Vector::new(StorageKey::Events),
            guests: LookupMap::new(StorageKey::Guests),
            guest_index: LookupMap::new(StorageKey::GuestIndex),
            balances: LookupMap::new(StorageKey::Balances),
            attended_events: LookupMap::new(StorageKey::AttendedEvents),
            relayer,
            reserved_bytes: 0,
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
    /// the excess back.
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

    /// Closes the event with the guests who came (`attended`, checked in at
    /// the door off-chain). Host only, once `ends_at` has passed. Unknown
    /// accounts fail the call, duplicates count once.
    /// `Deposit`: the pool is split equally between them, the rounding
    /// remainder goes to the host; an empty list returns every deposit.
    /// `Ticket`: just closes the event; the host was paid at registration.
    #[payable]
    pub fn finalize(&mut self, event_id: u64, attended: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        self.finalize_by(&env::predecessor_account_id(), event_id, attended);
    }

    /// Cancels the event and refunds every guest deposit (`Ticket` mode refunds
    /// nothing: the host already has the money). The host can do it
    /// at any time while the event is open. As a safety valve for a host who
    /// never closes the event, anyone else can do it once `ABANDON_GRACE_MS`
    /// has passed after `ends_at`.
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

    // --------------------------------------------------------------- owner

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

    /// Run by `upgrade` on the new code. The state root keeps its layout.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        let state: Self =
            near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("Unknown state layout"));
        // shortcut: `Event` gained `access`, so records written by the old code would not decode;
        // this release upgrades only an escrow without events. Drop the check in the next release.
        require!(state.events.len() == 0, "Events exist: their records need a migration");
        state
    }

    /// Makes the code permanent: `upgrade` stops working for good. One-way.
    /// The owner keeps running both host lists.
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
        let count = self.event(event_id).guest_count;
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(MAX_CAPACITY);
        (from..(from.saturating_add(limit)).min(count))
            .map(|i| {
                let account = self.guest_index[&(event_id, i)].clone();
                let record = &self.guests[&(event_id, account.clone())];
                GuestView { account_id: account, status: record.status, registered_at: record.registered_at }
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

    /// Finalized events the account was checked in at.
    pub fn get_attended_count(&self, account_id: AccountId) -> u32 {
        self.attended_events.get(&account_id).copied().unwrap_or(0)
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
        }
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Returns the unused amount to the token resolver.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        let msg: TransferMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"));
        match msg {
            TransferMsg::Register { event_id, guest } => {
                // A relayed payment from the verifier must name the guest,
                // otherwise the relay itself would take the seat.
                // Any Intents balance owner can still name any guest this way.
                let via_intents = Some(&sender_id) == self.intents.as_ref();
                if via_intents {
                    require!(guest.is_some(), "Payments via NEAR Intents must name the guest");
                }
                // Everyone else registers only themselves; paying for another guest is refused.
                let for_self = via_intents || guest.as_ref().map_or(true, |g| *g == sender_id);
                let guest = guest.unwrap_or_else(|| sender_id.clone());
                let deposit = self.get_event_deposit(event_id);
                if let Some(deposit) = deposit {
                    if for_self && amount.0 >= deposit && self.can_register(event_id, &guest) {
                        self.register(event_id, guest, sender_id);
                        return PromiseOrValue::Value(U128(amount.0 - deposit));
                    }
                }
                emit("register_failed", json!({ "event_id": event_id, "guest": guest, "amount": amount }));
                PromiseOrValue::Value(amount)
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
        require!(capacity > 0 && capacity <= MAX_CAPACITY, "Capacity out of range");
        // The whole event, full house included, must be paid for up front.
        let reserve = SEAT_BYTES * u64::from(capacity) + BALANCE_BYTES;
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
        });

        emit("event_created", json!({ "event_id": id, "host": host, "deposit": deposit, "mode": mode }));
        id
    }

    fn finalize_by(&mut self, caller: &AccountId, event_id: u64, attended: Vec<AccountId>) {
        let event = self.event(event_id);
        require!(*caller == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        // Before the end the host can only cancel, which refunds everyone.
        require!(env::block_timestamp_ms() >= event.metadata.ends_at, "The event has not ended yet");
        require!(attended.len() <= MAX_CAPACITY as usize, "Too many accounts");
        let (host, deposit, guest_count, mode) = (event.host.clone(), event.deposit, event.guest_count, event.mode);

        let mut came = 0u32;
        for account in &attended {
            let record = self
                .guests
                .get_mut(&(event_id, account.clone()))
                .unwrap_or_else(|| env::panic_str(&format!("{} is not registered", account)));
            if record.status == GuestStatus::Registered {
                record.status = GuestStatus::Attended;
                came += 1;
                *self.attended_events.entry(account.clone()).or_insert(0) += 1;
            }
        }
        self.event_mut(event_id).attended_count = came;
        if mode == EventMode::Ticket {
            return self.finalize_tickets(event_id);
        }
        if came == 0 {
            return self.close_with_refunds(event_id, EventStatus::Finalized);
        }

        let pool = deposit * guest_count as u128;
        let share = pool / came as u128;
        let remainder = pool - share * came as u128;
        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            if self.guests[&(event_id, account.clone())].status == GuestStatus::Attended {
                self.credit(&account, share);
            }
        }
        if remainder > 0 {
            self.credit(&host, remainder);
        }

        self.event_mut(event_id).payout_per_attendee = share;
        self.mark_closed(event_id, EventStatus::Finalized);
        emit(
            "finalized",
            json!({ "event_id": event_id, "mode": EventMode::Deposit, "attended": came, "payout_per_attendee": U128(share) }),
        );
    }

    fn cancel_by(&mut self, caller: &AccountId, event_id: u64) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        if *caller != event.host {
            require!(
                env::block_timestamp_ms() > event.metadata.ends_at + ABANDON_GRACE_MS,
                "Only the host can cancel before 30 days after the event ends"
            );
        }
        self.close_with_refunds(event_id, EventStatus::Cancelled);
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
            bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * u64::from(capacity) + BALANCE_BYTES)
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
    /// gets back the share of seats nobody took; the event record stays paid.
    fn mark_closed(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event_mut(event_id);
        event.status = status;
        event.closed_at = env::block_timestamp_ms();
        let host = event.host.clone();
        let empty = u64::from(event.capacity - event.guest_count);
        let release = SEAT_BYTES * empty + SETTLE_BYTES * u64::from(event.guest_count) + BALANCE_BYTES;
        let refund = bytes_cost(SEAT_BYTES * empty)
            .min(event.storage_paid.saturating_sub(bytes_cost(EVENT_RECORD_BYTES + BALANCE_BYTES)));
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

    fn can_register(&self, event_id: u64, guest: &AccountId) -> bool {
        let event = self.event(event_id);
        event.status == EventStatus::Open
            && env::block_timestamp_ms() < event.metadata.ends_at
            && event.guest_count < event.capacity
            && self.keyless_ok(guest)
            && !self.guests.contains_key(&(event_id, guest.clone()))
            && self.access_check(event_id, guest).allowed
    }

    /// Every seat was reserved when the event was created, so a registration
    /// only moves its bytes from the reservation into real storage.
    fn register(&mut self, event_id: u64, guest: AccountId, paid_by: AccountId) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(env::block_timestamp_ms() < event.metadata.ends_at, "The event has ended");
        require!(event.guest_count < event.capacity, "Event is full");
        require!(!self.guests.contains_key(&(event_id, guest.clone())), "Already registered");
        require!(self.keyless_ok(&guest), "Keyless registration requires Intents and a relayer");
        require!(self.access_check(event_id, &guest).allowed, "Only regulars can register yet");
        let index = event.guest_count;
        self.reserved_bytes -= STORAGE_BYTES_PER_GUEST;
        self.guests.insert(
            (event_id, guest.clone()),
            GuestRecord { status: GuestStatus::Registered, registered_at: env::block_timestamp_ms() },
        );
        self.guest_index.insert((event_id, index), guest.clone());
        let event = self.event_mut(event_id);
        event.guest_count += 1;

        let (mode, host, deposit) = (event.mode, event.host.clone(), event.deposit);
        if mode == EventMode::Ticket {
            // The host's balance entry is already reserved (+BALANCE_BYTES per event).
            self.credit(&host, deposit);
        }

        emit("register", json!({ "event_id": event_id, "guest": guest, "paid_by": paid_by }));
    }

    fn close_with_refunds(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event(event_id);
        let (deposit, guest_count) = (event.deposit, event.guest_count);
        // Ticket money went to the host at registration; nothing to refund.
        let guest_count = if event.mode == EventMode::Ticket { 0 } else { guest_count };
        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            self.credit(&account, deposit);
        }
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
    }
}

/// NEP-297 event log.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "near-events", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
