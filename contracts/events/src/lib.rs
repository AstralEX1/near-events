//! Near Events — Kickback-style event escrow.
//!
//! Guests register by sending an equal USDC deposit with `ft_transfer_call`.
//! The host (often a Sputnik DAO) and its co-hosts check guests in. On
//! `finalize` the whole pool (deposits + sponsor bonus) is split equally
//! between the guests who showed up. No platform fee.
//!
//! Payouts land on an internal balance that the guest can withdraw to any
//! NEAR account, into their NEAR Intents balance (`intents.near`, from where
//! 1Click takes it to any chain), or reuse for the next event.
//!
//! Intents-first entry: a guest with USDC in NEAR Intents signs an
//! `ft_withdraw` intent with `receiver_id` = this contract and
//! `msg` = `{"action":"register","event_id":N,"guest":"<their account>"}`.
//! Such transfers lose the token's refund protection, so when someone other
//! than the guest pays, a failed or partial registration is credited to the
//! guest's internal balance instead of bouncing.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

/// Storage the host pre-pays for each guest seat (guest record, index entry,
/// guest's event list, payout balance entry). Unused storage is refunded.
pub const STORAGE_BYTES_PER_GUEST: u64 = 500;
/// Upper bound so `finalize` / `cancel` stay well within the gas limit.
pub const MAX_CAPACITY: u32 = 300;
/// After `ends_at` + this grace period, anyone can refund an unfinalized event.
pub const ABANDON_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const MAX_TITLE_LEN: usize = 120;
const MAX_TEXT_LEN: usize = 2000;
const MAX_SHORT_LEN: usize = 300;
const MAX_COHOSTS: usize = 10;
const MAX_SPONSORS: usize = 50;
const MAX_CHECK_IN_BATCH: usize = MAX_CAPACITY as usize;
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
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventStatus {
    Open,
    Finalized,
    Cancelled,
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
    pub deposit: u128,
    pub capacity: u32,
    pub status: EventStatus,
    pub guest_count: u32,
    pub attended_count: u32,
    pub bonus_pool: u128,
    pub payout_per_attendee: u128,
    /// NEAR (yocto) left from the host's storage pre-payment.
    pub storage_budget: u128,
    pub created_at: u64,
    /// Per-sponsor USDC amounts; refunded to sponsors on cancel/abandon.
    pub sponsors: Vec<(AccountId, u128)>,
}

