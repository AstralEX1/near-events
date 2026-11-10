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
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), capacity, None);
    (c, id)
}

fn setup_with_relayer(capacity: u32, relayer: AccountId) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), Some(relayer), owner());
    let id = c.create_event(meta(), U128(10 * USDC), capacity, None);
    (c, id)
}

fn pay(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str) -> u128 {
    pay_at(c, sender, amount, msg, 1_000_000)
}

fn pay_at(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str, now_ms: u64) -> u128 {
    ctx_at(&usdc(), NearToken::from_yoctonear(0), now_ms * 1_000_000);
    match c.ft_on_transfer(sender.clone(), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
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
    c.finalize(id, vec![accounts(2), accounts(3), accounts(4)]);

    // 4 x 10 = 40, split by 3 attendees; 1 unit of dust goes to the host.
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Finalized);
    assert_eq!(e.total_pool.0, 40 * USDC);
    assert_eq!(e.payout_per_attendee.0, 40 * USDC / 3);
    assert_eq!(c.balance_of(accounts(2)).0, 40 * USDC / 3);
    assert_eq!(c.balance_of(accounts(5)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 40 * USDC - 3 * (40 * USDC / 3));
}

#[test]
fn remainder_goes_to_host() {
    let (mut c, _) = setup(10);
    ctx(&accounts(0), NearToken::from_near(5));
    let id = c.create_event(meta(), U128(10 * USDC + 1), 10, None);
    for g in [accounts(2), accounts(3), accounts(4)] {
        pay(&mut c, &g, 10 * USDC + 1, &format!(r#"{{"action":"register","event_id":{id}}}"#));
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
    // 30 USDC + 3 units split by 2 → 1 unit remainder to host.
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC + 1);
    assert_eq!(c.balance_of(accounts(0)).0, 1);
}

#[test]
fn nobody_attended_refunds_everyone() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
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
    c.finalize(id, vec![accounts(2), accounts(2)]);
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
    c.finalize(id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "Only the host")]
fn door_helper_cannot_finalize() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(1));
    c.finalize(id, vec![]);
}

#[test]
fn no_registration_after_finalize() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay(&mut c, &accounts(2), 10 * USDC, &msg), 10 * USDC);
}

#[test]
fn create_event_is_free_for_the_host() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None);
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
    let second = EVENT_RECORD_BYTES + SEAT_BYTES + BALANCE_BYTES;
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_account())
        .predecessor_account_id(accounts(1))
        .storage_usage(used)
        .account_balance(NearToken::from_yoctonear(bytes_cost(used + second)))
        .build());
    c.create_event(meta(), U128(10 * USDC), 1, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    for _ in 0..=FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    let host = accounts(0);
    assert_eq!(c.create_event_cost(host.clone(), FREE_MAX_CAPACITY, None).0, 0);
    let big = c.create_event_cost(host.clone(), FREE_MAX_CAPACITY + 1, None).0;
    assert_eq!(big, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 51 + BALANCE_BYTES));
    for _ in 0..FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None);
    }
    assert_eq!(c.create_event_cost(host.clone(), 10, None).0, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + BALANCE_BYTES));
    // Another host still has the free tier.
    assert_eq!(c.create_event_cost(accounts(1), 10, None).0, 0);
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn big_event_without_storage_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), FREE_MAX_CAPACITY + 1, None);
}

#[test]
#[should_panic(expected = "beyond the free tier")]
fn big_event_with_too_little_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost - 1));
    c.create_event(meta(), U128(10 * USDC), 60, None);
}

#[test]
fn paid_event_keeps_the_cost_and_returns_the_excess() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), MAX_CAPACITY, None).0;
    let extra = NearToken::from_near(1).as_yoctonear();
    ctx(&accounts(0), NearToken::from_yoctonear(cost + extra));
    let id = c.create_event(meta(), U128(10 * USDC), MAX_CAPACITY, None);
    assert_eq!(c.get_event(id).unwrap().capacity, MAX_CAPACITY);
    assert_eq!(transfers(), vec![(accounts(0), extra)]);
    // Same reservation as a free event of that size.
    assert_eq!(c.reserved_bytes, SEAT_BYTES * u64::from(MAX_CAPACITY) + BALANCE_BYTES);
    // A paid event does not use up the host's free events.
    assert!(c.free_log.get(&accounts(0)).is_none());
}

#[test]
fn exact_cost_sends_nothing_back() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), 51, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(10 * USDC), 51, None);
    assert!(transfers().is_empty());
}

