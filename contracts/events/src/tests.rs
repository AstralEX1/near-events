use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
#[allow(deprecated)]
use near_sdk::test_utils::testing_env_with_promise_results;
use near_sdk::{testing_env, PromiseResult};

const USDC: u128 = 1_000_000; // 6 decimals

fn usdc() -> AccountId {
    "usdc.testnet".parse().unwrap()
}

fn owner() -> AccountId {
    "owner.testnet".parse().unwrap()
}

fn one_yocto() -> NearToken {
    NearToken::from_yoctonear(1)
}

fn ctx(predecessor: &AccountId, deposit: NearToken) {
    ctx_at(predecessor, deposit, 1_000_000_000_000);
}

fn ctx_at(predecessor: &AccountId, deposit: NearToken, block_timestamp: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("events.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .block_timestamp(block_timestamp)
        .build());
}

/// Clock at the sample event's end: `finalize` opens, registration closes.
fn ctx_ended(predecessor: &AccountId) {
    ctx_at(predecessor, one_yocto(), meta().ends_at * 1_000_000);
}

fn contract_account() -> AccountId {
    "events.testnet".parse().unwrap()
}

fn meta() -> EventMetadata {
    EventMetadata {
        title: "NEAR meetup".into(),
        starts_at: 2_000_000,
        ends_at: 3_000_000,
    }
}

/// Host = accounts(0). accounts(1) is a door helper with no on-chain role.
fn setup(capacity: u32) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), capacity, None, None);
    (c, id)
}

fn setup_with_relayer(capacity: u32, relayer: AccountId) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), Some("intents.near".parse().unwrap()), Some(relayer), owner());
    let id = c.create_event(meta(), U128(10 * USDC), capacity, None, None);
    (c, id)
}

fn pay(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str) -> u128 {
    pay_at(c, sender, amount, msg, 1_000_000)
}

fn pay_at(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str, now_ms: u64) -> u128 {
    bond_if_needed(c, msg, now_ms);
    raw_pay_at(c, sender, amount, msg, now_ms)
}

/// `ft_on_transfer` as the USDC contract would call it, no helpers around it.
fn raw_pay_at(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str, now_ms: u64) -> u128 {
    ctx_at(&usdc(), NearToken::from_yoctonear(0), now_ms * 1_000_000);
    match c.ft_on_transfer(sender.clone(), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

fn dao() -> AccountId {
    "court.sputnik-dao.testnet".parse().unwrap()
}

fn treasury() -> AccountId {
    "treasury.testnet".parse().unwrap()
}

/// The default deadlines (`Rules::new`), as the tests' clock sees them.
const CHALLENGE_WINDOW_MS: u64 = 12 * ORACLE_HOUR_MS;
const SUBMIT_DEADLINE_MS: u64 = 72 * ORACLE_HOUR_MS;
const RESOLVE_GRACE_MS: u64 = 168 * ORACLE_HOUR_MS;

/// The default rules with the test court: 2 deposits per seat (the floor with a court).
fn court_rules() -> Rules {
    Rules { dao: Some(dao()), treasury: treasury(), bond_per_seat: 2, ..Rules::new(owner()) }
}

/// `Contract::new` plus `set_rules` with a court, as a v3 deployment starts.
fn new_contract(usdc: AccountId, intents: Option<AccountId>, relayer: Option<AccountId>, owner: AccountId) -> Contract {
    let mut c = Contract::new(usdc, intents, relayer, owner);
    c.rules = court_rules();
    c
}

/// The host bond `event` needs (`bond_per_seat` deposits per seat).
fn bond(c: &Contract, id: u64) -> u128 {
    c.get_event(id).unwrap().bond_due.0
}

/// Older tests register guests straight away: lock the host bond first, as the host would.
fn bond_if_needed(c: &mut Contract, msg: &str, now_ms: u64) {
    let Ok(TransferMsg::Register { event_id, .. }) = serde_json::from_str::<TransferMsg>(msg) else { return };
    let Some(e) = c.get_event(event_id) else { return };
    if e.mode == EventMode::Deposit && e.bond_due.0 > 0 && e.host_bond.0 == 0 && e.status == EventStatus::Open && now_ms < e.registration_ends_at {
        let bond = e.bond_due.0;
        let msg = format!(r#"{{"action":"host_bond","event_id":{event_id}}}"#);
        assert_eq!(raw_pay_at(c, &e.host, bond, &msg, now_ms), 0);
    }
}

/// `finalize` as the current context's caller; a Deposit event is then
/// settled once the dispute window is over (no disputes).
fn close(c: &mut Contract, id: u64, attended: Vec<AccountId>) {
    let caller = env::predecessor_account_id();
    c.finalize(id, attended);
    let e = c.get_event(id).unwrap();
    if e.status == EventStatus::Submitted {
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), e.challenge_ends_at * 1_000_000);
        c.settle(id);
        ctx_at(&caller, one_yocto(), e.challenge_ends_at * 1_000_000);
    }
}

fn register(c: &mut Contract, id: u64, guest: &AccountId) {
    let refund = pay(c, guest, 10 * USDC, &format!(r#"{{"action":"register","event_id":{}}}"#, id));
    assert_eq!(refund, 0);
}

#[test]
fn full_cycle_attendees_split_pool() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4), accounts(5)] {
        register(&mut c, id, &g);
    }
    ctx(&accounts(1), one_yocto());
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(3), accounts(4)]);

    // 4 x 10 = 40, split by 3 attendees; 1 unit of dust goes to the host, with its 50 USDC bond.
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Finalized);
    assert_eq!(e.total_pool.0, 40 * USDC);
    assert_eq!(e.payout_per_attendee.0, 40 * USDC / 3);
    assert_eq!(c.balance_of(accounts(2)).0, 40 * USDC / 3);
    assert_eq!(c.balance_of(accounts(5)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 40 * USDC - 3 * (40 * USDC / 3) + bond(&c, id));
}

#[test]
fn remainder_goes_to_host() {
    let (mut c, _) = setup(10);
    ctx(&accounts(0), NearToken::from_near(5));
    let id = c.create_event(meta(), U128(10 * USDC + 1), 10, None, None);
    for g in [accounts(2), accounts(3), accounts(4)] {
        pay(&mut c, &g, 10 * USDC + 1, &format!(r#"{{"action":"register","event_id":{id}}}"#));
    }
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(3)]);
    // 30 USDC + 3 units split by 2 → 1 unit remainder to host, plus the bond back.
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC + 1);
    assert_eq!(c.balance_of(accounts(0)).0, 1 + bond(&c, id));
}

#[test]
fn nobody_attended_refunds_everyone() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
}

#[test]
fn paying_for_another_guest_is_refunded() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    let refund = pay(&mut c, &accounts(2), 12 * USDC, &msg);
    assert_eq!(refund, 12 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(3)), None);
    assert_eq!(c.get_guest_status(id, accounts(2)), None);
    assert_eq!(c.get_event(id).unwrap().guest_count, 0);
}

#[test]
fn naming_yourself_as_guest_registers_and_returns_change() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(2));
    assert_eq!(pay(&mut c, &accounts(2), 12 * USDC, &msg), 2 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(2)), Some(GuestStatus::Registered));
    assert_eq!(c.get_guests(id, None, None)[0].account_id, accounts(2));
}

#[test]
fn finalize_counts_a_duplicate_once() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().attended_count, 1);
    assert_eq!(c.balance_of(accounts(2)).0, 20 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(2)), Some(GuestStatus::Attended));
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
}

#[test]
#[should_panic(expected = "Only USDC is accepted")]
fn rejects_other_tokens() {
    let (mut c, id) = setup(10);
    ctx(&accounts(5), NearToken::from_yoctonear(0));
    let _ = c.ft_on_transfer(accounts(2), U128(10 * USDC), format!(r#"{{"action":"register","event_id":{}}}"#, id));
}

#[test]
fn rejects_underpayment() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay(&mut c, &accounts(2), USDC, &msg), USDC);
}

#[test]
fn rejects_double_registration() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay(&mut c, &accounts(2), 10 * USDC, &msg), 10 * USDC);
    assert_eq!(c.get_event(id).unwrap().guest_count, 1);
}

#[test]
fn rejects_when_full() {
    let (mut c, id) = setup(1);
    register(&mut c, id, &accounts(2));
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay(&mut c, &accounts(3), 10 * USDC, &msg), 10 * USDC);
    assert_eq!(c.get_event(id).unwrap().guest_count, 1);
}

#[test]
#[should_panic(expected = "Only the host")]
fn guest_cannot_finalize() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(2));
    close(&mut c, id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "Only the host")]
fn door_helper_cannot_finalize() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(1));
    close(&mut c, id, vec![]);
}

#[test]
fn no_registration_after_finalize() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay(&mut c, &accounts(2), 10 * USDC, &msg), 10 * USDC);
}

#[test]
fn create_event_is_free_for_the_host() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None, None);
    assert!(c.free_log.contains_key(&accounts(0)));
    assert_eq!(c.get_event(id).unwrap().guest_count, 0);
    // Nothing is sent back to the host: no storage refunds exist any more.
    assert!(get_created_receipts().is_empty());
}

#[test]
#[should_panic(expected = "storage pool is empty")]
fn create_event_fails_clearly_when_the_storage_pool_is_empty() {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(accounts(0))
        .account_balance(NearToken::from_millinear(1))
        .build());
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
}

#[test]
fn one_event_cannot_consume_another_events_storage() {
    let (mut c, id) = setup(10);
    c.events.flush();
    c.free_log.flush();
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(accounts(1))
        .storage_usage(env::storage_usage())
        .account_balance(NearToken::from_yoctonear(bytes_cost(env::storage_usage() + c.reserved_bytes)))
        .build());
    assert_eq!(c.unreserved_storage(), 0);
    let reserve = c.reserved_bytes;
    register(&mut c, id, &accounts(2));
    assert_eq!(c.reserved_bytes, reserve - STORAGE_BYTES_PER_GUEST);
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    assert_eq!(c.reserved_bytes, 0);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
#[should_panic(expected = "storage pool is empty")]
fn open_event_reservations_cannot_be_reused() {
    let (mut c, _) = setup(10);
    c.events.flush();
    c.free_log.flush();
    let used = env::storage_usage();
    let second = EVENT_RECORD_BYTES + SEAT_BYTES + EVENT_BALANCES_BYTES;
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(accounts(1))
        .storage_usage(used)
        .account_balance(NearToken::from_yoctonear(bytes_cost(used + second)))
        .build());
    c.create_event(meta(), U128(10 * USDC), 1, None, None);
}

#[test]
fn dust_for_unknown_guests_cannot_create_balance_keys() {
    let (mut c, _) = setup(10);
    let reserve = c.reserved_bytes;
    for i in 0..16 {
        let guest: AccountId = format!("guest{i}.testnet").parse().unwrap();
        let msg = format!(r#"{{"action":"register","event_id":99,"guest":"{guest}"}}"#);
        assert_eq!(pay(&mut c, &accounts(2), 1, &msg), 1);
        assert!(!c.balances.contains_key(&guest));
    }
    assert_eq!(c.reserved_bytes, reserve);
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn third_free_event_in_30_days_without_storage_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    for _ in 0..=FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None, None);
    }
}

fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let to = receipt.receiver_id.clone();
            receipt.actions.into_iter().filter_map(move |action| match action {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

#[test]
fn create_event_cost_is_zero_on_the_free_tier_only() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let host = accounts(0);
    assert_eq!(c.create_event_cost(host.clone(), FREE_MAX_CAPACITY, None).0, 0);
    let big = c.create_event_cost(host.clone(), FREE_MAX_CAPACITY + 1, None).0;
    assert_eq!(big, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 51 + EVENT_BALANCES_BYTES));
    for _ in 0..FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None, None);
    }
    assert_eq!(c.create_event_cost(host.clone(), 10, None).0, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + EVENT_BALANCES_BYTES));
    // Another host still has the free tier.
    assert_eq!(c.create_event_cost(accounts(1), 10, None).0, 0);
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn big_event_without_storage_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), FREE_MAX_CAPACITY + 1, None, None);
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn big_event_with_too_little_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost - 1));
    c.create_event(meta(), U128(10 * USDC), 60, None, None);
}

#[test]
fn paid_event_keeps_the_cost_and_returns_the_excess() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), MAX_CAPACITY, None).0;
    let extra = NearToken::from_near(1).as_yoctonear();
    ctx(&accounts(0), NearToken::from_yoctonear(cost + extra));
    let id = c.create_event(meta(), U128(10 * USDC), MAX_CAPACITY, None, None);
    assert_eq!(c.get_event(id).unwrap().capacity, MAX_CAPACITY);
    assert_eq!(transfers(), vec![(accounts(0), extra)]);
    // Same reservation as a free event of that size.
    assert_eq!(c.reserved_bytes, SEAT_BYTES * u64::from(MAX_CAPACITY) + EVENT_BALANCES_BYTES);
    // A paid event does not use up the host's free events.
    assert!(c.free_log.get(&accounts(0)).is_none());
}

#[test]
fn exact_cost_sends_nothing_back() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), 51, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(10 * USDC), 51, None, None);
    assert!(transfers().is_empty());
}

#[test]
fn paid_third_event_is_accepted() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    for _ in 0..FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None, None);
    }
    let cost = c.create_event_cost(accounts(0), 10, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
    assert_eq!(c.events.len(), 3);
}

#[test]
fn free_event_returns_attached_near() {
    ctx(&accounts(0), NearToken::from_near(2));
    let mut c = new_contract(usdc(), None, None, owner());
    let before = c.unreserved_storage();
    c.create_event(meta(), U128(10 * USDC), FREE_MAX_CAPACITY, None, None);
    assert_eq!(transfers(), vec![(accounts(0), NearToken::from_near(2).as_yoctonear())]);
    assert!(before < env::account_balance().as_yoctonear(), "attached NEAR is not the pool");
}

#[test]
#[should_panic(expected = "storage pool is empty")]
fn attached_near_does_not_pay_for_a_free_event() {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(accounts(0))
        .account_balance(NearToken::from_near(1))
        .attached_deposit(NearToken::from_near(1))
        .build());
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
}

#[test]
fn closing_a_free_event_does_not_give_its_slot_back() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    for _ in 0..FREE_MAX_EVENTS {
        let id = c.create_event(meta(), U128(10 * USDC), 10, None, None);
        ctx(&accounts(0), one_yocto());
        c.cancel(id);
        ctx(&accounts(0), NearToken::from_yoctonear(0));
    }
    assert!(c.create_event_cost(accounts(0), 10, None).0 > 0);
    // Another host is not affected by this host's limit.
    assert_eq!(c.create_event_cost(accounts(1), 10, None).0, 0);
}

