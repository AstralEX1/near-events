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
//! Free tier: an event of up to `FREE_MAX_CAPACITY` seats, while the host has
//! fewer than `FREE_MAX_OPEN_EVENTS` open events, is free. The contract pays
//! for storage from its own NEAR balance, which the operator keeps topped up.
//! Anything bigger, or more open events, the host pays for: `create_event`
//! takes the storage cost (`create_event_cost`) as attached NEAR and returns
//! the excess. The deposit has a floor so seats always cost guests something.
//!
//! Each guest's finalized attendances are counted (`get_attended_count`).

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

// Sizes below are the measured worst case (64-char accounts, 120-char title)
// plus ~25%: event 432 B, registration 261 B, balance entry 141 B,
// attendance counter 113 B. `tests.rs` checks real storage stays under them.
/// Storage for one registration and its indexes. Each seat also reserves
/// a separate balance entry and an attendance counter for settlement.
pub const STORAGE_BYTES_PER_GUEST: u64 = 328;
const BALANCE_BYTES: u64 = 176;
/// One entry in `attended_events`.
const ATTENDED_BYTES: u64 = 144;
/// Written per guest at settlement: their balance and attendance counter.
const SETTLE_BYTES: u64 = BALANCE_BYTES + ATTENDED_BYTES;
const SEAT_BYTES: u64 = STORAGE_BYTES_PER_GUEST + SETTLE_BYTES;
const MAX_VIEW_PAGE: u32 = 100;
/// Upper bound for one event record: max-length title, the vector slot and the
/// host's open-event counter.
const EVENT_RECORD_BYTES: u64 = 540;
/// Largest event the contract pays storage for.
pub const FREE_MAX_CAPACITY: u32 = 50;
/// The free tier applies while the host has fewer open events than this.
pub const FREE_MAX_OPEN_EVENTS: u32 = 2;
/// Smallest deposit: 0.1 USDC (6 decimals). Stops events with a dust deposit
/// where seats cost us storage but cost guests nothing.
pub const MIN_DEPOSIT: u128 = 100_000;
/// Technical cap, not a pricing limit: `finalize` walks every guest in one
/// call and must stay well under the 300 Tgas block limit. Sandbox exercises
/// this exact capacity.
pub const MAX_CAPACITY: u32 = 300;
/// After `ends_at` + this grace period, anyone can `cancel` an unfinalized event.
pub const ABANDON_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const MAX_TITLE_LEN: usize = 120;
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
    Balances,
    OpenEvents,
    AttendedEvents,
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
    reserved_seats: u32,
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
    pub status: GuestStatus,
    pub registered_at: u64,
    pub paid_by: AccountId,
}