#[near(serializers = [json])]
pub struct EventView {
    pub id: u64,
    pub host: AccountId,
    pub cohosts: Vec<AccountId>,
    pub metadata: EventMetadata,
    pub deposit: U128,
    pub capacity: u32,
    pub status: EventStatus,
    pub guest_count: u32,
    pub attended_count: u32,
    pub bonus_pool: U128,
    pub total_pool: U128,
    pub payout_per_attendee: U128,
    pub created_at: u64,
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
    /// Add a bonus to the event's pool (e.g. from a DAO treasury).
    Sponsor { event_id: u64 },
    /// Top up an internal balance for future registrations.
    TopUp { account_id: Option<AccountId> },
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
    /// Optional account allowed to call `payout_to_intents` for other users (web relayer).
    relayer: Option<AccountId>,
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
            relayer,
        }
    }

    // ---------------------------------------------------------------- host

    /// Creates an event hosted by the caller. A Sputnik DAO creates one
    /// through a `FunctionCall` proposal and names its human co-host here.
    /// Attach NEAR for storage: see `storage_cost`.
    #[payable]
    pub fn create_event(
        &mut self,
        metadata: EventMetadata,
        deposit: U128,
        capacity: u32,
        cohosts: Option<Vec<AccountId>>,
    ) -> u64 {
        let host = env::predecessor_account_id();
        let cohosts = cohosts.unwrap_or_default();
        validate_metadata(&metadata);
        require!(deposit.0 > 0, "Deposit must be positive");
        require!(capacity > 0 && capacity <= MAX_CAPACITY, "Capacity out of range");
        require!(cohosts.len() <= MAX_COHOSTS, "Too many co-hosts");

        let initial_storage = env::storage_usage();
        let id = self.events.len() as u64;
        self.events.push(Event {
            host: host.clone(),
            cohosts,
            metadata,
            deposit: deposit.0,
            capacity,
            status: EventStatus::Open,
            guest_count: 0,
            attended_count: 0,
            bonus_pool: 0,
            payout_per_attendee: 0,
            storage_budget: 0,
            created_at: env::block_timestamp_ms(),
            sponsors: Vec::new(),
        });
        self.events.flush();
        let event_cost = bytes_cost(env::storage_usage().saturating_sub(initial_storage));
        let seats_cost = bytes_cost(STORAGE_BYTES_PER_GUEST * capacity as u64);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= event_cost + seats_cost,
            format!("Attach at least {} yoctoNEAR for storage", event_cost + seats_cost)
        );
        self.event_mut(id).storage_budget = attached - event_cost;

        emit("event_created", json!({ "event_id": id, "host": host, "deposit": deposit }));
        id
    }

    #[payable]
    pub fn add_cohost(&mut self, event_id: u64, account_id: AccountId) {
        near_sdk::assert_one_yocto();
        let event = self.event_mut(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(event.cohosts.len() < MAX_COHOSTS, "Too many co-hosts");
        if !event.cohosts.contains(&account_id) {
            event.cohosts.push(account_id.clone());
        }
        emit("cohost_added", json!({ "event_id": event_id, "account_id": account_id }));
    }

    #[payable]
    pub fn remove_cohost(&mut self, event_id: u64, account_id: AccountId) {
        near_sdk::assert_one_yocto();
        let event = self.event_mut(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        event.cohosts.retain(|a| a != &account_id);
        emit("cohost_removed", json!({ "event_id": event_id, "account_id": account_id }));
    }

    /// Marks registered guests as attended. Host or co-host.
    #[payable]
    pub fn check_in(&mut self, event_id: u64, accounts: Vec<AccountId>) {
        near_sdk::assert_one_yocto();
        require!(accounts.len() <= MAX_CHECK_IN_BATCH, "Too many accounts");
        self.assert_open_and_staff(event_id);
        let mut added = 0u32;
        for account in &accounts {
            let record = self
                .guests
                .get_mut(&(event_id, account.clone()))
                .unwrap_or_else(|| env::panic_str(&format!("{} is not registered", account)));
            if record.status == GuestStatus::Registered {
                record.status = GuestStatus::Attended;
                added += 1;
            }
        }
        self.event_mut(event_id).attended_count += added;
        emit("check_in", json!({ "event_id": event_id, "accounts": accounts }));
    }

    /// Reverts a mistaken check-in. Host or co-host.
    #[payable]
    pub fn undo_check_in(&mut self, event_id: u64, account_id: AccountId) {
        near_sdk::assert_one_yocto();
        self.assert_open_and_staff(event_id);
        let record = self
            .guests
            .get_mut(&(event_id, account_id.clone()))
            .unwrap_or_else(|| env::panic_str("Not registered"));
        if record.status == GuestStatus::Attended {
            record.status = GuestStatus::Registered;
            self.event_mut(event_id).attended_count -= 1;
        }
        emit("undo_check_in", json!({ "event_id": event_id, "account_id": account_id }));
    }

    /// Splits the pool between attendees. Host only, so a DAO host finalizes
    /// by proposal. If nobody attended, everyone gets their deposit back.
    #[payable]
    pub fn finalize(&mut self, event_id: u64) {
        near_sdk::assert_one_yocto();
        let event = self.event(event_id);
        require!(env::predecessor_account_id() == event.host, "Only the host");
        require!(event.status == EventStatus::Open, "Event is closed");
        if event.attended_count == 0 {
            return self.close_with_refunds(event_id, EventStatus::Finalized);
        }

        let initial_storage = env::storage_usage();
        let (host, deposit, guest_count, attended, bonus) =
            (event.host.clone(), event.deposit, event.guest_count, event.attended_count, event.bonus_pool);
        let pool = deposit * guest_count as u128 + bonus;
        let share = pool / attended as u128;
        let remainder = pool - share * attended as u128;

        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            if self.guests[&(event_id, account.clone())].status == GuestStatus::Attended {
                self.credit(&account, share);
            }
        }
        if remainder > 0 {
            self.credit(&host, remainder);
        }

        let event = self.event_mut(event_id);
        event.status = EventStatus::Finalized;
        event.payout_per_attendee = share;
        self.settle_storage(event_id, initial_storage);
        emit(
            "finalized",
            json!({ "event_id": event_id, "attended": attended, "payout_per_attendee": U128(share) }),
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

    // --------------------------------------------------------------- guest

    /// Registers the caller using their internal balance (e.g. a previous payout).
    /// Requires 1 yoctoNEAR so only a full-access key can spend the balance.
    #[payable]
    pub fn register_with_balance(&mut self, event_id: u64) {
        near_sdk::assert_one_yocto();
        let guest = env::predecessor_account_id();
        let deposit = self.event(event_id).deposit;
        let balance = self.balance(&guest);
        require!(balance >= deposit, "Not enough balance");
        self.set_balance(&guest, balance - deposit);
        self.register(event_id, guest.clone(), guest);
    }

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

    pub fn relayer(&self) -> Option<AccountId> {
        self.relayer.clone()
    }

    /// NEAR (yocto) to attach to `create_event` for a given capacity.
    pub fn storage_cost(&self, capacity: u32) -> U128 {
        // ~1 KB for the event record itself plus each seat.
        U128(bytes_cost(1024 + STORAGE_BYTES_PER_GUEST * capacity as u64))
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
                let deposit = self.event(event_id).deposit;
                require!(amount.0 >= deposit, "Amount is less than the deposit");
                // A relayed payment (intents.near, 1Click) must name the guest,
                // otherwise the relay itself would take the seat.
                if Some(&sender_id) == self.intents.as_ref() {
                    require!(guest.is_some(), "Payments via NEAR Intents must name the guest");
                }
                let guest = guest.unwrap_or_else(|| sender_id.clone());
                if guest == sender_id {
                    self.register(event_id, guest, sender_id);
                    return PromiseOrValue::Value(U128(amount.0 - deposit));
                }
                // Paid by someone else (a friend, 1Click or intents.near): never
                // bounce, because a refund may not reach the guest.
                let leftover = if self.can_register(event_id, &guest) {
                    self.register(event_id, guest.clone(), sender_id);
                    amount.0 - deposit
                } else {
                    emit("register_failed", json!({ "event_id": event_id, "guest": guest, "amount": amount }));
                    amount.0
                };
                if leftover > 0 {
                    self.credit(&guest, leftover);
                }
                PromiseOrValue::Value(U128(0))
            }
            TransferMsg::Sponsor { event_id } => {
                let event = self.event_mut(event_id);
                require!(event.status == EventStatus::Open, "Event is closed");
                event.bonus_pool += amount.0;
                if let Some((_, funded)) = event.sponsors.iter_mut().find(|(a, _)| a == &sender_id) {
                    *funded += amount.0;
                } else {
                    require!(event.sponsors.len() < MAX_SPONSORS, "Too many sponsors");
                    event.sponsors.push((sender_id.clone(), amount.0));
                }
                emit("sponsored", json!({ "event_id": event_id, "sponsor": sender_id, "amount": amount }));
                PromiseOrValue::Value(U128(0))
            }
            TransferMsg::TopUp { account_id } => {
                let account = account_id.unwrap_or(sender_id);
                let initial_storage = env::storage_usage();
                self.credit(&account, amount.0);
                // A new balance entry is tiny; require the account to exist already
                // so strangers cannot grow storage for free.
                require!(env::storage_usage() == initial_storage, "Top-up needs an existing balance");
                PromiseOrValue::Value(U128(0))
            }
        }
    }
}