#[test]
fn a_free_slot_opens_30_days_after_the_oldest_free_event() {
    let at = |ms: u64| ctx_at(&accounts(0), NearToken::from_yoctonear(0), ms * 1_000_000);
    let t0 = 1_000_000;
    let t1 = t0 + 1_000;
    at(t0);
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
    at(t1);
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
    at(t0 + FREE_WINDOW_MS - 1);
    assert!(c.create_event_cost(accounts(0), 10, None).0 > 0);
    at(t0 + FREE_WINDOW_MS);
    assert_eq!(c.create_event_cost(accounts(0), 10, None).0, 0);
    c.create_event(meta(), U128(10 * USDC), 10, None, None);
    // The next slot waits for the second event's window.
    assert!(c.create_event_cost(accounts(0), 10, None).0 > 0);
    at(t1 + FREE_WINDOW_MS);
    assert_eq!(c.create_event_cost(accounts(0), 10, None).0, 0);
}

#[test]
#[should_panic(expected = "Deposit must be at least 0.1 USDC")]
fn dust_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(MIN_DEPOSIT - 1), 10, None, None);
}

#[test]
fn withdraw_debits_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(4 * USDC)), None, None);
    assert_eq!(c.balance_of(accounts(2)).0, 6 * USDC);
}

#[test]
fn self_overpayment_is_returned() {
    let (mut c, id) = setup(10);
    let refund = pay(&mut c, &accounts(2), 12 * USDC, &format!(r#"{{"action":"register","event_id":{}}}"#, id));
    assert_eq!(refund, 2 * USDC);
}

#[test]
fn intents_payment_for_full_event_refunds_to_verifier() {
    let (mut c, id) = setup(1);
    register(&mut c, id, &accounts(2));
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    let refund = pay(&mut c, &intents, 10 * USDC, &msg);
    assert_eq!(refund, 10 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(3)), None);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
}

#[test]
fn intents_payment_registers_guest() {
    let (mut c, id) = setup(10);
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    pay(&mut c, &intents, 10 * USDC, &msg);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
}

#[test]
fn relayer_can_push_payout_to_owners_intents_account() {
    let relayer: AccountId = "relayer.testnet".parse().unwrap();
    let (mut c, id) = setup_with_relayer(10, relayer.clone());
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, evm);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![evm.clone()]);
    assert_eq!(c.balance_of(evm.clone()).0, 10 * USDC);
    ctx(&relayer, NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(evm.clone(), None);
    assert_eq!(c.balance_of(evm).0, 0);
}

#[test]
#[should_panic(expected = "Only the owner or the relayer")]
fn stranger_cannot_payout_to_intents() {
    let (mut c, id) = setup_with_relayer(10, accounts(4));
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, evm);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![evm.clone()]);
    ctx(&accounts(5), NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(evm, None);
}

#[test]
#[should_panic(expected = "Too many accounts")]
fn finalize_rejects_an_oversized_list() {
    let (mut c, id) = setup(10);
    let too_many: Vec<AccountId> = (0..=MAX_CAPACITY)
        .map(|i| format!("guest{}.testnet", i).parse().unwrap())
        .collect();
    ctx_ended(&accounts(0));
    close(&mut c, id, too_many);
}

#[test]
#[should_panic(expected = "Event must end within a year")]
fn rejects_far_future_events() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    let mut m = meta();
    m.ends_at = u64::MAX;
    c.create_event(m, U128(10 * USDC), 10, None, None);
}

#[test]
#[should_panic(expected = "must name the guest")]
fn intents_payment_must_name_guest() {
    let (mut c, id) = setup(10);
    let intents: AccountId = "intents.near".parse().unwrap();
    pay(&mut c, &intents, 10 * USDC, &format!(r#"{{"action":"register","event_id":{}}}"#, id));
}

/// A Sputnik DAO is just another account. It can host and finalize; the door
/// team that checks guests in lives off-chain.
#[test]
fn contract_account_can_host() {
    let dao: AccountId = "community.sputnik-v2.testnet".parse().unwrap();
    ctx(&dao, NearToken::from_near(5));
    let mut c = new_contract(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None, None);
    assert_eq!(c.get_event(id).unwrap().host, dao);

    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));

    ctx(&accounts(1), one_yocto());
    ctx_ended(&dao);
    close(&mut c, id, vec![accounts(2)]);

    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.get_event(id).unwrap().payout_per_attendee.0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(2)).0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    // The DAO host gets its bond back.
    assert_eq!(c.balance_of(dao).0, bond(&c, id));
}

#[test]
fn third_party_short_payment_returns_to_payer() {
    let (mut c, id) = setup(10);
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &intents, USDC, &msg);
    assert_eq!(refund, USDC);
    assert_eq!(c.get_guest_status(id, accounts(3)), None);
    assert_eq!(c.balance_of(accounts(3)).0, 0);

    let friend_msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(4));
    let refund = pay(&mut c, &accounts(2), 4 * USDC, &friend_msg);
    assert_eq!(refund, 4 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(4)), None);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
}

#[test]
fn third_party_payment_for_missing_or_closed_event_returns_to_payer() {
    let (mut c, id) = setup(10);
    let missing = format!(r#"{{"action":"register","event_id":99,"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &missing);
    assert_eq!(refund, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 0);

    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    let closed = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(4));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &closed);
    assert_eq!(refund, 10 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(4)), None);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
}

#[test]
fn self_payment_for_a_missing_event_still_refunds() {
    let (mut c, _) = setup(10);
    assert_eq!(pay(&mut c, &accounts(2), 10 * USDC, r#"{"action":"register","event_id":99}"#), 10 * USDC);
}

#[test]
fn second_payment_for_registered_guest_returns_to_payer() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(3));
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &msg);
    assert_eq!(refund, 10 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.get_event(id).unwrap().guest_count, 1);
}

#[test]
#[should_panic(expected = "Invalid msg")]
fn rejects_garbage_transfer_msg() {
    let (mut c, id) = setup(10);
    let _ = id;
    pay(&mut c, &accounts(2), 10 * USDC, "not-json");
}

#[test]
fn check_ins_and_dust_still_add_up_to_the_pool() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(4)]);

    // 3 seats × 10 USDC, split by 2 attendees.
    let pool = 30 * USDC;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(4)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    let bond = bond(&c, id);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2 + bond);
    let paid_out = c.balance_of(accounts(2)).0
        + c.balance_of(accounts(4)).0
        + c.balance_of(accounts(0)).0;
    assert_eq!(paid_out, 30 * USDC + bond);
}

#[test]
fn empty_event_can_be_finalized() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_finalize_twice() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    close(&mut c, id, vec![]);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_cancel_a_finalized_event() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    c.cancel(id);
}

#[test]
#[should_panic(expected = "The event has not ended yet")]
fn host_cannot_finalize_before_the_event_ends() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at - 1) * 1_000_000);
    close(&mut c, id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "The event has not ended yet")]
fn ticket_host_cannot_finalize_before_the_event_ends() {
    let (mut c, id) = setup_tickets(10);
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at - 1) * 1_000_000);
    close(&mut c, id, vec![]);
}

#[test]
fn host_can_finalize_once_the_event_ends() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

// M-01: no new deposits once the event is over.
#[test]
fn deposit_registration_closes_at_the_start() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay_at(&mut c, &accounts(2), 10 * USDC, &msg, meta().starts_at - 1), 0);
    assert!(c.get_guest_status(id, accounts(2)).is_some());
    // From the start the host sees who came, so no more seats (audit E-H1).
    assert_eq!(pay_at(&mut c, &accounts(3), 10 * USDC, &msg, meta().starts_at), 10 * USDC);
    assert!(c.get_guest_status(id, accounts(3)).is_none());
    // The same through NEAR Intents, which names the guest.
    let named = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(4));
    assert_eq!(raw_pay_at(&mut c, &"intents.near".parse().unwrap(), 10 * USDC, &named, meta().starts_at), 10 * USDC);
    assert!(c.get_guest_status(id, accounts(4)).is_none());
    assert_eq!(c.get_event(id).unwrap().registration_ends_at, meta().starts_at);
}

#[test]
fn ticket_registration_closes_when_the_event_ends() {
    let (mut c, id) = setup_tickets(10);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay_at(&mut c, &accounts(2), TICKET, &msg, meta().ends_at - 1), 0);
    assert_eq!(pay_at(&mut c, &accounts(3), TICKET, &msg, meta().ends_at), TICKET);
    assert_eq!(c.get_event(id).unwrap().registration_ends_at, meta().ends_at);
}

#[test]
fn the_bond_is_deposits_per_seat() {
    for capacity in [1, 10, 300] {
        let (c, id) = setup(capacity);
        assert_eq!(bond(&c, id), 2 * 10 * USDC * u128::from(capacity), "2 deposits per seat (court_rules)");
    }
    let (c, id) = setup_tickets(10);
    assert_eq!(bond(&c, id), 0, "tickets take no bond");
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn the_end_alone_does_not_let_a_stranger_cancel() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let after_end_ns = (meta().ends_at + 1) * 1_000_000;
    ctx_at(&accounts(5), one_yocto(), after_end_ns);
    c.cancel(id);
}

#[test]
fn stranger_can_cancel_a_ticket_event_one_millisecond_after_the_grace_period() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), one_yocto(), (boundary_ms + 1) * 1_000_000);
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    // Ticket money stays with the host.
    assert_eq!(c.balance_of(accounts(2)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn stranger_cannot_cancel_on_the_exact_grace_timestamp() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), one_yocto(), boundary_ms * 1_000_000);
    c.cancel(id);
}

#[test]
fn ticket_event_created_already_past_the_grace_period_can_be_cancelled_by_anyone() {
    let now_ms = ABANDON_GRACE_MS + 60_000;
    ctx_at(&accounts(0), NearToken::from_near(5), now_ms * 1_000_000);
    let mut c = new_contract(usdc(), None, None, owner());
    let mut m = meta();
    m.starts_at = 0;
    m.ends_at = 0;
    let id = c.create_event(m, U128(10 * USDC), 10, Some(EventMode::Ticket), None);
    // It has already ended, so it takes no deposits.
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay_at(&mut c, &accounts(2), 10 * USDC, &msg, now_ms), 10 * USDC);
    let stranger: AccountId = "stranger.testnet".parse().unwrap();
    ctx_at(&stranger, one_yocto(), now_ms * 1_000_000);
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
}

#[test]
fn largest_event_fits_the_reserved_record_size() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    c.events.flush();
    let before = env::storage_usage();
    let mut m = meta();
    m.title = "t".repeat(MAX_TITLE_LEN);
    let host: AccountId = format!("{:064x}", 99).parse().unwrap();
    ctx(&host, NearToken::from_yoctonear(0));
    c.create_event(m, U128(MIN_DEPOSIT), FREE_MAX_CAPACITY, None, None);
    c.events.flush();
    assert!(env::storage_usage() - before <= EVENT_RECORD_BYTES);
}

#[test]
fn one_seat_fits_the_reserved_guest_size_for_a_guest_with_history() {
    let guest: AccountId = format!("{:064x}", 7).parse().unwrap();
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let mut max_used = 0u64;
    for i in 0..24 {
        let host: AccountId = format!("host{i}.testnet").parse().unwrap();
        ctx(&host, NearToken::from_yoctonear(0));
        let id = c.create_event(meta(), U128(10 * USDC), 1, None, None);
        c.event_mut(id).host_bond = 50 * USDC;
        c.events.flush();
        c.free_log.flush();
        // Measure inside one context: every `testing_env!` restarts the storage counter.
        ctx_at(&usdc(), NearToken::from_yoctonear(0), 1_000_000 * 1_000_000);
        let before = env::storage_usage();
        c.register(id, guest.clone(), guest.clone());
        c.events.flush();
        c.guests.flush();
        c.guest_index.flush();
        max_used = max_used.max(env::storage_usage() - before);
    }
    assert!(
        max_used <= STORAGE_BYTES_PER_GUEST,
        "one registration used {max_used} bytes, the reserved seat is {STORAGE_BYTES_PER_GUEST}"
    );
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_rejects_zero() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(0)), None, None);
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn withdraw_rejects_more_than_the_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(11 * USDC)), None, None);
}

#[test]
fn withdraw_schedules_a_token_transfer_and_a_callback() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let other: AccountId = "other.testnet".parse().unwrap();
    let _ = c.withdraw(Some(U128(4 * USDC)), Some(other.clone()), Some(false));
    assert_eq!(c.balance_of(accounts(2)).0, 6 * USDC);

    let calls = function_calls();
    let transfer = calls.iter().find(|c| c.0 == "ft_transfer").expect("ft_transfer");
    let args: serde_json::Value = serde_json::from_slice(&transfer.1).unwrap();
    assert_eq!(args["receiver_id"], other.as_str());
    assert_eq!(args["amount"], "4000000");
    assert_eq!(transfer.2, Gas::from_tgas(10).as_gas());
    assert_eq!(transfer.3, 1);
    let callback = calls.iter().find(|c| c.0 == "on_withdraw").expect("callback");
    assert_eq!(callback.2, Gas::from_tgas(10).as_gas());
}

#[test]
fn payout_to_intents_names_the_owner_in_the_token_message() {
    let (mut c, id) = setup_with_relayer(10, accounts(4));
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{evm}"}}"#);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![evm.clone()]);
    // The owner path currently does not require 1 yocto. The relayer path
    // cannot require it: the web relayer calls this with no deposit.
    ctx(&evm, NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(evm.clone(), None);
    assert_eq!(c.balance_of(evm.clone()).0, 0);
    let calls = function_calls();
    let transfer = calls.iter().find(|c| c.0 == "ft_transfer_call").expect("ft_transfer_call");
    let args: serde_json::Value = serde_json::from_slice(&transfer.1).unwrap();
    assert_eq!(args["receiver_id"], "intents.near");
    assert_eq!(args["msg"], evm.as_str());
    assert_eq!(transfer.2, Gas::from_tgas(100).as_gas());
}

#[test]
fn failed_withdraw_callback_restores_the_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(None, None, None);
    assert_eq!(c.balance_of(accounts(2)).0, 0);

    #[allow(deprecated)]
    testing_env_with_promise_results(
        VMContextBuilder::new()
            .current_account_id(contract_account())
            .predecessor_account_id(contract_account())
            .build(),
        PromiseResult::Failed,
    );
    let sent = c.on_withdraw(accounts(2), U128(10 * USDC), false);
    assert_eq!(sent.0, 0);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
fn intents_callback_keeps_only_the_unused_amount() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(None, None, Some(true));
    assert_eq!(c.balance_of(accounts(2)).0, 0);

    let used = serde_json::to_vec(&U128(4 * USDC)).unwrap();
    #[allow(deprecated)]
    testing_env_with_promise_results(
        VMContextBuilder::new()
            .current_account_id(contract_account())
            .predecessor_account_id(contract_account())
            .build(),
        PromiseResult::Successful(used),
    );
    let sent = c.on_withdraw(accounts(2), U128(10 * USDC), true);
    assert_eq!(sent.0, 4 * USDC);
    assert_eq!(c.balance_of(accounts(2)).0, 6 * USDC);
}