#[test]
fn paid_third_event_is_accepted() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    for _ in 0..FREE_MAX_EVENTS {
        c.create_event(meta(), U128(10 * USDC), 10, None);
    }
    let cost = c.create_event_cost(accounts(0), 10, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(10 * USDC), 10, None);
    assert_eq!(c.events.len(), 3);
}

#[test]
fn free_event_returns_attached_near() {
    ctx(&accounts(0), NearToken::from_near(2));
    let mut c = Contract::new(usdc(), None, None, owner());
    let before = c.unreserved_storage();
    c.create_event(meta(), U128(10 * USDC), FREE_MAX_CAPACITY, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None);
}

#[test]
fn closing_a_free_event_does_not_give_its_slot_back() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    for _ in 0..FREE_MAX_EVENTS {
        let id = c.create_event(meta(), U128(10 * USDC), 10, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(10 * USDC), 10, None);
    at(t1);
    c.create_event(meta(), U128(10 * USDC), 10, None);
    at(t0 + FREE_WINDOW_MS - 1);
    assert!(c.create_event_cost(accounts(0), 10, None).0 > 0);
    at(t0 + FREE_WINDOW_MS);
    assert_eq!(c.create_event_cost(accounts(0), 10, None).0, 0);
    c.create_event(meta(), U128(10 * USDC), 10, None);
    // The next slot waits for the second event's window.
    assert!(c.create_event_cost(accounts(0), 10, None).0 > 0);
    at(t1 + FREE_WINDOW_MS);
    assert_eq!(c.create_event_cost(accounts(0), 10, None).0, 0);
}

#[test]
#[should_panic(expected = "Deposit must be at least 0.1 USDC")]
fn dust_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(MIN_DEPOSIT - 1), 10, None);
}

#[test]
fn withdraw_debits_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
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
    c.finalize(id, vec![evm.clone()]);
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
    c.finalize(id, vec![evm.clone()]);
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
    c.finalize(id, too_many);
}

#[test]
#[should_panic(expected = "Event must end within a year")]
fn rejects_far_future_events() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None, owner());
    let mut m = meta();
    m.ends_at = u64::MAX;
    c.create_event(m, U128(10 * USDC), 10, None);
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
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None);
    assert_eq!(c.get_event(id).unwrap().host, dao);

    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));

    ctx(&accounts(1), one_yocto());
    ctx_ended(&dao);
    c.finalize(id, vec![accounts(2)]);

    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.get_event(id).unwrap().payout_per_attendee.0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(2)).0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.balance_of(dao).0, 0);
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
    c.finalize(id, vec![]);
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
    c.finalize(id, vec![accounts(2), accounts(4)]);

    // 3 seats × 10 USDC, split by 2 attendees.
    let pool = 30 * USDC;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(4)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2);
    let paid_out = c.balance_of(accounts(2)).0
        + c.balance_of(accounts(4)).0
        + c.balance_of(accounts(0)).0;
    assert_eq!(paid_out, 30 * USDC);
}

#[test]
fn empty_event_can_be_finalized() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_finalize_twice() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    c.finalize(id, vec![]);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_cancel_a_finalized_event() {
    let (mut c, id) = setup(10);
    ctx_ended(&accounts(0));
    c.finalize(id, vec![]);
    c.cancel(id);
}

#[test]
#[should_panic(expected = "The event has not ended yet")]
fn host_cannot_finalize_before_the_event_ends() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at - 1) * 1_000_000);
    c.finalize(id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "The event has not ended yet")]
fn ticket_host_cannot_finalize_before_the_event_ends() {
    let (mut c, id) = setup_tickets(10);
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at - 1) * 1_000_000);
    c.finalize(id, vec![]);
}

#[test]
fn host_can_finalize_once_the_event_ends() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

// M-01: no new deposits once the event is over.
#[test]
fn registration_closes_when_the_event_ends() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{id}}}"#);
    assert_eq!(pay_at(&mut c, &accounts(2), 10 * USDC, &msg, meta().ends_at), 10 * USDC);
    assert!(c.get_guest_status(id, accounts(2)).is_none());
    assert_eq!(pay_at(&mut c, &accounts(2), 10 * USDC, &msg, meta().ends_at - 1), 0);
    assert!(c.get_guest_status(id, accounts(2)).is_some());
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
fn stranger_can_cancel_one_millisecond_after_the_grace_period() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), one_yocto(), (boundary_ms + 1) * 1_000_000);
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
#[should_panic(expected = "Only the host can cancel")]
fn stranger_cannot_cancel_on_the_exact_grace_timestamp() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), one_yocto(), boundary_ms * 1_000_000);
    c.cancel(id);
}

