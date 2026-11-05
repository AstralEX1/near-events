//! Near Events — Kickback-style event escrow.
//!
//! Guests register by sending an equal USDC deposit with `ft_transfer_call`.
//! Check-in at the door happens off-chain (the host, the co-hosts named at
//! creation, or the Telegram bot mark guests on the Near Events server). The
//! host then calls `finalize` once with the list of guests who came, and the
//! whole pool of deposits is split equally between them. No platform fee.
//!
//! The owner (the account that initialised the contract) can pause new events
//! and registrations if something goes wrong. Payouts, refunds and
//! withdrawals keep working while paused.
//!
//! Payouts land on an internal balance that the guest can withdraw to any
//! NEAR account, into their NEAR Intents balance (`intents.near`, from where
//! 1Click takes it to any chain).
//!
//! Intents-first entry: a guest with USDC in NEAR Intents signs an
//! `ft_withdraw` intent with `receiver_id` = this contract and
//! `msg` = `{"action":"register","event_id":N,"guest":"<their account>"}`.
//! Such transfers lose the token's refund protection, so when someone other
//! than the guest pays, a failed or partial registration is credited to the
//! guest's internal balance instead of bouncing.
//!
//! An event runs in one of two modes, never both. `Deposit` (the default) is
//! the Kickback pool above. `Ticket` is a plain paid ticket: the price waits in
//! the escrow and goes to the host on `finalize`, which is allowed only once the
//! event has started; cancel, abandon and `refund_guest` give it back. The
//! amount a guest pays lives in `deposit` in both modes.
//!
//! Creating an event is free for the host. The contract pays for storage from
//! its own NEAR balance, which the operator keeps topped up. To keep that pool
//! from being drained: a host can have at most `MAX_OPEN_EVENTS_PER_HOST` open
//! events, capacity is capped, the deposit has a floor, and guest records of a
//! closed event can be deleted (`cleanup_event`) so their NEAR goes back.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

/// Upper bound for one guest seat (guest record, index entry, guest's event
/// list, payout balance entry). Used to check the storage pool has room.
pub const STORAGE_BYTES_PER_GUEST: u64 = 500;
/// Upper bound for one event record: max-length text, 10 co-hosts, the vector
/// slot and the host's open-event counter.
const EVENT_RECORD_BYTES: u64 = 16_384;
/// Open (not finalized or cancelled) events one host may have at a time.
pub const MAX_OPEN_EVENTS_PER_HOST: u32 = 5;
/// Smallest deposit: 0.1 USDC (6 decimals). Stops events with a dust deposit
/// where seats cost us storage but cost guests nothing.
pub const MIN_DEPOSIT: u128 = 100_000;
/// Guest records of a closed event stay readable this long, then anyone can
/// delete them with `cleanup_event`.
pub const CLEANUP_DELAY_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_CLEANUP_BATCH: u32 = 100;
/// Upper bound so `finalize` / `cancel` stay well within the gas limit.
pub const MAX_CAPACITY: u32 = 300;
/// After `ends_at` + this grace period, anyone can refund an unfinalized event.
pub const ABANDON_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const MAX_TITLE_LEN: usize = 120;
const MAX_TEXT_LEN: usize = 2000;
const MAX_SHORT_LEN: usize = 300;
const MAX_COHOSTS: usize = 10;
/// Events must end within a year, so the abandoned-event refund is always reachable.
const MAX_EVENT_HORIZON_MS: u64 = 365 * 24 * 60 * 60 * 1000;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Events,
    Guests,
    GuestIndex,
    GuestEvents,
    Balances,
    OpenEvents,
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
    /// Paid ticket; the host gets the ticket money after the event.
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
    pub description: String,
    pub location: String,
    pub cover_url: Option<String>,
    /// Milliseconds since Unix epoch.
    pub starts_at: u64,
    pub ends_at: u64,
}

#[near(serializers = [borsh])]
pub struct Event {
    pub host: AccountId,
    pub cohosts: Vec<AccountId>,
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
    /// Guest records still in storage. Equals `guest_count` until
    /// `cleanup_event` deletes them after the event closed.
    pub stored_guests: u32,
}

#[near(serializers = [json])]
pub struct EventView {
    pub id: u64,
    pub host: AccountId,
    pub cohosts: Vec<AccountId>,
    pub metadata: EventMetadata,
    /// What each guest pays (deposit or ticket price, see `mode`).
    pub deposit: U128,
    pub mode: EventMode,
    /// Same as `deposit`; the name to show in a UI for both modes.
    pub price: U128,
    pub capacity: u32,
    pub status: EventStatus,
    pub guest_count: u32,
    pub attended_count: u32,
    pub total_pool: U128,
    pub payout_per_attendee: U128,
    pub created_at: u64,
    pub closed_at: u64,
    /// How many guests `get_guests` can still return (0 after cleanup).
    pub stored_guests: u32,
}