#[test]
#[should_panic(expected = "Intents not configured")]
fn payout_to_intents_without_intents_panics() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None, None);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(accounts(2), None);
}

#[test]
#[should_panic(expected = "Deposit is too large")]
fn finalize_does_not_wrap_a_huge_pool() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    let deposit = u128::MAX / 2 + 1;
    let id = c.create_event(meta(), U128(deposit), 2, None, None);
    for guest in [accounts(2), accounts(3)] {
        let refund = pay(&mut c, &guest, deposit, &format!(r#"{{"action":"register","event_id":{id}}}"#));
        assert_eq!(refund, 0);
    }
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(3)]);
}

#[test]
fn large_but_safe_pool_splits_exactly() {
    let (mut c, _) = setup(10);
    // Replace the default event by using its deposit? setup uses 10 USDC.
    // A second event carries the large deposit.
    ctx(&accounts(0), NearToken::from_near(5));
    let deposit = 1_000_000_000_000_000_000u128;
    let big = c.create_event(meta(), U128(deposit), 4, None, None);
    for guest in [accounts(2), accounts(3), accounts(4)] {
        let refund = pay(&mut c, &guest, deposit, &format!(r#"{{"action":"register","event_id":{big}}}"#));
        assert_eq!(refund, 0);
    }
    ctx_ended(&accounts(0));
    close(&mut c, big, vec![accounts(2), accounts(3)]);
    let pool = deposit * 3;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, share);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2 + bond(&c, big));
    assert_eq!(c.balance_of(accounts(4)).0, 0);
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn door_helper_cannot_cancel_before_the_grace_period() {
    let (mut c, id) = setup(10);
    ctx(&accounts(1), one_yocto());
    c.cancel(id);
}

#[test]
#[should_panic(expected = "Capacity out of range")]
fn capacity_above_the_max_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(USDC), MAX_CAPACITY + 1, None, None);
}

#[test]
#[should_panic(expected = "Deposit must be at least 0.1 USDC")]
fn zero_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(0), 10, None, None);
}

#[test]
#[should_panic(expected = "Bad title")]
fn blank_title_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    let mut m = meta();
    m.title = "   ".into();
    c.create_event(m, U128(USDC), 10, None, None);
}

#[test]
#[should_panic(expected = "Event ends before it starts")]
fn inverted_times_are_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), None, None, owner());
    let mut m = meta();
    m.starts_at = 50;
    m.ends_at = 40;
    c.create_event(m, U128(USDC), 10, None, None);
}

#[test]
fn views_paginate_and_unknown_balances_are_zero() {
    let (mut c, id) = setup(10);
    for guest in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &guest);
    }
    assert!(c.get_event(99).is_none());
    assert!(c.get_event(1u64 << 32).is_none());
    assert_eq!(c.get_recent_events(Some(1_000)).len(), 1);
    assert_eq!(c.get_guests(id, Some(1), Some(1)).len(), 1);
    assert_eq!(c.get_guests(id, Some(1), Some(1))[0].account_id, accounts(3));
    assert!(c.get_guests(id, Some(50), Some(10)).is_empty());
    let unknown: AccountId = "unknown.testnet".parse().unwrap();
    assert_eq!(c.balance_of(unknown).0, 0);
    assert_eq!(
        c.get_guest_statuses(accounts(2), vec![id, 99]),
        vec![Some(GuestStatus::Registered), None]
    );
}

#[test]
#[should_panic(expected = "is not registered")]
fn finalize_with_an_unknown_guest_fails() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2), accounts(3)]);
}

#[test]
fn dust_payment_for_a_new_name_is_refunded() {
    let (mut c, _) = setup(10);
    let msg = r#"{"action":"register","event_id":99,"guest":"made-up.testnet"}"#;
    assert_eq!(pay(&mut c, &accounts(4), MIN_DEPOSIT - 1, msg), MIN_DEPOSIT - 1);
}

#[test]
fn dust_payment_cannot_top_up_an_existing_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    let msg = format!(r#"{{"action":"register","event_id":99,"guest":"{}"}}"#, accounts(2));
    assert_eq!(pay(&mut c, &accounts(4), 1, &msg), 1);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

fn function_calls() -> Vec<(String, Vec<u8>, u64, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| receipt.actions)
        .filter_map(|action| match action {
            MockAction::FunctionCallWeight { method_name, args, prepaid_gas, attached_deposit, .. } => {
                Some((
                    String::from_utf8(method_name).unwrap_or_default(),
                    args,
                    prepaid_gas.as_gas(),
                    attached_deposit.as_yoctonear(),
                ))
            }
            _ => None,
        })
        .collect()
}

#[test]
#[should_panic(expected = "Invalid msg")]
fn sponsor_action_is_no_longer_accepted() {
    let (mut c, id) = setup(10);
    pay(&mut c, &accounts(4), USDC, &format!(r#"{{"action":"sponsor","event_id":{id}}}"#));
}

// ------------------------------------------------------------ ticket mode

const TICKET: u128 = 20 * USDC;
/// 2,500,000 ms: after `meta().starts_at`, in nanoseconds.
const AFTER_START_NS: u64 = 2_500_000 * 1_000_000;

/// Host = accounts(0), 20 USDC ticket.
fn setup_tickets(capacity: u32) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = new_contract(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(TICKET), capacity, Some(EventMode::Ticket), None);
    (c, id)
}

fn buy(c: &mut Contract, id: u64, guest: &AccountId) {
    let refund = pay(c, guest, TICKET, &format!(r#"{{"action":"register","event_id":{id}}}"#));
    assert_eq!(refund, 0);
}

#[test]
fn deposit_is_the_default_mode() {
    let (c, id) = setup(10);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.mode, EventMode::Deposit);
    assert_eq!(e.deposit.0, 10 * USDC);
}

#[test]
fn ticket_event_shows_mode_and_price() {
    let (c, id) = setup_tickets(10);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.mode, EventMode::Ticket);
    assert_eq!(e.deposit.0, TICKET);
}

#[test]
fn ticket_host_is_paid_at_registration() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
    buy(&mut c, id, &accounts(3));
    buy(&mut c, id, &accounts(4));
    assert_eq!(c.balance_of(accounts(0)).0, 3 * TICKET);
    assert_eq!(c.get_event(id).unwrap().total_pool.0, 3 * TICKET);

    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    // Finalize only closes: attended or not, nobody gets a share and the host gets nothing more.
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Finalized);
    assert_eq!(e.payout_per_attendee.0, 0);
    assert_eq!(e.attended_count, 1);
    assert_eq!(c.balance_of(accounts(0)).0, 3 * TICKET);
    assert_eq!(c.balance_of(accounts(2)).0, 0);
}

#[test]
fn ticket_host_can_withdraw_before_the_event() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.withdraw(None, None, None);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
    buy(&mut c, id, &accounts(3));
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
}

#[test]
fn ticket_finalize_closes_and_releases_the_reserve() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    let reserved = c.reserved_bytes;
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
    assert!(c.reserved_bytes < reserved);
    assert_eq!(c.reserved_bytes, 0);
}

#[test]
fn ticket_cancel_refunds_nothing() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    buy(&mut c, id, &accounts(3));
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 0);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 2 * TICKET);
    assert_eq!(c.reserved_bytes, 0);
}

#[test]
fn ticket_abandoned_event_just_closes() {
    let (mut c, id) = setup_tickets(10);
    buy(&mut c, id, &accounts(2));
    let late_ms = meta().ends_at + ABANDON_GRACE_MS + 1;
    ctx_at(&accounts(5), one_yocto(), late_ms * 1_000_000);
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
}

#[test]
fn ticket_short_payment_returns_to_verifier() {
    let (mut c, id) = setup_tickets(10);
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(2));
    let refund = pay(&mut c, &"intents.near".parse().unwrap(), TICKET - 1, &msg);
    assert_eq!(refund, TICKET - 1);
    assert_eq!(c.get_guest_status(id, accounts(2)), None);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
fn ticket_via_intents_pays_the_host() {
    let (mut c, id) = setup_tickets(10);
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(2));
    assert_eq!(pay(&mut c, &"intents.near".parse().unwrap(), TICKET, &msg), 0);
    assert_eq!(c.get_guest_status(id, accounts(2)), Some(GuestStatus::Registered));
    assert_eq!(c.balance_of(accounts(0)).0, TICKET);
}

#[test]
fn ticket_money_matches_the_usdc_held() {
    // Everything credited equals everything paid in: no USDC created or lost.
    let (mut c, id) = setup_tickets(10);
    for g in [accounts(2), accounts(3), accounts(4), accounts(5)] {
        buy(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![]);
    let total: u128 = [accounts(0), accounts(2), accounts(3), accounts(4), accounts(5)]
        .into_iter()
        .map(|a| c.balance_of(a).0)
        .sum();
    assert_eq!(total, 4 * TICKET);
}


// ------------------------------------------------------- cancel and limits

#[test]
fn host_can_cancel_before_the_start_and_everyone_is_refunded() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx_at(&accounts(0), one_yocto(), (meta().starts_at - 1) * 1_000_000);
    c.cancel(id);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Cancelled);
    assert!(e.closed_at > 0);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
    // The host bond comes back too.
    assert_eq!(c.balance_of(accounts(0)).0, bond(&c, id));
}

#[test]
#[should_panic(expected = "The event has started")]
fn host_cannot_cancel_a_bonded_event_once_it_starts() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_at(&accounts(0), one_yocto(), meta().starts_at * 1_000_000);
    c.cancel(id);
}

#[test]
fn host_can_cancel_an_event_without_a_bond_at_any_time() {
    let (mut c, id) = setup(10);
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at + 1) * 1_000_000);
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn cancel_needs_one_yocto() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.cancel(id);
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn stranger_cannot_cancel_before_the_event_ends() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(5), one_yocto());
    c.cancel(id);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cancel_twice_is_rejected() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    c.cancel(id);
}

#[test]
fn many_events_from_many_hosts_and_recent_views_page() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    for i in 0..120 {
        let host: AccountId = format!("host{i}.testnet").parse().unwrap();
        ctx(&host, NearToken::from_yoctonear(0));
        c.create_event(meta(), U128(MIN_DEPOSIT), 1, None, None);
    }
    assert_eq!(c.events.len(), 120);
    assert_eq!(c.get_recent_events(None).len(), 50);
    assert_eq!(c.get_recent_events(Some(1_000)).len(), 100);
    assert_eq!(c.get_recent_events(Some(1))[0].id, 119);
}

#[test]
fn max_capacity_event_is_accepted() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), MAX_CAPACITY, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 300, None, None);
    assert_eq!(c.get_event(id).unwrap().capacity, 300);
}

// ------------------------------------------------------- attendance status

#[test]
fn statuses_turn_final_only_at_settlement() {
    let (mut c, a) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, a, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(a, vec![accounts(2), accounts(2), accounts(3)]);
    // Submitted: the host's list is visible, statuses are not final yet.
    let guests = c.get_guests(a, None, None);
    assert_eq!(guests.iter().map(|g| g.listed).collect::<Vec<_>>(), vec![true, true, false]);
    assert!(guests.iter().all(|g| g.status == GuestStatus::Registered));
    assert_eq!(c.get_event(a).unwrap().attended_count, 2);
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), c.get_event(a).unwrap().challenge_ends_at * 1_000_000);
    c.settle(a);
    assert_eq!(c.get_guest_status(a, accounts(2)), Some(GuestStatus::Attended));
    assert_eq!(c.get_guest_status(a, accounts(3)), Some(GuestStatus::Attended));
    assert_eq!(c.get_guest_status(a, accounts(4)), Some(GuestStatus::Registered));
}

/// Worst case: 64-char accounts and a 120-char title. Prints the measured
/// sizes (`cargo test -- --nocapture`) the constants in `lib.rs` are based on.
#[test]
fn storage_reserves_cover_the_measured_worst_case() {
    let long = |n: u32| -> AccountId { format!("{:064x}", n).parse().unwrap() };
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = new_contract(usdc(), None, None, owner());
    c.rules.dao = Some(long(7_777));
    c.rules.treasury = long(8_888);
    c.rules.bond_per_seat = 1;
    c.events.flush();
    let host = long(9_999);
    ctx(&host, NearToken::from_yoctonear(0));
    let before = env::storage_usage();
    let mut m = meta();
    m.title = "t".repeat(MAX_TITLE_LEN);
    let id = c.create_event(m, U128(MIN_DEPOSIT), 8, None, None);
    c.events.flush();
    let event_bytes = env::storage_usage() - before;
    let before = env::storage_usage();
    c.free_log.flush();
    let log_bytes = env::storage_usage() - before;

    let guests: Vec<AccountId> = (0..8).map(long).collect();
    // One context per measurement: every `testing_env!` restarts the storage counter.
    ctx_at(&usdc(), NearToken::from_yoctonear(0), 1_000_000 * 1_000_000);
    c.event_mut(id).host_bond = bond_due(c.event(id));
    let before = env::storage_usage();
    for g in &guests {
        c.register(id, g.clone(), g.clone());
    }
    c.events.flush();
    c.guests.flush();
    c.guest_index.flush();
    let seat_bytes = (env::storage_usage() - before) / 8;

    ctx_ended(&host);
    c.finalize(id, guests[..7].to_vec());
    // The 8th guest says they came, and the DAO agrees (the verdict is stored too).
    c.guests.flush();
    c.events.flush();
    ctx_at(&long(7_777), NearToken::from_yoctonear(0), meta().ends_at * 1_000_000);
    let before = env::storage_usage();
    c.open_dispute(id, guests[7].clone(), false, guests[7].clone(), true, MIN_DEPOSIT);
    c.resolve_dispute(id, guests[7].clone(), true);
    c.guests.flush();
    c.events.flush();
    let dispute_bytes = env::storage_usage() - before;

    ctx_at(&accounts(5), NearToken::from_yoctonear(0), c.get_event(id).unwrap().challenge_ends_at * 1_000_000);
    let before = env::storage_usage();
    // Everyone came, the winner and the treasury split the host bond: 8 guests + treasury.
    c.settle(id);
    c.balances.flush();
    c.guests.flush();
    let settle = env::storage_usage() - before;
    // The event above has no rule; the largest rule is stored inline in the same record
    // (its `None` tag is already counted).
    let max_rule = Some(AccessRule {
        past_events: vec![u64::MAX; MAX_RULE_EVENTS],
        min_attended: u8::MAX,
        max_no_shows: Some(u8::MAX),
        open_to_all_at: Some(u64::MAX),
    });
    let event_bytes = event_bytes + near_sdk::borsh::to_vec(&max_rule).unwrap().len() as u64 - 1;
    eprintln!("measured: event with the largest rule {event_bytes} B, free log {log_bytes} B, registration {seat_bytes} B/seat, dispute {dispute_bytes} B, settlement {settle} B for 8 guests + treasury");
    assert!(event_bytes <= EVENT_RECORD_BYTES, "event used {event_bytes}, reserve {EVENT_RECORD_BYTES}");
    assert!(log_bytes <= FREE_LOG_BYTES, "free log used {log_bytes}, reserve {FREE_LOG_BYTES}");
    assert!(seat_bytes <= STORAGE_BYTES_PER_GUEST, "seat used {seat_bytes}, reserve {STORAGE_BYTES_PER_GUEST}");
    assert!(dispute_bytes <= DISPUTE_BYTES, "dispute used {dispute_bytes}, reserve {DISPUTE_BYTES}");
    assert!(settle <= 8 * BALANCE_BYTES + EVENT_BALANCES_BYTES, "settlement used {settle}");
}