#[test]
fn event_created_already_past_the_grace_period_can_be_cancelled_by_anyone() {
    let now_ms = ABANDON_GRACE_MS + 60_000;
    ctx_at(&accounts(0), NearToken::from_near(5), now_ms * 1_000_000);
    let mut c = Contract::new(usdc(), None, None, owner());
    let mut m = meta();
    m.starts_at = 0;
    m.ends_at = 0;
    let id = c.create_event(m, U128(10 * USDC), 10, None);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    c.events.flush();
    let before = env::storage_usage();
    let mut m = meta();
    m.title = "t".repeat(MAX_TITLE_LEN);
    let host: AccountId = format!("{:064x}", 99).parse().unwrap();
    ctx(&host, NearToken::from_yoctonear(0));
    c.create_event(m, U128(MIN_DEPOSIT), FREE_MAX_CAPACITY, None);
    c.events.flush();
    assert!(env::storage_usage() - before <= EVENT_RECORD_BYTES);
}

#[test]
fn one_seat_fits_the_reserved_guest_size_for_a_guest_with_history() {
    let guest: AccountId = format!("{:064x}", 7).parse().unwrap();
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let mut max_used = 0u64;
    for i in 0..24 {
        let host: AccountId = format!("host{i}.testnet").parse().unwrap();
        ctx(&host, NearToken::from_yoctonear(0));
        let id = c.create_event(meta(), U128(10 * USDC), 1, None);
        c.events.flush();
        c.free_log.flush();
        let before = env::storage_usage();
        register(&mut c, id, &guest);
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
    c.finalize(id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(0)), None, None);
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn withdraw_rejects_more_than_the_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(11 * USDC)), None, None);
}

#[test]
fn withdraw_schedules_a_token_transfer_and_a_callback() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
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
    c.finalize(id, vec![evm.clone()]);
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
    c.finalize(id, vec![accounts(2)]);
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
    c.finalize(id, vec![accounts(2)]);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    let id = c.create_event(meta(), U128(10 * USDC), 10, None);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(accounts(2), None);
}

#[test]
#[should_panic(expected = "overflow")]
fn finalize_does_not_wrap_a_huge_pool() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None, owner());
    let deposit = u128::MAX / 2 + 1;
    let id = c.create_event(meta(), U128(deposit), 2, None);
    for guest in [accounts(2), accounts(3)] {
        let refund = pay(&mut c, &guest, deposit, &format!(r#"{{"action":"register","event_id":{id}}}"#));
        assert_eq!(refund, 0);
    }
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2), accounts(3)]);
}

#[test]
fn large_but_safe_pool_splits_exactly() {
    let (mut c, id) = setup(10);
    // Replace the default event by using its deposit? setup uses 10 USDC.
    // A second event carries the large deposit.
    ctx(&accounts(0), NearToken::from_near(5));
    let deposit = 1_000_000_000_000_000_000u128;
    let big = c.create_event(meta(), U128(deposit), 4, None);
    for guest in [accounts(2), accounts(3), accounts(4)] {
        let refund = pay(&mut c, &guest, deposit, &format!(r#"{{"action":"register","event_id":{big}}}"#));
        assert_eq!(refund, 0);
    }
    ctx_ended(&accounts(0));
    c.finalize(big, vec![accounts(2), accounts(3)]);
    let pool = deposit * 3;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, share);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
    let _ = id;
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
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(USDC), MAX_CAPACITY + 1, None);
}

#[test]
#[should_panic(expected = "Deposit must be at least 0.1 USDC")]
fn zero_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None, owner());
    c.create_event(meta(), U128(0), 10, None);
}

#[test]
#[should_panic(expected = "Bad title")]
fn blank_title_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None, owner());
    let mut m = meta();
    m.title = "   ".into();
    c.create_event(m, U128(USDC), 10, None);
}

#[test]
#[should_panic(expected = "Event ends before it starts")]
fn inverted_times_are_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None, owner());
    let mut m = meta();
    m.starts_at = 50;
    m.ends_at = 40;
    c.create_event(m, U128(USDC), 10, None);
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
    c.finalize(id, vec![accounts(2), accounts(3)]);
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
    c.finalize(id, vec![accounts(2)]);
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
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None, owner());
    let id = c.create_event(meta(), U128(TICKET), capacity, Some(EventMode::Ticket));
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
    c.finalize(id, vec![accounts(2)]);
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
    c.finalize(id, vec![]);
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
    c.finalize(id, vec![]);
    let total: u128 = [accounts(0), accounts(2), accounts(3), accounts(4), accounts(5)]
        .into_iter()
        .map(|a| c.balance_of(a).0)
        .sum();
    assert_eq!(total, 4 * TICKET);
}