#[near(serializers = [json])]
pub struct GuestView {
    pub account_id: AccountId,
    pub status: GuestStatus,
    pub registered_at: u64,
    pub paid_by: AccountId,
}

#[near(serializers = [borsh])]
pub struct GuestRecord {
    pub index: u32,
    pub status: GuestStatus,
    pub registered_at: u64,
    pub paid_by: AccountId,
}

/// `msg` accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Take a seat. `guest` defaults to the sender, so anyone (or 1Click on
    /// a guest's behalf) can pay for a seat.
    Register { event_id: u64, guest: Option<AccountId> },
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    usdc: AccountId,
    /// NEAR Intents verifier (`intents.near` on mainnet). None on testnet.
    intents: Option<AccountId>,
    events: Vector<Event>,
    guests: LookupMap<(u64, AccountId), GuestRecord>,
    guest_index: LookupMap<(u64, u32), AccountId>,
    guest_events: LookupMap<AccountId, Vec<u64>>,
    balances: LookupMap<AccountId, u128>,
    /// Open events per host (entry removed at 0).
    open_events: LookupMap<AccountId, u32>,
    /// Optional account allowed to call `payout_to_intents` for other users (web relayer).
    relayer: Option<AccountId>,
    /// Can pause new events and registrations. The account that ran `new`.
    owner: AccountId,
    paused: bool,
}

#[near]
impl Contract {
    #[init]
    pub fn new(usdc: AccountId, intents: Option<AccountId>, relayer: Option<AccountId>) -> Self {
        Self {
            usdc,
            intents,
            events: Vector::new(StorageKey::Events),
            guests: LookupMap::new(StorageKey::Guests),
            guest_index: LookupMap::new(StorageKey::GuestIndex),
            guest_events: LookupMap::new(StorageKey::GuestEvents),
            balances: LookupMap::new(StorageKey::Balances),
            open_events: LookupMap::new(StorageKey::OpenEvents),
            relayer,
            owner: env::predecessor_account_id(),
            paused: false,
        }
    }

    // --------------------------------------------------------------- owner