#[test]
fn config_reports_the_init_values() {
    ctx(&accounts(0), NearToken::from_near(5));
    let c = new_contract(usdc(), Some(intents()), Some(accounts(3)), owner());
    let cfg = c.get_config();
    assert_eq!((cfg.usdc, cfg.intents, cfg.relayer, cfg.owner), (usdc(), Some(intents()), Some(accounts(3)), owner()));
    assert!(!cfg.frozen && !cfg.whitelist_mode && !cfg.sponsored_mode);
}

// ------------------------------------------------- tp7: freeze, whitelist, Intents

fn intents() -> AccountId {
    "intents.near".parse().unwrap()
}

fn fresh(with_intents: bool) -> Contract {
    ctx(&accounts(0), NearToken::from_near(5));
    new_contract(usdc(), with_intents.then(intents), None, owner())
}

fn ctx_input(predecessor: &AccountId, deposit: NearToken, input: &[u8]) {
    let mut context = VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .block_timestamp(1_000_000_000_000)
        .build();
    context.input = input.into();
    testing_env!(context);
}

fn auth(c: &mut Contract, signer: &AccountId, msg: serde_json::Value) {
    auth_at(c, signer, msg, 1_000_000);
}

fn auth_at(c: &mut Contract, signer: &AccountId, msg: serde_json::Value, now_ms: u64) {
    ctx_at(&intents(), NearToken::from_yoctonear(0), now_ms * 1_000_000);
    let _ = c.on_auth(signer.clone(), msg.to_string());
}

fn evm_host() -> AccountId {
    "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap()
}

#[test]
fn owner_upgrade_deploys_the_code_and_runs_migrate() {
    let mut c = fresh(false);
    ctx_input(&owner(), one_yocto(), b"\0asm new code");
    let _ = c.upgrade();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, contract_account());
    assert!(matches!(&receipts[0].actions[0], MockAction::DeployContract { code, .. } if code == b"\0asm new code"));
    assert!(matches!(&receipts[0].actions[1], MockAction::FunctionCallWeight { method_name, .. } if method_name == b"migrate"));
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_upgrade() {
    let mut c = fresh(false);
    ctx_input(&accounts(1), one_yocto(), b"\0asm");
    let _ = c.upgrade();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn upgrade_needs_a_full_access_key() {
    let mut c = fresh(false);
    ctx_input(&owner(), NearToken::from_yoctonear(0), b"\0asm");
    let _ = c.upgrade();
}

#[test]
#[should_panic(expected = "Pass the new WASM")]
fn upgrade_without_code_fails() {
    let mut c = fresh(false);
    ctx_input(&owner(), one_yocto(), b"");
    let _ = c.upgrade();
}

#[test]
fn migrate_keeps_the_state() {
    let mut c = fresh(true);
    ctx(&owner(), one_yocto());
    c.add_to_whitelist(vec![accounts(1)]);
    env::state_write(&c);
    let migrated = Contract::migrate();
    assert_eq!(migrated.get_config().owner, owner());
    assert!(migrated.is_whitelisted(accounts(1)));
}

/// Root `STATE` of mainnet `escrow.lold.near` (176 bytes, read-only `view_state`
/// at block 224210379; `docs/oracle-upgrade/evidence/mainnet-readonly.json`).
const MAINNET_ROOT: &str = "QAAAADE3MjA4NjI4Zjg0ZjVkNmFkMzNmMGRhM2JiYmViMjdmZmNiMzk4ZWFjNTAxYTMxYmQ2YWQyMDExZTM2MTMzYTEBDAAAAGludGVudHMubmVhcgAAAAABAAAAAAEAAAABAQAAAAIBAAAAAwAAAAAAAAAAAQAAAAUBEgAAAGV2ZW50X3JlbGF5ZXIubmVhcgkAAABsb2xkLm5lYXIAAAEAAAAGAAEAAAAHAQAAAAg=";

/// The mainnet root (v2 layout, no events) upgrades in place: everything is
/// kept and the escrow starts with the default rules and no court.
#[test]
fn migrate_upgrades_the_v2_mainnet_root_in_place() {
    let raw: near_sdk::json_types::Base64VecU8 = serde_json::from_str(&format!("\"{MAINNET_ROOT}\"")).unwrap();
    assert_eq!(raw.0.len(), 176);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    env::storage_write(b"STATE", &raw.0);
    let c = Contract::migrate();
    let cfg = c.get_config();
    assert_eq!(cfg.owner.as_str(), "lold.near");
    assert_eq!(cfg.relayer.as_ref().map(|a| a.as_str()), Some("event_relayer.near"));
    assert_eq!(cfg.intents.as_ref().map(|a| a.as_str()), Some("intents.near"));
    assert_eq!(cfg.rules, Rules::new("lold.near".parse().unwrap()));
    assert_eq!(cfg.oracle_hour_ms, ORACLE_HOUR_MS);
    assert_eq!(c.events.len(), 0);
}

/// v2 `Event` records do not decode as v3: an old escrow with events refuses the upgrade.
#[test]
#[should_panic(expected = "Events exist")]
fn migrate_refuses_a_v2_root_with_events() {
    let mut raw: near_sdk::json_types::Base64VecU8 = serde_json::from_str(&format!("\"{MAINNET_ROOT}\"")).unwrap();
    // `events` is the third field: usdc (4 + 64), intents (1 + 4 + 12), then the Vector's length.
    let at = 4 + 64 + 1 + 4 + 12;
    raw.0[at..at + 4].copy_from_slice(&1u32.to_le_bytes());
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    env::storage_write(b"STATE", &raw.0);
    Contract::migrate();
}

#[test]
fn migrate_keeps_a_v3_escrow_with_events() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    c.events.flush();
    c.guests.flush();
    env::state_write(&c);
    let migrated = Contract::migrate();
    assert_eq!(migrated.get_event(id).unwrap().guest_count, 1);
    assert_eq!(migrated.get_config().rules, court_rules());
}

// --------------------------------------------------------- access rules

struct Past {
    c: Contract,
    /// Host accounts(0): 2 and 4 came, 3 was a no-show.
    a: u64,
    /// Host accounts(0): 3 registered, closed with nobody checked in.
    b: u64,
    /// Host accounts(1), finalized.
    other: u64,
    /// Host accounts(0), still open.
    open: u64,
}

fn past_events() -> Past {
    let (mut c, a) = setup(10);
    ctx(&accounts(0), NearToken::from_near(5));
    let b = c.create_event(meta(), U128(10 * USDC), 10, None, None);
    let open = c.create_event(later_meta(), U128(10 * USDC), 10, None, None);
    ctx(&accounts(1), NearToken::from_near(5));
    let other = c.create_event(meta(), U128(10 * USDC), 10, None, None);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, a, &g);
    }
    register(&mut c, b, &accounts(3));
    ctx_ended(&accounts(0));
    close(&mut c, a, vec![accounts(2), accounts(4)]);
    close(&mut c, b, vec![]);
    ctx_ended(&accounts(1));
    close(&mut c, other, vec![]);
    Past { c, a, b, other, open }
}

fn later_meta() -> EventMetadata {
    EventMetadata { title: "Next meetup".into(), starts_at: 5_000_000, ends_at: 6_000_000 }
}

fn rule(past_events: Vec<u64>, min_attended: u8, max_no_shows: Option<u8>, open_to_all_at: Option<u64>) -> Option<AccessRule> {
    Some(AccessRule { past_events, min_attended, max_no_shows, open_to_all_at })
}

/// The next event of accounts(0), created after the past events ended.
fn gated(c: &mut Contract, access: Option<AccessRule>) -> u64 {
    ctx_at(&accounts(0), NearToken::from_near(5), 3_500_000 * 1_000_000);
    c.create_event(later_meta(), U128(10 * USDC), 10, None, access)
}

/// Returns the refunded amount: 0 = registered, the full deposit = refused.
fn try_register(c: &mut Contract, id: u64, guest: &AccountId, now_ms: u64) -> u128 {
    pay_at(c, guest, 10 * USDC, &format!(r#"{{"action":"register","event_id":{id}}}"#), now_ms)
}

#[test]
fn regulars_register_and_newcomers_are_refunded() {
    let Past { mut c, a, .. } = past_events();
    let id = gated(&mut c, rule(vec![a], 1, None, None));
    assert_eq!(try_register(&mut c, id, &accounts(2), 3_600_000), 0, "a regular gets in");
    assert_eq!(try_register(&mut c, id, &accounts(5), 3_600_000), 10 * USDC, "a newcomer is refunded in full");
    assert_eq!(try_register(&mut c, id, &accounts(3), 3_600_000), 10 * USDC, "a no-show never attended");
    assert_eq!(c.get_event(id).unwrap().guest_count, 1);
    assert_eq!(c.check_access(id, accounts(2)), AccessCheck { allowed: true, attended: 1, no_shows: 0 });
    assert_eq!(c.check_access(id, accounts(5)), AccessCheck { allowed: false, attended: 0, no_shows: 0 });
}

#[test]
fn everyone_gets_in_once_the_event_opens_to_all() {
    let Past { mut c, a, .. } = past_events();
    let id = gated(&mut c, rule(vec![a], 1, None, Some(4_000_000)));
    assert_eq!(try_register(&mut c, id, &accounts(5), 3_999_999), 10 * USDC);
    assert_eq!(try_register(&mut c, id, &accounts(5), 4_000_000), 0);
}

#[test]
fn no_show_limit_keeps_flakes_out() {
    let Past { mut c, a, b, .. } = past_events();
    // Anyone except people who skipped A; B, closed with nobody checked in, never counts.
    let id = gated(&mut c, rule(vec![a, b], 0, Some(0), None));
    assert_eq!(c.check_access(id, accounts(3)), AccessCheck { allowed: false, attended: 0, no_shows: 1 });
    assert_eq!(try_register(&mut c, id, &accounts(3), 3_600_000), 10 * USDC);
    assert_eq!(try_register(&mut c, id, &accounts(5), 3_600_000), 0, "a newcomer has no no-shows");
    assert_eq!(try_register(&mut c, id, &accounts(2), 3_600_000), 0);
}

#[test]
fn ticket_attendance_counts() {
    let (mut c, _) = setup(10);
    ctx(&accounts(0), NearToken::from_near(5));
    let t = c.create_event(meta(), U128(10 * USDC), 10, Some(EventMode::Ticket), None);
    register(&mut c, t, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, t, vec![accounts(2)]);
    let id = gated(&mut c, rule(vec![t], 1, None, None));
    assert_eq!(try_register(&mut c, id, &accounts(2), 3_600_000), 0);
}

#[test]
fn intents_registration_obeys_the_rule() {
    let Past { mut c, a, .. } = past_events();
    let id = gated(&mut c, rule(vec![a], 1, None, None));
    let msg = |g: &AccountId| format!(r#"{{"action":"register","event_id":{id},"guest":"{g}"}}"#);
    assert_eq!(pay_at(&mut c, &intents(), 10 * USDC, &msg(&accounts(5)), 3_600_000), 10 * USDC);
    assert_eq!(pay_at(&mut c, &intents(), 10 * USDC, &msg(&accounts(4)), 3_600_000), 0);
    assert_eq!(c.get_guest_status(id, accounts(4)), Some(GuestStatus::Registered));
}

#[test]
#[should_panic(expected = "Only regulars can register yet")]
fn register_itself_enforces_the_rule() {
    let Past { mut c, a, .. } = past_events();
    let id = gated(&mut c, rule(vec![a], 1, None, None));
    c.event_mut(id).host_bond = 50 * USDC;
    ctx_at(&usdc(), NearToken::from_yoctonear(0), 3_600_000 * 1_000_000);
    c.register(id, accounts(5), accounts(5));
}

#[test]
fn get_events_pages_through_every_event() {
    let (mut c, _) = setup(10);
    for _ in 0..4 {
        ctx(&accounts(0), NearToken::from_near(5));
        c.create_event(meta(), U128(10 * USDC), 10, None, None);
    }
    let ids = |page: Vec<EventView>| page.into_iter().map(|e| e.id).collect::<Vec<_>>();
    assert_eq!(ids(c.get_events(None, None)), vec![0, 1, 2, 3, 4]);
    assert_eq!(ids(c.get_events(Some(1), Some(2))), vec![1, 2]);
    assert_eq!(ids(c.get_events(Some(4), Some(1000))), vec![4]);
    assert!(c.get_events(Some(9), None).is_empty());
    assert_eq!(c.get_events(Some(0), Some(1000)).len(), 5, "the page cap is 100");
}

#[test]
fn events_without_a_rule_let_everyone_in() {
    let Past { mut c, .. } = past_events();
    let id = gated(&mut c, None);
    assert!(c.get_event(id).unwrap().access.is_none());
    assert_eq!(c.check_access(id, accounts(5)), AccessCheck { allowed: true, attended: 0, no_shows: 0 });
    assert_eq!(try_register(&mut c, id, &accounts(5), 3_600_000), 0);
}

#[test]
fn the_rule_is_part_of_the_event_view() {
    let Past { mut c, a, .. } = past_events();
    let r = rule(vec![a], 1, Some(1), Some(4_000_000));
    let id = gated(&mut c, r.clone());
    assert_eq!(c.get_event(id).unwrap().access, r);
}

#[test]
fn intents_host_can_set_a_rule() {
    // One past event, so the next one is still on the free tier (no NEAR via Intents).
    let (mut c, a) = setup(10);
    register(&mut c, a, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, a, vec![accounts(2)]);
    let msg = json!({
        "action": "create_event", "metadata": later_meta(), "deposit": U128(10 * USDC), "capacity": 10,
        "access": { "past_events": [a], "min_attended": 1 },
    });
    auth_at(&mut c, &accounts(0), msg, 3_500_000);
    let id = u64::from(c.events.len()) - 1;
    assert_eq!(c.get_event(id).unwrap().access, rule(vec![a], 1, None, None));
}

/// Each case runs on its own thread: the mocked chain is per thread, so every
/// case starts from fresh storage.
fn assert_rule_rejected(access: fn(&Past) -> Option<AccessRule>, expected: &str) {
    let err = std::thread::spawn(move || {
        let mut past = past_events();
        let access = access(&past);
        gated(&mut past.c, access);
    })
    .join()
    .expect_err("the rule must be rejected");
    let msg = err.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains(expected), "expected {expected:?}, got {msg:?}");
}

#[test]
fn bad_rules_are_rejected() {
    assert_rule_rejected(|_| rule(vec![], 0, Some(0), None), "1 to 10 past events");
    assert_rule_rejected(|p| rule(vec![p.a; 11], 1, None, None), "1 to 10 past events");
    assert_rule_rejected(|p| rule(vec![p.a, p.a], 1, None, None), "Past events repeat");
    assert_rule_rejected(|_| rule(vec![99], 1, None, None), "Event not found");
    assert_rule_rejected(|p| rule(vec![p.other], 1, None, None), "Past events must be your own");
    assert_rule_rejected(|p| rule(vec![p.open], 1, None, None), "Past events must be finalized");
    assert_rule_rejected(|p| rule(vec![p.a], 2, None, None), "more than its past events");
    assert_rule_rejected(|p| rule(vec![p.a, p.b], 1, Some(3), None), "more than its past events");
    assert_rule_rejected(|p| rule(vec![p.a], 0, None, None), "lets everyone in");
    assert_rule_rejected(|p| rule(vec![p.a], 1, None, Some(later_meta().ends_at)), "before registration closes");
}

#[test]
fn freeze_is_one_way_and_blocks_upgrades() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.freeze();
    assert!(c.get_config().frozen);
}

#[test]
#[should_panic(expected = "The code is frozen")]
fn upgrade_after_freeze_fails() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.freeze();
    ctx_input(&owner(), one_yocto(), b"\0asm");
    let _ = c.upgrade();
}