// ------------------------------------------------------- cancel and limits

#[test]
fn host_can_cancel_at_any_time_and_everyone_is_refunded() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    // After the start and after the end: still the host's call.
    ctx_at(&accounts(0), one_yocto(), (meta().ends_at + 1) * 1_000_000);
    c.cancel(id);
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Cancelled);
    assert!(e.closed_at > 0);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
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
    let mut c = Contract::new(usdc(), None, None, owner());
    for i in 0..120 {
        let host: AccountId = format!("host{i}.testnet").parse().unwrap();
        ctx(&host, NearToken::from_yoctonear(0));
        c.create_event(meta(), U128(MIN_DEPOSIT), 1, None);
    }
    assert_eq!(c.events.len(), 120);
    assert_eq!(c.get_recent_events(None).len(), 50);
    assert_eq!(c.get_recent_events(Some(1_000)).len(), 100);
    assert_eq!(c.get_recent_events(Some(1))[0].id, 119);
}

#[test]
fn max_capacity_event_is_accepted() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    let cost = c.create_event_cost(accounts(0), MAX_CAPACITY, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 300, None);
    assert_eq!(c.get_event(id).unwrap().capacity, 300);
}

// ------------------------------------------------------- attendance count

#[test]
fn attendance_counts_only_checked_in_guests_once_per_event() {
    let (mut c, a) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, a, &g);
    }
    ctx_ended(&accounts(0));
    c.finalize(a, vec![accounts(2), accounts(2), accounts(3)]);
    assert_eq!(c.get_attended_count(accounts(2)), 1);
    assert_eq!(c.get_attended_count(accounts(3)), 1);
    assert_eq!(c.get_attended_count(accounts(4)), 0);

    // Ticket events count too; cancelled events do not.
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let t = c.create_event(meta(), U128(10 * USDC), 10, Some(EventMode::Ticket));
    let x = c.create_event_cost(accounts(0), 10, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(x));
    let cancelled = c.create_event(meta(), U128(10 * USDC), 10, None);
    register(&mut c, t, &accounts(2));
    register(&mut c, cancelled, &accounts(3));
    ctx_ended(&accounts(0));
    c.finalize(t, vec![accounts(2)]);
    ctx(&accounts(0), one_yocto());
    c.cancel(cancelled);
    assert_eq!(c.get_attended_count(accounts(2)), 2);
    assert_eq!(c.get_attended_count(accounts(3)), 1);
    assert_eq!(c.get_attended_count(accounts(5)), 0);
}