/// `msg` accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// Take a seat for the sender. `guest` is only for payments relayed by
    /// NEAR Intents; from anyone else it must be absent or equal the sender.
    Register { event_id: u64, guest: Option<AccountId> },
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
    /// NEAR Intents verifier (`intents.near` on mainnet). None on testnet.
    intents: Option<AccountId>,
    events: Vector<Event>,
    guests: LookupMap<(u64, AccountId), GuestRecord>,
    guest_index: LookupMap<(u64, u32), AccountId>,
    balances: LookupMap<AccountId, Balance>,
    reserved_bytes: u64,
    /// Open events per host (entry removed at 0).
    open_events: LookupMap<AccountId, u32>,
    /// Finalized events each guest was checked in at.
    attended_events: LookupMap<AccountId, u32>,
    /// Optional account allowed to call `payout_to_intents` for other users (web relayer).
    relayer: Option<AccountId>,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(usdc: AccountId, intents: Option<AccountId>, relayer: Option<AccountId>) -> Self {
        Self {
            usdc,
            intents,
            events: Vector::new(StorageKey::Events),
            guests: LookupMap::new(StorageKey::Guests),
            guest_index: LookupMap::new(StorageKey::GuestIndex),
            balances: LookupMap::new(StorageKey::Balances),
            open_events: LookupMap::new(StorageKey::OpenEvents),
            attended_events: LookupMap::new(StorageKey::AttendedEvents),
            relayer,
            reserved_bytes: 0,
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
    ) -> u64 {
        let host = env::predecessor_account_id();
        let mode = mode.unwrap_or_default();
        validate_metadata(&metadata);
        require!(deposit.0 >= MIN_DEPOSIT, "Deposit must be at least 0.1 USDC");
        require!(capacity > 0 && capacity <= MAX_CAPACITY, "Capacity out of range");
        let open = self.open_events.get(&host).copied().unwrap_or(0);
        // The whole event, full house included, must be paid for up front.
        let reserve = SEAT_BYTES * u64::from(capacity) + BALANCE_BYTES;
        let cost = event_cost(open, capacity);
        let attached = env::attached_deposit().as_yoctonear();
        if cost == 0 {
            self.require_storage_pool(EVENT_RECORD_BYTES + reserve);
        } else {
            require!(
                attached >= cost,
                format!(
                    "This event is beyond the free tier ({} seats, {} open events). Attach {} yoctoNEAR for its storage",
                    FREE_MAX_CAPACITY, FREE_MAX_OPEN_EVENTS, cost
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
            reserved_seats: capacity,
        });
        self.open_events.insert(host.clone(), open + 1);

        emit("event_created", json!({ "event_id": id, "host": host, "deposit": deposit, "mode": mode }));
        id
    }

    /// Closes the event with the guests who came (`attended`, checked in at
    /// the door off-chain). Host only. Unknown accounts fail the call,
    /// duplicates count once.
    /// `Deposit`: the pool is split equally between them, the rounding
    /// remainder goes to the host; an empty list returns every deposit.
    /// `Ticket`: just closes the event; the host was paid at registration.
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

    /// Cancels the event and refunds every guest deposit (`Ticket` mode refunds
    /// nothing: the host already has the money). The host can do it
    /// at any time while the event is open. As a safety valve for a host who
    /// never closes the event, anyone else can do it once `ABANDON_GRACE_MS`
    /// has passed after `ends_at`.
    #[payable]
    pub fn cancel(&mut self, event_id: u64) {
        near_sdk::assert_one_yocto();
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        if env::predecessor_account_id() != event.host {
            require!(
                env::block_timestamp_ms() > event.metadata.ends_at + ABANDON_GRACE_MS,
                "Only the host can cancel before 30 days after the event ends"
            );
        }
        self.close_with_refunds(event_id, EventStatus::Cancelled);
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

    pub fn get_guests(&self, event_id: u64, from_index: Option<u32>, limit: Option<u32>) -> Vec<GuestView> {
        let count = self.event(event_id).guest_count;
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

    /// NEAR (yocto) `host` must attach to create an event of `capacity` seats
    /// now; 0 on the free tier.
    pub fn create_event_cost(&self, host: AccountId, capacity: u32) -> U128 {
        U128(event_cost(self.open_events.get(&host).copied().unwrap_or(0), capacity))
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

    fn mark_closed(&mut self, event_id: u64, status: EventStatus) {
        let event = self.event_mut(event_id);
        event.status = status;
        event.closed_at = env::block_timestamp_ms();
        let host = event.host.clone();
        let release = SEAT_BYTES * u64::from(event.reserved_seats)
            + SETTLE_BYTES * u64::from(event.guest_count)
            + BALANCE_BYTES;
        event.reserved_seats = 0;
        self.reserved_bytes -= release;
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

    fn can_register(&self, event_id: u64, guest: &AccountId) -> bool {
        let event = self.event(event_id);
        event.status == EventStatus::Open
            && event.guest_count < event.capacity
            && (!guest.as_str().starts_with("0x") || guest.as_str().len() != 42
                || (self.intents.is_some() && self.relayer.is_some()))
            && (event.reserved_seats > 0 || self.unreserved_storage() >= bytes_cost(SEAT_BYTES))
            && !self.guests.contains_key(&(event_id, guest.clone()))
    }

    fn register(&mut self, event_id: u64, guest: AccountId, paid_by: AccountId) {
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(event.guest_count < event.capacity, "Event is full");
        require!(!self.guests.contains_key(&(event_id, guest.clone())), "Already registered");
        require!(
            !guest.as_str().starts_with("0x") || guest.as_str().len() != 42
                || (self.intents.is_some() && self.relayer.is_some()),
            "Keyless registration requires Intents and a relayer"
        );
        let prepaid = event.reserved_seats > 0;
        let index = event.guest_count;
        if prepaid {
            self.reserved_bytes -= STORAGE_BYTES_PER_GUEST;
        } else {
            self.require_storage_pool(SEAT_BYTES);
            self.reserved_bytes += SETTLE_BYTES;
        }
        self.guests.insert(
            (event_id, guest.clone()),
            GuestRecord {
                status: GuestStatus::Registered,
                registered_at: env::block_timestamp_ms(),
                paid_by: paid_by.clone(),
            },
        );
        self.guest_index.insert((event_id, index), guest.clone());
        let event = self.event_mut(event_id);
        event.guest_count += 1;
        if prepaid {
            event.reserved_seats -= 1;
        }

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

/// Storage cost of a new event for a host with `open` open events; 0 when free.
fn event_cost(open: u32, capacity: u32) -> u128 {
    if capacity <= FREE_MAX_CAPACITY && open < FREE_MAX_OPEN_EVENTS {
        0
    } else {
        bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * u64::from(capacity) + BALANCE_BYTES)
    }
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