#[test]
#[should_panic(expected = "Already frozen")]
fn freeze_twice_fails() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.freeze();
    ctx(&owner(), one_yocto());
    c.freeze();
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_freeze() {
    let mut c = fresh(false);
    ctx(&accounts(1), one_yocto());
    c.freeze();
}

#[test]
fn owner_still_runs_the_whitelist_after_freeze() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.freeze();
    ctx(&owner(), one_yocto());
    c.set_whitelist_mode(true);
    ctx(&owner(), one_yocto());
    c.add_to_whitelist(vec![accounts(1)]);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(true);
    ctx(&owner(), one_yocto());
    c.add_sponsored(vec![accounts(1)]);
    let cfg = c.get_config();
    assert!(cfg.whitelist_mode && c.is_whitelisted(accounts(1)));
    assert!(cfg.sponsored_mode && c.is_sponsored(accounts(1)));
}

#[test]
#[should_panic(expected = "Only whitelisted hosts can create events")]
fn whitelist_mode_stops_unlisted_hosts_even_if_they_pay() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.set_whitelist_mode(true);
    assert!(!c.can_create(accounts(1)));
    let cost = bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + EVENT_BALANCES_BYTES);
    ctx(&accounts(1), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None, None);
}

#[test]
#[should_panic(expected = "Only whitelisted hosts can create events")]
fn whitelist_mode_stops_unlisted_intents_hosts() {
    let mut c = fresh(true);
    ctx(&owner(), one_yocto());
    c.set_whitelist_mode(true);
    let msg = json!({
        "action": "create_event",
        "metadata": { "title": "Intents night", "starts_at": 2_000_000u64, "ends_at": 3_000_000u64 },
        "deposit": MIN_DEPOSIT.to_string(),
        "capacity": 10
    });
    ctx(&intents(), NearToken::from_yoctonear(0));
    let _ = c.on_auth(evm_host(), msg.to_string());
}

#[test]
fn whitelisted_host_creates_while_the_mode_is_on() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.set_whitelist_mode(true);
    ctx(&owner(), one_yocto());
    c.add_to_whitelist(vec![accounts(1)]);
    assert!(c.can_create(accounts(1)));
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 10, None, None);
    assert_eq!(c.get_event(id).unwrap().host, accounts(1));
    // The two lists are separate: whitelisted is not sponsored, and the free tier still applies.
    assert!(!c.is_sponsored(accounts(1)));
    assert_eq!(c.get_event(id).unwrap().capacity, 10);
    ctx(&owner(), one_yocto());
    c.set_whitelist_mode(false);
    assert!(c.can_create(accounts(2)));
}

#[test]
fn sponsored_mode_limits_the_free_tier_to_sponsored_hosts() {
    let mut c = fresh(false);
    let host = accounts(1);
    assert_eq!(c.create_event_cost(host.clone(), 10, None).0, 0);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(true);
    assert!(c.create_event_cost(host.clone(), 10, None).0 > 0);
    ctx(&owner(), one_yocto());
    c.add_sponsored(vec![host.clone()]);
    assert_eq!(c.create_event_cost(host.clone(), 10, None).0, 0);
    ctx(&host, NearToken::from_yoctonear(0));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None, None);
    // Sponsored hosts keep the other free-tier limits.
    assert!(c.create_event_cost(host.clone(), FREE_MAX_CAPACITY + 1, None).0 > 0);
    ctx(&owner(), one_yocto());
    c.remove_sponsored(vec![host.clone()]);
    assert!(c.create_event_cost(host.clone(), 10, None).0 > 0);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(false);
    assert_eq!(c.create_event_cost(host, 10, None).0, 0);
}

#[test]
#[should_panic(expected = "sponsored hosts")]
fn sponsored_mode_charges_other_hosts() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(true);
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None, None);
}

#[test]
fn unsponsored_host_can_still_pay_for_storage() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(true);
    let cost = c.create_event_cost(accounts(1), 10, None).0;
    ctx(&accounts(1), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 10, None, None);
    assert_eq!(c.get_event(id).unwrap().host, accounts(1));
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_switch_the_whitelist_mode() {
    let mut c = fresh(false);
    ctx(&accounts(1), one_yocto());
    c.set_whitelist_mode(true);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_whitelist() {
    let mut c = fresh(false);
    ctx(&accounts(1), one_yocto());
    c.add_to_whitelist(vec![accounts(1)]);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_sponsor() {
    let mut c = fresh(false);
    ctx(&accounts(1), one_yocto());
    c.add_sponsored(vec![accounts(1)]);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_switch_the_sponsored_mode() {
    let mut c = fresh(false);
    ctx(&accounts(1), one_yocto());
    c.set_sponsored_mode(true);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn whitelist_changes_need_a_full_access_key() {
    let mut c = fresh(false);
    ctx(&owner(), NearToken::from_yoctonear(0));
    c.add_to_whitelist(vec![accounts(1)]);
}

#[test]
#[should_panic(expected = "Pass 1 to 100 accounts")]
fn whitelist_batch_is_limited() {
    let mut c = fresh(false);
    let many: Vec<AccountId> = (0..101).map(|i| format!("h{i}.testnet").parse().unwrap()).collect();
    ctx(&owner(), one_yocto());
    c.add_to_whitelist(many);
}

#[test]
fn whitelist_entry_fits_its_reserve() {
    let mut c = fresh(false);
    let long: AccountId = format!("{:064x}", 7).parse().unwrap();
    ctx(&owner(), one_yocto());
    let before = env::storage_usage();
    c.add_to_whitelist(vec![long]);
    let used = env::storage_usage() - before;
    eprintln!("measured: whitelist entry {used} B");
    assert!(used <= WHITELIST_BYTES, "whitelist entry used {used}");
}

#[test]
fn free_events_must_end_within_60_days() {
    let mut c = fresh(false);
    let now = 1_000_000; // ms, see `ctx`
    let mut m = meta();
    m.starts_at = now;
    m.ends_at = now + FREE_MAX_HORIZON_MS;
    assert_eq!(c.create_event_cost(accounts(0), 10, Some(m.ends_at)).0, 0);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.create_event(m.clone(), U128(MIN_DEPOSIT), 10, None, None);
    m.ends_at += 1;
    let cost = c.create_event_cost(accounts(0), 10, Some(m.ends_at)).0;
    assert_eq!(cost, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + EVENT_BALANCES_BYTES));
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(m, U128(MIN_DEPOSIT), 10, None, None);
    assert_eq!(c.get_event(id).unwrap().capacity, 10);
}

#[test]
#[should_panic(expected = "ending within 60 days")]
fn free_event_ending_after_60_days_needs_storage() {
    let mut c = fresh(false);
    let mut m = meta();
    m.ends_at = 1_000_000 + FREE_MAX_HORIZON_MS + 1;
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.create_event(m, U128(MIN_DEPOSIT), 10, None, None);
}

#[test]
fn paid_event_returns_empty_seats_at_close() {
    let mut c = fresh(true);
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(10 * USDC), 60, None, None);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    // Empty seats and the dispute space of the taken ones nobody disputed come back.
    let refund = bytes_cost(SEAT_BYTES * 58 + DISPUTE_BYTES * 2);
    assert_eq!(transfers(), vec![(accounts(0), refund)]);
    // Taken seats and the event record stay paid.
    assert!(cost - refund >= bytes_cost(EVENT_RECORD_BYTES + EVENT_BALANCES_BYTES + (SEAT_BYTES - DISPUTE_BYTES) * 2));
}

#[test]
fn empty_paid_event_keeps_only_the_record_cost() {
    let mut c = fresh(false);
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(10 * USDC), 60, None, None);
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    let (_, refund) = transfers()[0].clone();
    assert_eq!(cost - refund, bytes_cost(EVENT_RECORD_BYTES + EVENT_BALANCES_BYTES));
}

#[test]
fn free_event_close_sends_no_near() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    close(&mut c, id, vec![accounts(2)]);
    assert!(transfers().is_empty());
}

#[test]
fn guest_list_no_longer_stores_who_paid() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let guest = &c.get_guests(id, None, None)[0];
    assert_eq!((guest.account_id.clone(), guest.status), (accounts(2), GuestStatus::Registered));
}

#[test]
fn intents_account_hosts_and_closes_an_event() {
    let mut c = fresh(true);
    let host = evm_host();
    auth(&mut c, &host, json!({
        "action": "create_event",
        "metadata": { "title": "Intents night", "starts_at": 2_000_000u64, "ends_at": 3_000_000u64 },
        "deposit": MIN_DEPOSIT.to_string(),
        "capacity": 10
    }));
    assert_eq!(c.get_event(0).unwrap().host, host);
    assert_eq!(pay(&mut c, &accounts(2), MIN_DEPOSIT, r#"{"action":"register","event_id":0}"#), 0);
    auth_at(&mut c, &host, json!({ "action": "finalize", "event_id": 0, "attended": [accounts(2)] }), 3_000_000);
    assert_eq!(c.get_event(0).unwrap().status, EventStatus::Submitted);
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), (3_000_000 + CHALLENGE_WINDOW_MS) * 1_000_000);
    c.settle(0);
    assert_eq!(c.get_event(0).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, MIN_DEPOSIT);
    assert_eq!(c.balance_of(host).0, bond(&c, 0));
}

#[test]
fn intents_host_can_cancel() {
    let mut c = fresh(true);
    let host = evm_host();
    auth(&mut c, &host, json!({
        "action": "create_event",
        "metadata": { "title": "Intents night", "starts_at": 2_000_000u64, "ends_at": 3_000_000u64 },
        "deposit": MIN_DEPOSIT.to_string(),
        "capacity": 10,
        "mode": "Ticket"
    }));
    auth(&mut c, &host, json!({ "action": "cancel", "event_id": 0 }));
    assert_eq!(c.get_event(0).unwrap().status, EventStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Only the host")]
fn intents_signer_must_be_the_host_to_finalize() {
    let (mut c, id) = setup(10);
    auth(&mut c, &accounts(1), json!({ "action": "finalize", "event_id": id, "attended": [] }));
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn intents_stranger_cannot_cancel_early() {
    let (mut c, id) = setup(10);
    auth(&mut c, &accounts(1), json!({ "action": "cancel", "event_id": id }));
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn intents_host_cannot_create_a_paid_event() {
    let mut c = fresh(true);
    auth(&mut c, &evm_host(), json!({
        "action": "create_event",
        "metadata": { "title": "Big", "starts_at": 2_000_000u64, "ends_at": 3_000_000u64 },
        "deposit": MIN_DEPOSIT.to_string(),
        "capacity": FREE_MAX_CAPACITY + 1
    }));
}

#[test]
fn owner_runs_the_whitelist_through_intents() {
    let mut c = fresh(true);
    auth(&mut c, &owner(), json!({ "action": "set_whitelist_mode", "enabled": true }));
    auth(&mut c, &owner(), json!({ "action": "add_to_whitelist", "accounts": [evm_host()] }));
    assert!(c.get_config().whitelist_mode && c.is_whitelisted(evm_host()));
    assert_eq!(c.create_event_cost(evm_host(), 10, None).0, 0);
    auth(&mut c, &owner(), json!({ "action": "remove_from_whitelist", "accounts": [evm_host()] }));
    assert!(!c.is_whitelisted(evm_host()));
    auth(&mut c, &owner(), json!({ "action": "set_sponsored_mode", "enabled": true }));
    auth(&mut c, &owner(), json!({ "action": "add_sponsored", "accounts": [evm_host()] }));
    assert!(c.get_config().sponsored_mode && c.is_sponsored(evm_host()));
    auth(&mut c, &owner(), json!({ "action": "remove_sponsored", "accounts": [evm_host()] }));
    assert!(!c.is_sponsored(evm_host()));
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_whitelist_through_intents() {
    let mut c = fresh(true);
    auth(&mut c, &accounts(1), json!({ "action": "add_to_whitelist", "accounts": [accounts(1)] }));
}

#[test]
#[should_panic(expected = "Only the NEAR Intents verifier")]
fn on_auth_from_anyone_else_is_rejected() {
    let mut c = fresh(true);
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    let _ = c.on_auth(owner(), json!({ "action": "set_whitelist_mode", "enabled": true }).to_string());
}

#[test]
#[should_panic(expected = "Only the NEAR Intents verifier")]
fn on_auth_without_intents_is_rejected() {
    let mut c = fresh(false);
    auth(&mut c, &owner(), json!({ "action": "set_whitelist_mode", "enabled": true }));
}

#[test]
#[should_panic(expected = "Attach no NEAR")]
fn on_auth_with_near_attached_is_rejected() {
    let mut c = fresh(true);
    ctx(&intents(), NearToken::from_near(1));
    let _ = c.on_auth(owner(), json!({ "action": "set_whitelist_mode", "enabled": true }).to_string());
}

#[test]
#[should_panic(expected = "Invalid msg")]
fn on_auth_with_unknown_action_is_rejected() {
    let mut c = fresh(true);
    auth(&mut c, &owner(), json!({ "action": "withdraw_everything" }));
}

// ------------------------------------------------- v3: bonds, disputes, settlement

const D: u128 = 10 * USDC;
/// The bond of `setup(10)`: 2 deposits per seat.
const H: u128 = 20 * D;
/// What a single winner takes from `H`: half of it, capped at `MAX_WIN_DEPOSITS` deposits.
const WIN1: u128 = if H / 2 > MAX_WIN_DEPOSITS * D { MAX_WIN_DEPOSITS * D } else { H / 2 };

fn bond_msg(id: u64) -> String {
    format!(r#"{{"action":"host_bond","event_id":{id}}}"#)
}

fn dispute_msg(id: u64, target: &AccountId, attended: bool) -> String {
    format!(r#"{{"action":"dispute","event_id":{id},"target":"{target}","attended":{attended}}}"#)
}

/// Runs `f` on a fresh thread (a fresh mocked chain) and checks it panics with `expected`.
fn rejects(f: impl FnOnce() + Send + 'static, expected: &str) {
    let err = std::thread::spawn(f).join().expect_err("the call must be refused");
    let msg = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(msg.contains(expected), "expected {expected:?}, got {msg:?}");
}

/// Guests 2, 3, 4 registered; the host listed 2 and 3 (4 absent) at `ends_at`.
fn submitted() -> (Contract, u64) {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
    (c, id)
}

/// Opens a dispute at `now_ms`; returns the USDC sent back.
fn dispute_at(c: &mut Contract, id: u64, challenger: &AccountId, target: &AccountId, attended: bool, now_ms: u64) -> u128 {
    raw_pay_at(c, challenger, D, &dispute_msg(id, target, attended), now_ms)
}

fn verdict(c: &mut Contract, id: u64, target: &AccountId, upheld: bool) {
    ctx_at(&dao(), NearToken::from_yoctonear(0), (meta().ends_at + 1) * 1_000_000);
    c.resolve_dispute(id, target.clone(), upheld);
}

fn settle_after_window(c: &mut Contract, id: u64) {
    let end = c.get_event(id).unwrap().challenge_ends_at;
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), end * 1_000_000);
    c.settle(id);
}

fn now() -> u64 {
    meta().ends_at
}

#[test]
fn registration_waits_for_the_host_bond() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(raw_pay_at(&mut c, &accounts(2), D, &msg, 1_000_000), D, "refused before the bond");
    // Anyone may pay it; a larger payment gets the change back.
    assert_eq!(raw_pay_at(&mut c, &accounts(5), H + 7, &bond_msg(id), 1_000_000), 7);
    assert_eq!(c.get_event(id).unwrap().host_bond.0, H);
    assert_eq!(raw_pay_at(&mut c, &accounts(2), D, &msg, 1_000_000), 0);
    assert_eq!(c.get_guest_status(id, accounts(2)), Some(GuestStatus::Registered));
}

#[test]
fn host_bond_rules() {
    rejects(|| { let (mut c, id) = setup(10); raw_pay_at(&mut c, &accounts(0), H - 1, &bond_msg(id), 1_000_000); }, "The host bond is");
    rejects(|| {
        let (mut c, id) = setup(10);
        raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000);
        raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000);
    }, "already paid");
    rejects(|| { let (mut c, id) = setup_tickets(10); raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000); }, "takes no host bond");
    rejects(|| { let (mut c, id) = setup(10); raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), meta().starts_at); }, "Registration has closed");
    rejects(|| { let (mut c, _) = setup(10); raw_pay_at(&mut c, &accounts(0), H, &bond_msg(9), 1_000_000); }, "Event not found");
}