impl Contract {
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

    fn assert_open_and_staff(&self, event_id: u64) {
        let event = self.event(event_id);
        let caller = env::predecessor_account_id();
        require!(event.host == caller || event.cohosts.contains(&caller), "Only the host or a co-host");
        require!(event.status == EventStatus::Open, "Event is closed");
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
            && event.storage_budget >= bytes_cost(STORAGE_BYTES_PER_GUEST)
            && !self.guests.contains_key(&(event_id, guest.clone()))
    }

    fn register(&mut self, event_id: u64, guest: AccountId, paid_by: AccountId) {
        let initial_storage = env::storage_usage();
        let event = self.event(event_id);
        require!(event.status == EventStatus::Open, "Event is closed");
        require!(event.guest_count < event.capacity, "Event is full");
        require!(!self.guests.contains_key(&(event_id, guest.clone())), "Already registered");

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
        self.event_mut(event_id).guest_count += 1;

        self.guests.flush();
        self.guest_index.flush();
        self.guest_events.flush();
        let used = bytes_cost(env::storage_usage().saturating_sub(initial_storage));
        let event = self.event_mut(event_id);
        require!(event.storage_budget >= used, "Event has no storage budget left");
        event.storage_budget -= used;

        emit("register", json!({ "event_id": event_id, "guest": guest, "paid_by": paid_by }));
    }

    fn close_with_refunds(&mut self, event_id: u64, status: EventStatus) {
        let initial_storage = env::storage_usage();
        let event = self.event(event_id);
        let (deposit, guest_count, sponsors) =
            (event.deposit, event.guest_count, event.sponsors.clone());
        for i in 0..guest_count {
            let account = self.guest_index[&(event_id, i)].clone();
            self.credit(&account, deposit);
        }
        // Sponsor bonuses go back to the sponsors who funded them.
        for (sponsor, amount) in sponsors {
            if amount > 0 {
                self.credit(&sponsor, amount);
            }
        }
        let event = self.event_mut(event_id);
        event.status = status;
        event.bonus_pool = 0;
        event.sponsors.clear();
        self.settle_storage(event_id, initial_storage);
        emit("closed", json!({ "event_id": event_id, "status": status }));
    }

    /// Charges storage used since `initial_storage` to the event's budget and
    /// returns what is left to the host. Called once when an event closes.
    fn settle_storage(&mut self, event_id: u64, initial_storage: u64) {
        self.balances.flush();
        let used = bytes_cost(env::storage_usage().saturating_sub(initial_storage));
        let event = self.event_mut(event_id);
        let refund = event.storage_budget.saturating_sub(used);
        event.storage_budget = 0;
        let host = event.host.clone();
        if refund > 0 {
            let _ = Promise::new(host).transfer(NearToken::from_yoctonear(refund));
        }
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
        capacity: e.capacity,
        status: e.status,
        guest_count: e.guest_count,
        attended_count: e.attended_count,
        bonus_pool: U128(e.bonus_pool),
        total_pool: U128(e.deposit * e.guest_count as u128 + e.bonus_pool),
        payout_per_attendee: U128(e.payout_per_attendee),
        created_at: e.created_at,
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