    /// Stops new events and registrations (`true`) or resumes them. Owner only.
    /// Finalize, cancel, refunds and withdrawals are never paused.
    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.paused = paused;
        emit("paused", json!({ "paused": paused }));
    }

    // ---------------------------------------------------------------- host

    /// Creates an event hosted by the caller. Name co-hosts for door check-in;
    /// the list is fixed after creation.
    /// Free: the contract pays for storage from its own balance.
    pub fn create_event(
        &mut self,
        metadata: EventMetadata,
        deposit: U128,
        capacity: u32,
        cohosts: Option<Vec<AccountId>>,
        mode: Option<EventMode>,
    ) -> u64 {
        require!(!self.paused, "Near Events is paused");
        let host = env::predecessor_account_id();
        let cohosts = cohosts.unwrap_or_default();
        let mode = mode.unwrap_or_default();
        validate_metadata(&metadata);
        require!(deposit.0 >= MIN_DEPOSIT, "Deposit must be at least 0.1 USDC");
        require!(capacity > 0 && capacity <= MAX_CAPACITY, "Capacity out of range");
        require!(cohosts.len() <= MAX_COHOSTS, "Too many co-hosts");
        let open = self.open_events.get(&host).copied().unwrap_or(0);
        require!(
            open < MAX_OPEN_EVENTS_PER_HOST,
            format!("A host can have at most {} open events. Finalize or cancel one first", MAX_OPEN_EVENTS_PER_HOST)
        );
        // The whole event, full house included, must fit in the storage pool.
        self.require_storage_pool(EVENT_RECORD_BYTES + STORAGE_BYTES_PER_GUEST * capacity as u64);

        let id = self.events.len() as u64;
        self.events.push(Event {
            host: host.clone(),
            cohosts,
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
            stored_guests: 0,
        });
        self.open_events.insert(host.clone(), open + 1);

        emit("event_created", json!({ "event_id": id, "host": host, "deposit": deposit, "mode": mode }));
        id
    }

    /// Takes one guest off the list and returns their deposit to their balance,
    /// e.g. someone who asked to cancel in time. Host only, while open. The
    /// last guest takes the freed seat index.
    #[payable]
    pub fn refund_guest(&mut self, event_id: u64, account_id: AccountId) {
        near_sdk::assert_one_yocto();
        let event = self.event(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        let deposit = event.deposit;
        // Look the guest up before `guest_count - 1`. An empty event has no
        // guest, and the subtraction would panic as an overflow instead.
        let record = self
            .guests
            .remove(&(event_id, account_id.clone()))
            .unwrap_or_else(|| env::panic_str("Not registered"));
        let last = self.event(event_id).guest_count - 1;

        if record.index != last {
            let moved = self.guest_index[&(event_id, last)].clone();
            self.guest_index.insert((event_id, record.index), moved.clone());
            self.guests.get_mut(&(event_id, moved)).unwrap().index = record.index;
        }
        self.guest_index.remove(&(event_id, last));
        self.forget_guest_event(&account_id, event_id);
        let event = self.event_mut(event_id);
        event.guest_count -= 1;
        event.stored_guests -= 1;
        self.credit(&account_id, deposit);

        emit("guest_refunded", json!({ "event_id": event_id, "account_id": account_id, "amount": U128(deposit) }));
    }

    /// Closes the event with the guests who came (`attended`, checked in at
    /// the door off-chain). Host only. Unknown accounts fail the call,
    /// duplicates count once.
    /// `Deposit`: the pool is split equally between them, the rounding
    /// remainder goes to the host; an empty list returns every deposit.
    /// `Ticket`: pays all ticket money to the host, once the event has started.
    #[payable]
    pub fn finalize(&mut self, event_id: u64, attended: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        let event = self.event(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
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

    /// Cancels the event and refunds every deposit. Host only.
    #[payable]
    pub fn cancel(&mut self, event_id: u64) {
        near_sdk::assert_one_yocto();
        let event = self.event(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        self.close_with_refunds(event_id, EventStatus::Cancelled);
    }

    /// Safety valve: if the host never finalizes, anyone can refund everyone
    /// once the grace period after the event has passed.
    pub fn refund_if_abandoned(&mut self, event_id: u64) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(
            env::block_timestamp_ms() > event.metadata.ends_at + ABANDON_GRACE_MS,
            "Grace period has not passed"
        );
        self.close_with_refunds(event_id, EventStatus::Cancelled);
    }

    /// Deletes up to `limit` guest records of a closed event, once
    /// `CLEANUP_DELAY_MS` has passed since it closed. Anyone can call it; the
    /// freed NEAR goes back to the contract's storage pool. Payouts are already
    /// on guests' balances, so nothing of value is lost, only the guest list.
    /// Returns how many records are left.
    pub fn cleanup_event(&mut self, event_id: u64, limit: Option<u32>) -> u32 {
        let event = self.event(event_id);
        require!(event.status != EventStatus::Open, "Event is still open");
        require!(
            env::block_timestamp_ms() >= event.closed_at + CLEANUP_DELAY_MS,
            "Guest list is kept for 7 days after the event closes"
        );
        let stored = event.stored_guests;
        let batch = limit.unwrap_or(MAX_CLEANUP_BATCH).min(MAX_CLEANUP_BATCH).min(stored);
        for i in (stored - batch..stored).rev() {
            let account = self
                .guest_index
                .remove(&(event_id, i))
                .unwrap_or_else(|| env::panic_str("Missing guest index"));
            self.guests.remove(&(event_id, account.clone()));
            self.forget_guest_event(&account, event_id);
        }
        let left = stored - batch;
        self.event_mut(event_id).stored_guests = left;
        emit("cleaned_up", json!({ "event_id": event_id, "removed": batch, "left": left }));
        left
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
        if unsent > 0 {
            self.credit(&owner, unsent);
            emit("withdraw_failed", json!({ "account_id": owner, "amount": U128(unsent) }));
        }
        U128(sent)
    }

    // --------------------------------------------------------------- views

    pub fn usdc(&self) -> AccountId {
        self.usdc.clone()
    }

    pub fn intents(&self) -> Option<AccountId> {
        self.intents.clone()
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn relayer(&self) -> Option<AccountId> {
        self.relayer.clone()
    }

    /// NEAR (yocto) the contract can still spend on storage.
    pub fn storage_pool(&self) -> U128 {
        U128(free_storage_balance())
    }

    /// Open events of a host, against `MAX_OPEN_EVENTS_PER_HOST`.
    pub fn open_events_of(&self, account_id: AccountId) -> u32 {
        self.open_events.get(&account_id).copied().unwrap_or(0)
    }

    pub fn get_event(&self, event_id: u64) -> Option<EventView> {
        self.events.get(event_id as u32).map(|e| view_event(event_id, e))
    }

    pub fn get_events(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<EventView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..(from + limit).min(self.events.len() as u64))
            .map(|id| view_event(id, &self.events[id as u32]))
            .collect()
    }

    pub fn get_events_count(&self) -> u64 {
        self.events.len() as u64
    }

    pub fn get_guests(&self, event_id: u64, from_index: Option<u32>, limit: Option<u32>) -> Vec<GuestView> {
        let count = self.event(event_id).stored_guests;
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(MAX_CAPACITY);
        (from..(from.saturating_add(limit)).min(count))
            .map(|i| {
                let account = self.guest_index[&(event_id, i)].clone();
                let record = &self.guests[&(event_id, account.clone())];
                GuestView {
                    account_id: account,
                    status: record.status,
                    registered_at: record.registered_at,
                    paid_by: record.paid_by.clone(),
                }
            })
            .collect()
    }

    pub fn get_guest_status(&self, event_id: u64, account_id: AccountId) -> Option<GuestStatus> {
        self.guests.get(&(event_id, account_id)).map(|r| r.status)
    }

    pub fn get_guest_events(&self, account_id: AccountId) -> Vec<u64> {
        self.guest_events.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance(&account_id))
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Returns the amount to refund to the sender. Any panic refunds everything.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        let msg: TransferMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"));
        match msg {
            TransferMsg::Register { event_id, guest } => {
                // A relayed payment (intents.near, 1Click) must name the guest,
                // otherwise the relay itself would take the seat.
                if Some(&sender_id) == self.intents.as_ref() {
                    require!(guest.is_some(), "Payments via NEAR Intents must name the guest");
                }
                let guest = guest.unwrap_or_else(|| sender_id.clone());
                let third_party = guest != sender_id;
                if self.paused {
                    return self.keep_for_guest_or_reject(third_party, event_id, &guest, amount, "Near Events is paused");
                }
                // Missing event and a short payment used to panic. A panic makes
                // the token send the USDC back to `sender_id`. When that sender
                // is intents.near or 1Click, the refund often never reaches the
                // guest. Keep it on the guest's balance instead.
                let Some(deposit) = self
                    .events
                    .get(u32::try_from(event_id).unwrap_or(u32::MAX))
                    .map(|event| event.deposit)
                else {
                    return self.keep_for_guest_or_reject(third_party, event_id, &guest, amount, "Event not found");
                };
                if amount.0 < deposit {
                    return self.keep_for_guest_or_reject(
                        third_party,
                        event_id,
                        &guest,
                        amount,
                        "Amount is less than the deposit",
                    );
                }
                if !third_party {
                    self.register(event_id, guest, sender_id);
                    return PromiseOrValue::Value(U128(amount.0 - deposit));
                }
                let leftover = if self.can_register(event_id, &guest) {
                    self.register(event_id, guest.clone(), sender_id);
                    amount.0 - deposit
                } else {
                    return self.keep_for_guest_or_reject(true, event_id, &guest, amount, "Registration failed");
                };
                // The seat's storage already covers the guest's balance entry.
                if leftover > 0 {
                    self.credit(&guest, leftover);
                }
                PromiseOrValue::Value(U128(0))
            }
        }
    }
}

impl Contract {
    /// `Ticket` mode close: the host gets every ticket, attended or not.
    /// Not before the start, so a host cannot sell tickets and take the money
    /// long before the event; until then cancel and abandon still refund.
    fn finalize_tickets(&mut self, event_id: u64) {
        let event = self.event(event_id);
        require!(
            env::block_timestamp_ms() >= event.metadata.starts_at,
            "Ticket money is released once the event has started"
        );
        let host = event.host.clone();
        let total = event.deposit * event.guest_count as u128;
        let attended = event.attended_count;
        if total > 0 {
            self.credit(&host, total);
        }
        self.mark_closed(event_id, EventStatus::Finalized);
        emit(
            "finalized",
            json!({ "event_id": event_id, "mode": EventMode::Ticket, "attended": attended, "paid_to_host": U128(total) }),
        );
    }

    /// A payment made for someone else never bounces: the USDC stays on that
    /// guest's balance. The guest pays for their own seat, so a bad payment
    /// still refunds through the token.
    fn keep_for_guest_or_reject(
        &mut self,
        third_party: bool,
        event_id: u64,
        guest: &AccountId,
        amount: U128,
        reason: &str,
    ) -> PromiseOrValue<U128> {
        if !third_party {
            env::panic_str(reason);
        }
        // A new balance entry costs the contract storage. Without a floor anyone
        // could create thousands of them with dust payments to made-up names.
        // Real payments are at least a deposit, so they are never caught here.
        // No storage-pool check: keeping a real payment matters more.
        if self.balance(guest) == 0 {
            require!(amount.0 >= MIN_DEPOSIT, reason);
        }
        self.credit(guest, amount.0);
        emit("register_failed", json!({ "event_id": event_id, "guest": guest, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }

    /// Panics with a clear message when the contract cannot pay for `bytes`
    /// more storage. Without this the call fails later with a NEAR runtime
    /// error that says nothing to the user.
    fn require_storage_pool(&self, bytes: u64) {
        require!(
            free_storage_balance() >= bytes_cost(bytes),
            "Near Events storage pool is empty, please try again later"
        );
    }

    fn forget_guest_event(&mut self, account: &AccountId, event_id: u64) {
        if let Some(list) = self.guest_events.get_mut(account) {
            list.retain(|e| *e != event_id);
            if list.is_empty() {
                self.guest_events.remove(account);
            }
        }
    }

    fn mark_closed(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event_mut(event_id);
        event.status = status;
        event.closed_at = env::block_timestamp_ms();
        let host = event.host.clone();
        let open = self.open_events.get(&host).copied().unwrap_or(1);
        if open <= 1 {
            self.open_events.remove(&host);
        } else {
            self.open_events.insert(host, open - 1);
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
        self.set_balance(&owner, balance - amount);
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

    fn can_register(&self, event_id: u64, guest: &AccountId) -> bool {
        let event = self.event(event_id);
        event.status == EventStatus::Open
            && event.guest_count < event.capacity
            && free_storage_balance() >= bytes_cost(STORAGE_BYTES_PER_GUEST)
            && !self.guests.contains_key(&(event_id, guest.clone()))
    }

    fn register(&mut self, event_id: u64, guest: AccountId, paid_by: AccountId) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(event.guest_count < event.capacity, "Event is full");
        require!(!self.guests.contains_key(&(event_id, guest.clone())), "Already registered");
        self.require_storage_pool(STORAGE_BYTES_PER_GUEST);

        let index = event.guest_count;
        self.guests.insert(
            (event_id, guest.clone()),
            GuestRecord {
                index,
                status: GuestStatus::Registered,
                registered_at: env::block_timestamp_ms(),
                paid_by: paid_by.clone(),
            },
        );
        self.guest_index.insert((event_id, index), guest.clone());
        self.guest_events.entry(guest.clone()).or_default().push(event_id);
        let event = self.event_mut(event_id);
        event.guest_count += 1;
        event.stored_guests += 1;

        emit("register", json!({ "event_id": event_id, "guest": guest, "paid_by": paid_by }));
    }

    fn close_with_refunds(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event(event_id);
        let (deposit, guest_count) = (event.deposit, event.guest_count);
        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            self.credit(&account, deposit);
        }
        self.mark_closed(event_id, status);
        emit("closed", json!({ "event_id": event_id, "status": status }));
    }

    fn balance(&self, account: &AccountId) -> u128 {
        self.balances.get(account).copied().unwrap_or(0)
    }

    fn set_balance(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            self.balances.remove(account);
        } else {
            self.balances.insert(account.clone(), amount);
        }
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        let balance = self.balance(account);
        self.set_balance(account, balance + amount);
    }
}

fn bytes_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * bytes as u128
}

/// Contract NEAR not locked for storage already in use.
fn free_storage_balance() -> u128 {
    env::account_balance().as_yoctonear().saturating_sub(bytes_cost(env::storage_usage()))
}

fn validate_metadata(m: &EventMetadata) {
    require!(!m.title.trim().is_empty() && m.title.len() <= MAX_TITLE_LEN, "Bad title");
    require!(m.description.len() <= MAX_TEXT_LEN, "Description too long");
    require!(m.location.len() <= MAX_SHORT_LEN, "Location too long");
    require!(m.cover_url.as_ref().map_or(true, |u| u.len() <= MAX_SHORT_LEN), "Cover URL too long");
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
        cohosts: e.cohosts.clone(),
        metadata: e.metadata.clone(),
        deposit: U128(e.deposit),
        mode: e.mode,
        price: U128(e.deposit),
        capacity: e.capacity,
        status: e.status,
        guest_count: e.guest_count,
        attended_count: e.attended_count,
        // Deposit mode: the pool attendees split. Ticket mode: ticket money
        // held for the host until `finalize`.
        total_pool: U128(e.deposit * e.guest_count as u128),
        payout_per_attendee: U128(e.payout_per_attendee),
        created_at: e.created_at,
        closed_at: e.closed_at,
        stored_guests: e.stored_guests,
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