#[test]
fn host_cannot_take_a_seat() {
    let (mut c, id) = setup(10);
    raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(raw_pay_at(&mut c, &accounts(0), D, &msg, 1_000_000), D);
    assert_eq!(c.get_guest_status(id, accounts(0)), None);
    // Ticket hosts cannot buy their own ticket either.
    let (mut c, id) = setup_tickets(10);
    assert_eq!(pay(&mut c, &accounts(0), TICKET, &format!(r#"{{"action":"register","event_id":{id}}}"#)), TICKET);
}

/// Without a court (the default after `new` or an upgrade) a Deposit event works as
/// before v3: no bond, the host's list pays out when published.
#[test]
fn without_a_court_the_list_is_final_at_publish() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let id = c.create_event(meta(), U128(D), 10, None, None);
    let e = c.get_event(id).unwrap();
    assert_eq!((e.dao, e.bond_due.0, e.registration_ends_at), (None, 0, meta().starts_at));
    let reg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    for g in [accounts(2), accounts(3)] {
        assert_eq!(raw_pay_at(&mut c, &g, D, &reg, 1_000_000), 0, "no bond needed");
    }
    rejects(|| {
        ctx(&accounts(0), NearToken::from_yoctonear(0));
        let mut c = Contract::new(usdc(), None, None, owner());
        let id = c.create_event(meta(), U128(D), 10, None, None);
        raw_pay_at(&mut c, &accounts(0), D, &bond_msg(id), 1_000_000);
    }, "takes no host bond");
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, 2 * D);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    // Abandoned without a court: everyone is refunded at once, nobody can dispute.
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    let id = c.create_event(meta(), U128(D), 10, None, None);
    raw_pay_at(&mut c, &accounts(2), D, &format!(r#"{{"action":"register","event_id":{id}}}"#), 1_000_000);
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
    c.refund(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, 2 * D + D);
}

#[test]
fn set_rules_is_for_the_owner_and_future_events() {
    let (mut c, old) = setup(10);
    let other: AccountId = "new-court.sputnik-dao.testnet".parse().unwrap();
    let new_rules = Rules { dao: Some(other.clone()), treasury: accounts(1), bond_per_seat: 1, challenge_hours: 24, ..court_rules() };
    ctx(&owner(), one_yocto());
    c.set_rules(new_rules.clone());
    assert_eq!(c.get_config().rules, new_rules);
    ctx(&accounts(0), NearToken::from_near(1));
    let new = c.create_event(meta(), U128(D), 10, None, None);
    let (o, n) = (c.get_event(old).unwrap(), c.get_event(new).unwrap());
    assert_eq!((o.dao, o.rules.treasury, o.bond_due.0), (Some(dao()), treasury(), 20 * D), "a running event keeps its rules");
    assert_eq!((n.dao, n.rules.treasury, n.bond_due.0), (Some(other), accounts(1), 10 * D));
    assert_eq!(n.rules.challenge_hours, 24);
    // Tickets never get a court or a bond.
    let t = c.create_event(meta(), U128(D), 10, Some(EventMode::Ticket), None);
    assert_eq!((c.get_event(t).unwrap().dao, c.get_event(t).unwrap().bond_due.0), (None, 0));
    rejects(|| { let (mut c, _) = setup(10); ctx(&accounts(1), one_yocto()); c.set_rules(court_rules()); }, "Only the owner");
    rejects(|| { let (mut c, _) = setup(10); ctx(&owner(), NearToken::from_yoctonear(0)); c.set_rules(court_rules()); }, "1 yoctoNEAR");
}

/// Combinations that would reopen a hole are refused in one place (`Rules::check`).
#[test]
fn set_rules_refuses_unsafe_combinations() {
    let bad = [
        (Rules { dao: None, ..court_rules() }, "A host bond needs a court"),
        (Rules { close_at_start: false, ..court_rules() }, "close at the start"),
        (Rules { treasury: dao(), ..court_rules() }, "court cannot receive"),
        (Rules { bond_per_seat: 3, ..court_rules() }, "out of range"),
        (Rules { challenge_hours: 11, ..court_rules() }, "out of range"),
        (Rules { challenge_hours: 169, ..court_rules() }, "out of range"),
        (Rules { submit_hours: 23, ..court_rules() }, "out of range"),
        (Rules { resolve_hours: 71, ..court_rules() }, "out of range"),
        (Rules { resolve_hours: 721, ..court_rules() }, "out of range"),
    ];
    for (rules, msg) in bad {
        rejects(move || { let (mut c, _) = setup(10); ctx(&owner(), one_yocto()); c.set_rules(rules); }, msg);
    }
    for stuck in [contract_account(), usdc(), "intents.near".parse().unwrap()] {
        rejects(move || { let (mut c, _) = setup(10); ctx(&owner(), one_yocto()); c.set_rules(Rules { treasury: stuck, ..court_rules() }); }, "ordinary accounts");
    }
    rejects(|| { let (mut c, _) = setup(10); ctx(&owner(), one_yocto()); c.set_rules(Rules { dao: Some(usdc()), ..court_rules() }); }, "ordinary accounts");
    // Without a court the host is trusted as before v3, and registration may run to the end.
    let (mut c, _) = setup(10);
    ctx(&owner(), one_yocto());
    c.set_rules(Rules { close_at_start: false, ..Rules::new(owner()) });
}

#[test]
fn finalize_publishes_the_list_and_pays_nothing() {
    let (c, id) = submitted();
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Submitted);
    assert_eq!(e.submitted_at, now());
    assert_eq!(e.challenge_ends_at, now() + CHALLENGE_WINDOW_MS);
    assert_eq!(e.resolve_by, now() + CHALLENGE_WINDOW_MS + RESOLVE_GRACE_MS);
    assert_eq!(e.attended_count, 2);
    for g in [accounts(0), accounts(2), accounts(3), accounts(4)] {
        assert_eq!(c.balance_of(g).0, 0);
    }
}

#[test]
fn finalize_deadline_then_refund() {
    // On the deadline itself the host may still publish.
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at + SUBMIT_DEADLINE_MS) * 1_000_000);
    c.finalize(id, vec![accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Submitted);
    rejects(|| {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        ctx_at(&accounts(0), one_yocto(), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
        c.finalize(id, vec![accounts(2)]);
    }, "Too late to publish");
    rejects(|| {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS) * 1_000_000);
        c.refund(id);
    }, "can still publish");
}

fn after_publish_deadline(c: &mut Contract, id: u64) {
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
    c.refund(id);
}

#[test]
fn refund_of_an_abandoned_event_publishes_an_empty_list_and_punishes_the_bond() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    after_publish_deadline(&mut c, id);
    let e = c.get_event(id).unwrap();
    assert_eq!((e.status, e.abandoned, e.attended_count), (EventStatus::Submitted, true, 0));
    assert_eq!(c.balance_of(accounts(2)).0, 0, "nothing is paid before the window");
    settle_after_window(&mut c, id);
    // No winner: half of H to the treasury, the other half split over the 3 guests (uncapped), rounding to the treasury.
    let per = (H - H * HOST_TREASURY_BPS / 10_000) / 3;
    for g in [accounts(2), accounts(3), accounts(4)] {
        assert_eq!(c.balance_of(g).0, D + per);
    }
    assert_eq!(c.balance_of(treasury()).0, H - 3 * per);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.reserved_bytes, 0);
    rejects(|| {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        after_publish_deadline(&mut c, id);
        c.refund(id);
    }, "Nothing to refund");
    rejects(|| {
        let (mut c, id) = setup_tickets(10);
        after_publish_deadline(&mut c, id);
    }, "Only Deposit events");
}

/// The council calls a published list off (Alex, 2026-11-13): every deposit, every
/// dispute bond (decided or not) and the host bond go back; nothing to the treasury.
#[test]
fn the_council_can_void_a_published_list() {
    let (mut c, id) = submitted();
    assert_eq!(dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now()), 0);
    assert_eq!(dispute_at(&mut c, id, &accounts(2), &accounts(3), false, now()), 0);
    verdict(&mut c, id, &accounts(3), false);
    ctx_at(&dao(), NearToken::from_yoctonear(0), (now() + 1) * 1_000_000);
    c.void_event(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!([2, 3, 4].map(|i| c.balance_of(accounts(i)).0), [D + D, D, D + D]);
    assert_eq!((c.balance_of(accounts(0)).0, c.balance_of(treasury()).0), (H, 0));
    assert_eq!(c.reserved_bytes, 0);
    // For regulars a voided list is no event: access rules take finalized events only.
    rejects(move || { let (mut c, id) = submitted(); ctx_at(&dao(), NearToken::from_yoctonear(0), (now() + 1) * 1_000_000); c.void_event(id); gated(&mut c, rule(vec![id], 0, Some(0), None)); }, "Past events must be finalized");

    let as_dao = |at_ms: u64| ctx_at(&dao(), NearToken::from_yoctonear(0), at_ms * 1_000_000);
    rejects(|| { let (mut c, id) = submitted(); ctx_at(&accounts(5), NearToken::from_yoctonear(0), now() * 1_000_000); c.void_event(id); }, "Only this event's DAO");
    rejects(move || { let (mut c, id) = setup(10); as_dao(now()); c.void_event(id); }, "Only a published list");
    rejects(move || {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        after_publish_deadline(&mut c, id);
        as_dao(c.get_event(id).unwrap().submitted_at);
        c.void_event(id);
    }, "Only a published list");
    rejects(move || { let (mut c, id) = submitted(); settle_after_window(&mut c, id); as_dao(now() + 1); c.void_event(id); }, "Only a published list");
    rejects(move || { let (mut c, id) = submitted(); as_dao(c.get_event(id).unwrap().resolve_by); c.void_event(id); }, "Too late");
}

/// A court with no bond (Alex, 2026-11-13): registration opens at once, a dispute
/// still corrects the list, the winner only gets the deposits back, the treasury nothing;
/// an abandoned event gives every deposit back.
#[test]
fn a_court_without_a_bond_still_corrects_the_list() {
    let start = |rules: Rules| {
        ctx(&accounts(0), NearToken::from_near(5));
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None, owner());
        ctx(&owner(), one_yocto());
        c.set_rules(rules);
        ctx(&accounts(0), NearToken::from_near(5));
        let id = c.create_event(meta(), U128(10 * USDC), 10, None, None);
        (c, id)
    };
    for bond_per_seat in [0u8, 1] {
        let (mut c, id) = start(Rules { bond_per_seat, ..court_rules() });
        assert_eq!(bond(&c, id), u128::from(bond_per_seat) * 10 * D);
        // At 0 `register` gets no bond first (`bond_if_needed`): the guests are taken at once.
        for g in [accounts(2), accounts(3), accounts(4)] {
            register(&mut c, id, &g);
        }
        ctx_ended(&accounts(0));
        c.finalize(id, vec![accounts(2), accounts(3)]);
        assert_eq!(dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now()), 0);
        verdict(&mut c, id, &accounts(4), true);
        settle_after_window(&mut c, id);
        let h = bond(&c, id);
        let win = (h / 2).min(MAX_WIN_DEPOSITS * D);
        // Pool 3D over the 3 who came; the winner also gets its dispute deposit and its share of the bond.
        assert_eq!([2, 3, 4].map(|i| c.balance_of(accounts(i)).0), [D, D, D + D + win]);
        assert_eq!((c.balance_of(accounts(0)).0, c.balance_of(treasury()).0), (0, h - win));
    }
    // No list from the host: with no bond, everyone just gets the deposit back.
    let (mut c, id) = start(Rules { bond_per_seat: 0, ..court_rules() });
    for g in [accounts(2), accounts(3)] {
        register(&mut c, id, &g);
    }
    after_publish_deadline(&mut c, id);
    settle_after_window(&mut c, id);
    assert_eq!([2, 3].map(|i| c.balance_of(accounts(i)).0), [D, D]);
    assert_eq!(c.balance_of(treasury()).0, 0);
    // A bond-free event takes no bond.
    rejects(move || {
        let (mut c, id) = start(Rules { bond_per_seat: 0, ..court_rules() });
        raw_pay_at(&mut c, &accounts(0), D, &bond_msg(id), 1_000_000);
    }, "takes no host bond");
}