/// Worst case: 64-char accounts and a 120-char title. Prints the measured
/// sizes (`cargo test -- --nocapture`) the constants in `lib.rs` are based on.
#[test]
fn storage_reserves_cover_the_measured_worst_case() {
    let long = |n: u32| -> AccountId { format!("{:064x}", n).parse().unwrap() };
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), None, None, owner());
    c.events.flush();
    let host = long(9_999);
    ctx(&host, NearToken::from_yoctonear(0));
    let before = env::storage_usage();
    let mut m = meta();
    m.title = "t".repeat(MAX_TITLE_LEN);
    let id = c.create_event(m, U128(MIN_DEPOSIT), 8, None);
    c.events.flush();
    let event_bytes = env::storage_usage() - before;
    let before = env::storage_usage();
    c.free_log.flush();
    let log_bytes = env::storage_usage() - before;

    let guests: Vec<AccountId> = (0..8).map(long).collect();
    let before = env::storage_usage();
    for g in &guests {
        pay(&mut c, g, MIN_DEPOSIT, &format!(r#"{{"action":"register","event_id":{id}}}"#));
    }
    c.events.flush();
    c.guests.flush();
    c.guest_index.flush();
    let seat_bytes = (env::storage_usage() - before) / 8;

    ctx_ended(&host);
    let before = env::storage_usage();
    // 8 x 0.1 split by 7 leaves a remainder, so the host's balance is written too.
    c.finalize(id, guests[..7].to_vec());
    c.balances.flush();
    c.attended_events.flush();
    c.guests.flush();
    let settle = env::storage_usage() - before;
    eprintln!("measured: event {event_bytes} B, free log {log_bytes} B, registration {seat_bytes} B/seat, settlement {settle} B for 7 attendees + host");
    assert!(event_bytes <= EVENT_RECORD_BYTES, "event used {event_bytes}, reserve {EVENT_RECORD_BYTES}");
    assert!(log_bytes <= FREE_LOG_BYTES, "free log used {log_bytes}, reserve {FREE_LOG_BYTES}");
    assert!(seat_bytes <= STORAGE_BYTES_PER_GUEST, "seat used {seat_bytes}, reserve {STORAGE_BYTES_PER_GUEST}");
    assert!(settle <= 7 * SETTLE_BYTES + BALANCE_BYTES, "settlement used {settle}");
}

#[test]
fn config_reports_the_init_values() {
    ctx(&accounts(0), NearToken::from_near(5));
    let c = Contract::new(usdc(), Some(intents()), Some(accounts(3)), owner());
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
    Contract::new(usdc(), with_intents.then(intents), None, owner())
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
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
    c.events.flush();
    env::state_write(&c);
    let migrated = Contract::migrate();
    assert_eq!(migrated.get_config().owner, owner());
    assert_eq!(migrated.get_event(0).unwrap().capacity, 10);
}

#[test]
fn migrate_converts_the_tp7_layout() {
    let mut c = fresh(true);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
    ctx(&owner(), one_yocto());
    c.add_to_whitelist(vec![accounts(1)]);
    let Contract { usdc, intents, events, guests, guest_index, balances, reserved_bytes, attended_events, relayer, owner, frozen, whitelist, .. } = c;
    env::state_write(&StateTp7 {
        usdc, intents, events, guests, guest_index, balances, reserved_bytes,
        _open_events: LookupMap::new(StorageKey::OpenEvents),
        attended_events, relayer, owner, frozen,
        _whitelist_mode: true,
        whitelist,
    });
    let migrated = Contract::migrate();
    let cfg = migrated.get_config();
    assert_eq!(cfg.owner, self::owner());
    assert!(!cfg.whitelist_mode && !cfg.sponsored_mode, "tp7's mode gated only the free tier; both start off");
    assert!(migrated.is_whitelisted(accounts(1)));
    assert_eq!(migrated.get_event(0).unwrap().capacity, 10);
    assert_eq!(migrated.create_event_cost(accounts(0), 10, None).0, 0);
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
    let cost = bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + BALANCE_BYTES);
    ctx(&accounts(1), NearToken::from_yoctonear(cost));
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
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
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
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
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
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
    c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
}

#[test]
fn unsponsored_host_can_still_pay_for_storage() {
    let mut c = fresh(false);
    ctx(&owner(), one_yocto());
    c.set_sponsored_mode(true);
    let cost = c.create_event_cost(accounts(1), 10, None).0;
    ctx(&accounts(1), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(MIN_DEPOSIT), 10, None);
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
    c.create_event(m.clone(), U128(MIN_DEPOSIT), 10, None);
    m.ends_at += 1;
    let cost = c.create_event_cost(accounts(0), 10, Some(m.ends_at)).0;
    assert_eq!(cost, bytes_cost(EVENT_RECORD_BYTES + SEAT_BYTES * 10 + BALANCE_BYTES));
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(m, U128(MIN_DEPOSIT), 10, None);
    assert_eq!(c.get_event(id).unwrap().capacity, 10);
}

#[test]
#[should_panic(expected = "ending within 60 days")]
fn free_event_ending_after_60_days_needs_storage() {
    let mut c = fresh(false);
    let mut m = meta();
    m.ends_at = 1_000_000 + FREE_MAX_HORIZON_MS + 1;
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.create_event(m, U128(MIN_DEPOSIT), 10, None);
}

#[test]
fn paid_event_returns_empty_seats_at_close() {
    let mut c = fresh(true);
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(10 * USDC), 60, None);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    let refund = bytes_cost(SEAT_BYTES * 58);
    assert_eq!(transfers(), vec![(accounts(0), refund)]);
    // Taken seats and the event record stay paid.
    assert!(cost - refund >= bytes_cost(EVENT_RECORD_BYTES + BALANCE_BYTES + SEAT_BYTES * 2));
}

#[test]
fn empty_paid_event_keeps_only_the_record_cost() {
    let mut c = fresh(false);
    let cost = c.create_event_cost(accounts(0), 60, None).0;
    ctx(&accounts(0), NearToken::from_yoctonear(cost));
    let id = c.create_event(meta(), U128(10 * USDC), 60, None);
    ctx(&accounts(0), one_yocto());
    c.cancel(id);
    let (_, refund) = transfers()[0].clone();
    assert_eq!(cost - refund, bytes_cost(EVENT_RECORD_BYTES + BALANCE_BYTES));
}

#[test]
fn free_event_close_sends_no_near() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx_ended(&accounts(0));
    c.finalize(id, vec![accounts(2)]);
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
    assert_eq!(c.get_event(0).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, MIN_DEPOSIT);
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