/// The audit's exploit: a host and its no-shows walk away refunded by not
/// publishing. With the empty list the guests who came still prove it and
/// take the whole pool and the winners' half of the bond.
#[test]
fn guests_who_came_still_win_when_the_host_abandons() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4), accounts(5)] {
        register(&mut c, id, &g);
    }
    after_publish_deadline(&mut c, id);
    let now = c.get_event(id).unwrap().submitted_at;
    dispute_at(&mut c, id, &accounts(2), &accounts(2), true, now);
    verdict(&mut c, id, &accounts(2), true);
    settle_after_window(&mut c, id);
    // 2 came: the 40 USDC pool, its bond back and 25 USDC of the host bond.
    assert_eq!(c.balance_of(accounts(2)).0, 40 * USDC + D + WIN1);
    for g in [accounts(3), accounts(4), accounts(5)] {
        assert_eq!(c.balance_of(g).0, 0);
    }
    assert_eq!(c.balance_of(treasury()).0, H - WIN1);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
fn refund_without_guests_returns_the_bond() {
    let (mut c, id) = setup(10);
    raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000);
    after_publish_deadline(&mut c, id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Refunded);
    assert_eq!(c.balance_of(accounts(0)).0, H);
    assert_eq!(c.balance_of(treasury()).0, 0);
}

#[test]
fn finalize_with_no_guests_closes_at_once() {
    let (mut c, id) = setup(10);
    raw_pay_at(&mut c, &accounts(0), H, &bond_msg(id), 1_000_000);
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(0)).0, H);
}

#[test]
fn settle_waits_for_the_window() {
    rejects(|| {
        let (mut c, id) = submitted();
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (now() + CHALLENGE_WINDOW_MS - 1) * 1_000_000);
        c.settle(id);
    }, "window is still open");
    rejects(|| { let (mut c, id) = setup(10); ctx_ended(&accounts(5)); c.settle(id); }, "Nothing to settle");
    rejects(|| {
        let (mut c, id) = submitted();
        settle_after_window(&mut c, id);
        c.settle(id);
    }, "Nothing to settle");
    // A settled event cannot be refunded.
    rejects(|| {
        let (mut c, id) = submitted();
        settle_after_window(&mut c, id);
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
        c.refund(id);
    }, "Nothing to refund");
}

#[test]
fn settle_with_no_disputes_pays_like_before() {
    let (mut c, id) = submitted();
    settle_after_window(&mut c, id);
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 15 * USDC);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, H);
    assert_eq!(c.balance_of(treasury()).0, 0);
    assert_eq!(c.reserved_bytes, 0);
}

#[test]
fn dispute_rules() {
    let late = now() + CHALLENGE_WINDOW_MS;
    rejects(move || { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(4), &accounts(4), true, late); }, "window is over");
    rejects(|| {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        dispute_at(&mut c, id, &accounts(2), &accounts(2), true, now());
    }, "once the host publishes");
    // "I came" only for yourself; "X did not come" only about someone else.
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(2), &accounts(4), true, now()); }, "Only the guest can claim they came");
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(2), &accounts(2), false, now()); }, "own presence");
    // The claim must contradict the list.
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(4), &accounts(2), true, now()); }, "Only the guest can claim");
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(3), &accounts(4), false, now()); }, "already says so");
    // Only guests dispute; the host is never a guest.
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(5), &accounts(2), false, now()); }, "Only guests of this event");
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(0), &accounts(2), false, now()); }, "Only guests of this event");
    rejects(|| { let (mut c, id) = submitted(); dispute_at(&mut c, id, &accounts(2), &accounts(5), false, now()); }, "Not a guest");
    // One dispute per record.
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(2), &accounts(3), false, now());
        dispute_at(&mut c, id, &accounts(4), &accounts(3), false, now());
    }, "already disputed");
    // The bond is exactly one deposit.
    rejects(|| {
        let (mut c, id) = submitted();
        raw_pay_at(&mut c, &accounts(4), D - 1, &dispute_msg(id, &accounts(4), true), now());
    }, "dispute bond");
    // Nobody else's name, except through NEAR Intents.
    rejects(|| {
        let (mut c, id) = submitted();
        let msg = format!(r#"{{"action":"dispute","event_id":{id},"target":"{}","attended":true,"guest":"{}"}}"#, accounts(4), accounts(4));
        raw_pay_at(&mut c, &accounts(2), D, &msg, now());
    }, "own name");
    rejects(|| {
        let (mut c, id) = submitted();
        raw_pay_at(&mut c, &intents(), D, &dispute_msg(id, &accounts(4), true), now());
    }, "must name the guest");
}

#[test]
fn dispute_takes_the_bond_and_returns_the_change() {
    let (mut c, id) = submitted();
    // The last millisecond of the window still counts.
    let last = now() + CHALLENGE_WINDOW_MS - 1;
    assert_eq!(raw_pay_at(&mut c, &accounts(4), D + 3, &dispute_msg(id, &accounts(4), true), last), 3);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.open_disputes, 1);
    let disputes = c.get_disputes(id, None, None);
    assert_eq!(disputes.len(), 1);
    let d = &disputes[0];
    assert_eq!((d.target.clone(), d.challenger.clone(), d.attended, d.via_intents, d.upheld), (accounts(4), accounts(4), true, false, None));
    assert_eq!(d.created_at, last);
}

#[test]
fn dispute_via_intents_is_flagged() {
    // Only keyless EVM accounts dispute through Intents (red team R3).
    let (mut c, id) = setup_with_relayer(10, "relayer.testnet".parse().unwrap());
    let evm: AccountId = "0x1111111111111111111111111111111111111111".parse().unwrap();
    let named = format!(r#"{{"action":"register","event_id":{id},"guest":"{evm}"}}"#);
    assert_eq!(pay(&mut c, &intents(), D, &named), 0);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    let msg = format!(r#"{{"action":"dispute","event_id":{id},"target":"{evm}","attended":true,"guest":"{evm}"}}"#);
    assert_eq!(raw_pay_at(&mut c, &intents(), D, &msg, now()), 0);
    assert!(c.get_disputes(id, None, None)[0].via_intents);
}

#[test]
fn rt_an_intents_payer_cannot_use_up_a_near_guests_accusation() {
    rejects(|| {
        let (mut c, id) = setup(10);
        let g = rt_guests(4);
        for a in &g {
            register(&mut c, id, a);
        }
        ctx_ended(&accounts(0));
        c.finalize(id, g.clone());
        let squat = format!(r#"{{"action":"dispute","event_id":{id},"target":"{}","attended":false,"guest":"{}"}}"#, g[1], g[0]);
        raw_pay_at(&mut c, &intents(), D, &squat, now());
    }, "for EVM accounts");
}

#[test]
fn resolve_rules() {
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        ctx_ended(&owner());
        c.resolve_dispute(id, accounts(4), true);
    }, "Only this event's DAO");
    // A new DAO does not decide events created under the old one.
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        let other: AccountId = "new-court.sputnik-dao.testnet".parse().unwrap();
        ctx(&owner(), one_yocto());
        c.set_rules(Rules { dao: Some(other.clone()), ..court_rules() });
        ctx_ended(&other);
        c.resolve_dispute(id, accounts(4), true);
    }, "Only this event's DAO");
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        verdict(&mut c, id, &accounts(4), true);
        verdict(&mut c, id, &accounts(4), false);
    }, "already resolved");
    rejects(|| {
        let (mut c, id) = submitted();
        verdict(&mut c, id, &accounts(4), true);
    }, "No dispute about this guest");
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        let end = c.get_event(id).unwrap().resolve_by;
        ctx_at(&dao(), NearToken::from_yoctonear(0), end * 1_000_000);
        c.resolve_dispute(id, accounts(4), true);
    }, "expired");
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        verdict(&mut c, id, &accounts(4), true);
        settle_after_window(&mut c, id);
        verdict(&mut c, id, &accounts(4), true);
    }, "Event is closed");
}

#[test]
fn a_verdict_may_come_before_the_window_ends_but_settle_still_waits() {
    let (mut c, id) = submitted();
    dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
    verdict(&mut c, id, &accounts(4), false);
    assert_eq!(c.get_event(id).unwrap().open_disputes, 0);
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        verdict(&mut c, id, &accounts(4), false);
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (now() + 1) * 1_000_000);
        c.settle(id);
    }, "window is still open");
    settle_after_window(&mut c, id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
}

#[test]
fn settle_waits_for_open_disputes_until_they_expire() {
    rejects(|| {
        let (mut c, id) = submitted();
        dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
        let end = c.get_event(id).unwrap().resolve_by;
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (end - 1) * 1_000_000);
        c.settle(id);
    }, "waiting for the DAO");
    // At `resolve_by` the dispute expires: the host's record stands, the bond comes back.
    let (mut c, id) = submitted();
    dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
    let end = c.get_event(id).unwrap().resolve_by;
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), end * 1_000_000);
    c.settle(id);
    assert_eq!(c.balance_of(accounts(4)).0, D, "bond back, no payout");
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC);
    assert_eq!(c.balance_of(accounts(0)).0, H);
    assert_eq!(c.get_guest_status(id, accounts(4)), Some(GuestStatus::Registered));
    assert_eq!(c.get_disputes(id, None, None)[0].upheld, None);
    assert_eq!(c.reserved_bytes, 0);
}

/// SPEC G3: N = 4, D = 10, H = 200 (10 seats × 2). A, B, C came; the host listed A, B; C says "I came".
fn g3() -> (Contract, u64) {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4), accounts(5)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
    dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
    (c, id)
}

#[test]
fn settle_math_g3_challenger_wins() {
    let (mut c, id) = g3();
    verdict(&mut c, id, &accounts(4), true);
    settle_after_window(&mut c, id);
    let share = 40 * USDC / 3; // 13.333333
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, share);
    // C: the share, the bond back and half of the host bond.
    assert_eq!(c.balance_of(accounts(4)).0, share + D + WIN1);
    assert_eq!(c.balance_of(accounts(5)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 40 * USDC - 3 * share); // 1 unit of dust
    assert_eq!(c.balance_of(treasury()).0, H - WIN1);
    assert_eq!(c.get_guest_status(id, accounts(4)), Some(GuestStatus::Attended));
    let e = c.get_event(id).unwrap();
    assert_eq!((e.attended_count, e.payout_per_attendee.0, e.upheld_disputes), (3, share, 1));
    let total: u128 = [0, 2, 3, 4, 5].iter().map(|&i| c.balance_of(accounts(i)).0).sum::<u128>() + c.balance_of(treasury()).0;
    assert_eq!(total, 40 * USDC + H + D);
}

#[test]
fn settle_math_g3_host_wins() {
    let (mut c, id) = g3();
    verdict(&mut c, id, &accounts(4), false);
    settle_after_window(&mut c, id);
    // Pool 40 to A and B; C's bond: 5 to the treasury, 2.5 each to A and B.
    assert_eq!(c.balance_of(accounts(2)).0, 20 * USDC + 2_500_000);
    assert_eq!(c.balance_of(accounts(3)).0, 20 * USDC + 2_500_000);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, H);
    assert_eq!(c.balance_of(treasury()).0, 5 * USDC);
}

#[test]
fn upheld_absence_removes_the_guest_and_pays_the_challenger() {
    let (mut c, id) = submitted();
    // 3 was listed but did not come; 2 says so and is right.
    dispute_at(&mut c, id, &accounts(2), &accounts(3), false, now());
    verdict(&mut c, id, &accounts(3), true);
    assert_eq!(c.get_event(id).unwrap().attended_count, 1);
    settle_after_window(&mut c, id);
    assert_eq!(c.balance_of(accounts(2)).0, 30 * USDC + D + WIN1);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
    assert_eq!(c.balance_of(treasury()).0, H - WIN1);
}

#[test]
fn nobody_came_after_disputes_refunds_and_splits_lost_bonds_among_everyone() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    // 3 says 2 was absent (upheld); 4 says it came (dismissed).
    dispute_at(&mut c, id, &accounts(3), &accounts(2), false, now());
    dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
    verdict(&mut c, id, &accounts(2), true);
    verdict(&mut c, id, &accounts(4), false);
    settle_after_window(&mut c, id);
    // A = 0: deposits back; 4's lost bond: 5 to the treasury, 5 / 3 to each guest.
    let part = 5 * USDC / 3;
    assert_eq!(c.balance_of(accounts(2)).0, D + part);
    assert_eq!(c.balance_of(accounts(3)).0, D + part + D + WIN1);
    assert_eq!(c.balance_of(accounts(4)).0, D + part);
    assert_eq!(c.balance_of(treasury()).0, H - WIN1 + 10 * USDC - 3 * part);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
    assert_eq!(c.get_event(id).unwrap().payout_per_attendee.0, 0);
}

#[test]
fn several_winners_share_the_host_bond() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    for g in [accounts(2), accounts(3), accounts(4)] {
        dispute_at(&mut c, id, &g, &g, true, now());
        verdict(&mut c, id, &g, true);
    }
    settle_after_window(&mut c, id);
    // 25 / 3 = 8.333333 each, 1 unit of rounding to the treasury.
    let win = (H - H / 2) / 3;
    for g in [accounts(2), accounts(3), accounts(4)] {
        assert_eq!(c.balance_of(g).0, D + D + win);
    }
    assert_eq!(c.balance_of(treasury()).0, H - 3 * win);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
fn every_seat_disputed_releases_all_reservations() {
    let (mut c, id) = setup(10);
    let guests: Vec<AccountId> = (0..10).map(|i| format!("guest{i}.testnet").parse().unwrap()).collect();
    for g in &guests {
        register(&mut c, id, g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, guests[..5].to_vec());
    for (i, g) in guests.iter().enumerate() {
        if i < 5 {
            dispute_at(&mut c, id, &guests[(i + 5) % 10], g, false, now());
        } else {
            dispute_at(&mut c, id, g, g, true, now());
        }
    }
    assert_eq!(c.get_event(id).unwrap().open_disputes, 10);
    assert_eq!(c.get_disputes(id, Some(3), Some(4)).len(), 4);
    for (i, g) in guests.iter().enumerate() {
        verdict(&mut c, id, g, i % 2 == 0);
    }
    settle_after_window(&mut c, id);
    assert_eq!(c.reserved_bytes, 0);
}

#[test]
fn paid_event_refunds_unused_dispute_space() {
    let mut c = fresh(true);
    c.rules = court_rules();
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(D), 60, None, None);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
    dispute_at(&mut c, id, &accounts(4), &accounts(4), true, now());
    verdict(&mut c, id, &accounts(4), false);
    settle_after_window(&mut c, id);
    // 57 empty seats, and 2 of the 3 taken seats never had a dispute.
    assert_eq!(transfers(), vec![(accounts(0), bytes_cost(SEAT_BYTES * 57 + DISPUTE_BYTES * 2))]);
}

// --------------------------------------------- v3: conservation, property test

/// Independent model of the money rules (SPEC G2 with per-dispute expiry),
/// written from the spec, not from `settle_money`. `verdicts`: Some(true) upheld,
/// Some(false) dismissed, None expired. Returns credits by account name.
fn model_settle(
    n: usize,
    d: u128,
    listed: &[bool],
    disputes: &[(usize, usize, bool, Option<bool>)],
    abandoned: bool,
    capacity: u32,
    bond_per_seat: u8,
    voided: bool,
) -> std::collections::BTreeMap<String, u128> {
    let mut out = std::collections::BTreeMap::new();
    let mut add = |who: String, x: u128| *out.entry(who).or_insert(0) += x;
    let h = u128::from(bond_per_seat) * d * capacity as u128;
    if voided {
        // Everything goes back: deposits, every dispute bond, the host bond.
        (0..n).for_each(|i| add(format!("g{i}"), d));
        disputes.iter().for_each(|x| add(format!("g{}", x.1), d));
        add("host".into(), h);
        out.retain(|_, v| *v > 0);
        return out;
    }
    let mut fin = listed.to_vec();
    for &(target, _, claim, v) in disputes {
        if v == Some(true) {
            fin[target] = claim;
        }
    }
    let came: Vec<usize> = (0..n).filter(|&i| fin[i]).collect();
    let pool = d * n as u128;
    if came.is_empty() {
        (0..n).for_each(|i| add(format!("g{i}"), d));
    } else {
        let share = pool / came.len() as u128;
        came.iter().for_each(|&i| add(format!("g{i}"), share));
        add("host".into(), pool - share * came.len() as u128);
    }
    let winners: Vec<usize> = disputes.iter().filter(|x| x.3 == Some(true)).map(|x| x.1).collect();
    if winners.is_empty() && abandoned {
        // No list and nobody proved anything: the bond still goes, to every guest.
        let part = (h - h / 2) / n as u128;
        (0..n).for_each(|i| add(format!("g{i}"), part));
        add("treasury".into(), h - part * n as u128);
    } else if winners.is_empty() {
        add("host".into(), h);
    } else {
        // Half to the winners, but at most 5 deposits each; the rest to the treasury.
        let part = ((h - h / 2) / winners.len() as u128).min(5 * d);
        winners.iter().for_each(|&w| add(format!("g{w}"), part));
        add("treasury".into(), h - part * winners.len() as u128);
    }
    let mut lost = 0;
    for &(_, challenger, _, v) in disputes {
        match v {
            Some(false) => lost += d,
            _ => add(format!("g{challenger}"), d),
        }
    }
    if lost > 0 {
        let takers: Vec<usize> = if came.is_empty() { (0..n).collect() } else { came };
        let part = (lost - lost / 2) / takers.len() as u128;
        takers.iter().for_each(|&t| add(format!("g{t}"), part));
        add("treasury".into(), lost - part * takers.len() as u128);
    }
    out.retain(|_, v| *v > 0);
    out
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// One random event: guests, a list, legal disputes and verdicts, then settle.
/// Checks the contract against the model and that money in = money out.
fn random_case(seed: u64) {
    let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let n = 1 + r.below(7) as usize;
    let d = MIN_DEPOSIT + r.below(50 * USDC as u64) as u128;
    let name = |i: usize| -> AccountId { format!("g{i}.testnet").parse().unwrap() };
    ctx(&accounts(0), NearToken::from_near(5));
    // Storage survives `testing_env!`: start each case on an empty chain.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut c = new_contract(usdc(), Some(intents()), None, owner());
    // Any allowed bond with the court: 0, 1 or 2 deposits per seat.
    let bond_per_seat = r.below(3) as u8;
    c.rules.bond_per_seat = bond_per_seat;
    let host: AccountId = "host.testnet".parse().unwrap();
    ctx(&host, NearToken::from_yoctonear(0));
    let capacity = n as u32 + r.below(4) as u32;
    let id = c.create_event(meta(), U128(d), capacity, None, None);
    let mut money_in = 0u128;
    // Overpaying the bond: the change goes back.
    let extra = r.below(3) as u128;
    let h = u128::from(bond_per_seat) * d * capacity as u128;
    if h > 0 {
        money_in += h + extra - raw_pay_at(&mut c, &accounts(5), h + extra, &bond_msg(id), 1_000_000);
    }
    let reg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    for i in 0..n {
        money_in += d - raw_pay_at(&mut c, &name(i), d, &reg, 1_000_000);
    }
    // One case in four: the host never publishes and anyone opens the window on an empty list.
    let abandoned = r.below(4) == 0;
    let listed: Vec<bool> = (0..n).map(|_| !abandoned && r.below(2) == 1).collect();
    if abandoned {
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
        c.refund(id);
    } else {
        ctx_at(&host, one_yocto(), meta().ends_at * 1_000_000);
        c.finalize(id, (0..n).filter(|&i| listed[i]).map(name).collect());
    }
    let start = c.get_event(id).unwrap().submitted_at;
    let mut disputes = Vec::new();
    let mut accused = vec![false; n];
    for target in 0..n {
        if r.below(2) == 0 {
            continue;
        }
        let claim = !listed[target];
        let challenger = if claim { target } else {
            if n < 2 { continue; }
            (target + 1 + r.below(n as u64 - 1) as usize) % n
        };
        // One "did not come" per challenger (red team R1).
        if !claim && std::mem::replace(&mut accused[challenger], true) {
            continue;
        }
        let at = start + r.below(CHALLENGE_WINDOW_MS);
        money_in += d - raw_pay_at(&mut c, &name(challenger), d, &dispute_msg(id, &name(target), claim), at);
        let v = match r.below(3) { 0 => Some(true), 1 => Some(false), _ => None };
        disputes.push((target, challenger, claim, v));
    }
    for &(target, _, _, v) in &disputes {
        if let Some(upheld) = v {
            verdict(&mut c, id, &name(target), upheld);
        }
    }
    let e = c.get_event(id).unwrap();
    // One published list in five: the council voids it before `resolve_by`.
    let voided = !abandoned && r.below(5) == 0;
    if voided {
        ctx_at(&dao(), NearToken::from_yoctonear(0), (e.resolve_by - 1 - r.below(1_000)) * 1_000_000);
        c.void_event(id);
    } else {
        let at = if e.open_disputes > 0 { e.resolve_by } else { e.challenge_ends_at };
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (at + r.below(1_000)) * 1_000_000);
        c.settle(id);
    }

    let mut got = std::collections::BTreeMap::new();
    for i in 0..n {
        let b = c.balance_of(name(i)).0;
        if b > 0 {
            got.insert(format!("g{i}"), b);
        }
    }
    for (label, account) in [("host", host.clone()), ("treasury", treasury())] {
        let b = c.balance_of(account).0;
        if b > 0 {
            got.insert(label.to_string(), b);
        }
    }
    let want = model_settle(n, d, &listed, &disputes, abandoned, capacity, bond_per_seat, voided);
    assert_eq!(got, want, "seed {seed}: n={n} d={d} bond/seat={bond_per_seat} voided={voided} listed={listed:?} disputes={disputes:?}");
    assert_eq!(got.values().sum::<u128>(), money_in, "seed {seed}: money in != money out");
    assert_eq!(c.reserved_bytes, 0, "seed {seed}: reservations left");
}

/// `V3_CASES=100000 cargo test settle_conservation_random --release` runs the full spec count.
#[test]
fn settle_conservation_random() {
    let cases: u64 = std::env::var("V3_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(200);
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()) as u64;
    let workers: Vec<_> = (0..threads)
        .map(|first| std::thread::spawn(move || (first..cases).step_by(threads as usize).for_each(random_case)))
        .collect();
    for worker in workers {
        if let Err(e) = worker.join() {
            std::panic::resume_unwind(e);
        }
    }
}

#[test]
fn settle_and_refund_are_exclusive() {
    // Submitted events cannot be refunded, open ones cannot be settled.
    rejects(|| {
        let (mut c, id) = submitted();
        ctx_at(&accounts(5), NearToken::from_yoctonear(0), (meta().ends_at + SUBMIT_DEADLINE_MS + 1) * 1_000_000);
        c.refund(id);
    }, "Nothing to refund");
    rejects(|| {
        let (mut c, id) = setup(10);
        register(&mut c, id, &accounts(2));
        after_publish_deadline(&mut c, id);
        c.settle(id);
    }, "window is still open");
}

#[test]
fn the_court_cannot_host_or_take_the_treasury() {
    rejects(|| {
        ctx(&dao(), NearToken::from_near(1));
        let mut c = new_contract(usdc(), None, None, owner());
        c.create_event(meta(), U128(D), 10, None, None);
    }, "cannot host a Deposit event");
    rejects(|| {
        let (mut c, _) = setup(10);
        ctx(&owner(), one_yocto());
        c.set_rules(Rules { treasury: dao(), ..court_rules() });
    }, "court cannot receive");
    // A DAO may still sell tickets.
    ctx(&dao(), NearToken::from_near(1));
    let mut c = new_contract(usdc(), None, None, owner());
    c.create_event(meta(), U128(D), 10, Some(EventMode::Ticket), None);
}

/// A 50-seat bond (100 deposits): one winner takes 5 deposits, the treasury the other 95 (audit 2).
#[test]
fn a_winner_takes_at_most_five_deposits_of_the_bond() {
    let (mut c, id) = setup(50);
    assert_eq!(bond(&c, id), 100 * D);
    for g in [accounts(2), accounts(3)] {
        register(&mut c, id, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
    assert_eq!(dispute_at(&mut c, id, &accounts(2), &accounts(3), false, now()), 0);
    verdict(&mut c, id, &accounts(3), true);
    settle_after_window(&mut c, id);
    assert_eq!(c.balance_of(accounts(2)).0, 2 * D + D + 5 * D, "the pool, the dispute bond back, 5 deposits of the bond");
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
    assert_eq!(c.balance_of(treasury()).0, 95 * D);
}

#[test]
fn the_deposit_bound_keeps_every_split_in_u128() {
    // The largest product: 300 dismissed bonds × CHALLENGER_TREASURY_BPS.
    let d = u128::MAX / 1_000_000_000;
    assert!((d * 300).checked_mul(CHALLENGER_TREASURY_BPS).is_some());
    // The largest bond: 2 deposits per seat (the `Rules` limit) × 300 seats.
    assert!((d * u128::from(MAX_CAPACITY) * 2).checked_mul(HOST_TREASURY_BPS).is_some());
    assert!(d.checked_mul(u128::from(MAX_CAPACITY)).is_some());
    rejects(|| {
        ctx(&accounts(0), NearToken::from_near(1));
        let mut c = new_contract(usdc(), None, None, owner());
        c.create_event(meta(), U128(u128::MAX / 1_000_000_000 + 1), 10, None, None);
    }, "Deposit is too large");
}

/// The owner cannot point the treasury at a host about to lose its bond (audit F7):
/// a running event pays the treasury it was created with.
#[test]
fn a_running_event_keeps_its_treasury() {
    let (mut c, id) = g3();
    ctx(&owner(), one_yocto());
    c.set_rules(Rules { treasury: accounts(0), ..court_rules() });
    verdict(&mut c, id, &accounts(4), true);
    settle_after_window(&mut c, id);
    assert_eq!(c.balance_of(treasury()).0, H - WIN1);
    assert_eq!(c.balance_of(accounts(0)).0, 40 * USDC - 3 * (40 * USDC / 3), "only the pool's dust");
    // And the treasury can never host a Deposit event.
    rejects(|| {
        let (mut c, _) = setup(10);
        ctx(&treasury(), NearToken::from_near(1));
        c.create_event(meta(), U128(D), 10, None, None);
    }, "treasury cannot host");
}

// ------------------------------------------------------------- red team (R1, R2)

fn rt_guests(n: usize) -> Vec<AccountId> {
    (0..n).map(|i| format!("g{i}.testnet").parse().unwrap()).collect()
}

/// R1: before the fix one guest could accuse every record, and ignored disputes cost nothing.
#[test]
#[should_panic(expected = "already disputed")]
fn rt_ignored_spam_disputes_cost_the_spammer_nothing() {
    let (mut c, id) = setup(10);
    let g = rt_guests(6);
    for a in &g {
        register(&mut c, id, a);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, g.clone());
    for t in &g[1..] {
        assert_eq!(dispute_at(&mut c, id, &g[0], t, false, now()), 0);
    }
}

#[test]
fn rt_a_guest_files_one_did_not_come_dispute_per_event() {
    rejects(|| {
        let (mut c, id) = setup(10);
        let g = rt_guests(4);
        for a in &g {
            register(&mut c, id, a);
        }
        ctx_ended(&accounts(0));
        c.finalize(id, g.clone());
        assert_eq!(dispute_at(&mut c, id, &g[0], &g[1], false, now()), 0);
        dispute_at(&mut c, id, &g[0], &g[2], false, now());
    }, "already disputed");
    // "I came" is not an accusation: a guest left off can still claim it after accusing someone.
    let (mut c, id) = setup(10);
    let g = rt_guests(3);
    for a in &g {
        register(&mut c, id, a);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![g[1].clone(), g[2].clone()]);
    assert_eq!(dispute_at(&mut c, id, &g[0], &g[1], false, now()), 0);
    assert_eq!(dispute_at(&mut c, id, &g[0], &g[0], true, now()), 0);
    assert_eq!(c.get_event(id).unwrap().open_disputes, 2);
}

/// R2: the relayer's server key or the owner alone must not be the court.
#[test]
fn rt_the_court_is_not_the_relayer_or_the_owner() {
    let relayer: AccountId = "relayer.testnet".parse().unwrap();
    for court in [relayer.clone(), owner()] {
        let r = relayer.clone();
        rejects(move || {
            let (mut c, _) = setup_with_relayer(10, r);
            ctx(&owner(), one_yocto());
            c.set_rules(Rules { dao: Some(court), ..court_rules() });
        }, "not the owner or the relayer");
    }
}
