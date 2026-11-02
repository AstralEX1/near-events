use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const USDC: u128 = 1_000_000; // 6 decimals

fn usdc() -> AccountId {
    "usdc.testnet".parse().unwrap()
}

fn ctx(predecessor: &AccountId, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("events.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .block_timestamp(1_000_000_000_000)
        .build());
}

fn meta() -> EventMetadata {
    EventMetadata {
        title: "NEAR meetup".into(),
        description: "Show up and split the pool".into(),
        location: "Belgrade".into(),
        cover_url: None,
        starts_at: 2_000_000,
        ends_at: 3_000_000,
    }
}

/// Host = accounts(0), co-host = accounts(1).
fn setup(capacity: u32) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()));
    let id = c.create_event(meta(), U128(10 * USDC), capacity, Some(vec![accounts(1)]));
    (c, id)
}

fn pay(c: &mut Contract, sender: &AccountId, amount: u128, msg: &str) -> u128 {
    ctx(&usdc(), NearToken::from_yoctonear(0));
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
    pay(&mut c, &accounts(0), 2 * USDC, &format!(r#"{{"action":"sponsor","event_id":{}}}"#, id));

    ctx(&accounts(1), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2), accounts(3), accounts(4)]);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.finalize(id);

    // 4 x 10 + 2 bonus = 42, split by 3 attendees.
    let e = c.get_event(id).unwrap();
    assert_eq!(e.status, EventStatus::Finalized);
    assert_eq!(e.payout_per_attendee.0, 14 * USDC);
    assert_eq!(c.balance_of(accounts(2)).0, 14 * USDC);
    assert_eq!(c.balance_of(accounts(5)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
fn remainder_goes_to_host() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    pay(&mut c, &accounts(0), 1, &format!(r#"{{"action":"sponsor","event_id":{}}}"#, id));
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2), accounts(3)]);
    c.finalize(id);
    // 30 USDC + 1 unit split by 2 → 1 unit remainder to host.
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC);
    assert_eq!(c.balance_of(accounts(0)).0, 1);
}

#[test]
fn nobody_attended_refunds_everyone() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.finalize(id);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
}

#[test]
fn cancel_refunds_deposits_and_bonus_to_host() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    pay(&mut c, &accounts(4), 5 * USDC, &format!(r#"{{"action":"sponsor","event_id":{}}}"#, id));
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.cancel(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(0)).0, 5 * USDC);
}

#[test]
fn overpayment_is_returned_and_friend_can_pay() {
    let (mut c, id) = setup(10);
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    let refund = pay(&mut c, &accounts(2), 12 * USDC, &msg);
    // Paid for someone else: no bounce, the extra goes to the guest's balance.
    assert_eq!(refund, 0);
    assert_eq!(c.balance_of(accounts(3)).0, 2 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
    assert_eq!(c.get_guest_status(id, accounts(2)), None);
    assert_eq!(c.get_guests(id, None, None)[0].paid_by, accounts(2));
}

#[test]
fn reuse_payout_for_next_event() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);

    ctx(&accounts(0), NearToken::from_near(5));
    let next = c.create_event(meta(), U128(10 * USDC), 10, None);
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    c.register_with_balance(next);
    assert_eq!(c.balance_of(accounts(2)).0, 0);
    assert_eq!(c.get_guest_events(accounts(2)), vec![id, next]);
}

#[test]
fn undo_check_in() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2), accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().attended_count, 1);
    c.undo_check_in(id, accounts(2));
    assert_eq!(c.get_event(id).unwrap().attended_count, 0);
}

#[test]
#[should_panic(expected = "Only USDC is accepted")]
fn rejects_other_tokens() {
    let (mut c, id) = setup(10);
    ctx(&accounts(5), NearToken::from_yoctonear(0));
    let _ = c.ft_on_transfer(accounts(2), U128(10 * USDC), format!(r#"{{"action":"register","event_id":{}}}"#, id));
}

#[test]
#[should_panic(expected = "Amount is less than the deposit")]
fn rejects_underpayment() {
    let (mut c, id) = setup(10);
    pay(&mut c, &accounts(2), USDC, &format!(r#"{{"action":"register","event_id":{}}}"#, id));
}

#[test]
#[should_panic(expected = "Already registered")]
fn rejects_double_registration() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(2));
}

#[test]
#[should_panic(expected = "Event is full")]
fn rejects_when_full() {
    let (mut c, id) = setup(1);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
}

#[test]
#[should_panic(expected = "Only the host or a co-host")]
fn guest_cannot_check_in() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "Only the host")]
fn cohost_cannot_finalize() {
    let (mut c, id) = setup(10);
    ctx(&accounts(1), NearToken::from_yoctonear(0));
    c.finalize(id);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn no_registration_after_finalize() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.finalize(id);
    register(&mut c, id, &accounts(2));
}

#[test]
#[should_panic(expected = "Grace period has not passed")]
fn abandoned_refund_waits_for_grace_period() {
    let (mut c, id) = setup(10);
    c.refund_if_abandoned(id);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn create_requires_storage_deposit() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()));
    c.create_event(meta(), U128(10 * USDC), 10, None);
}

#[test]
fn withdraw_debits_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    ctx(&accounts(2), NearToken::from_yoctonear(1));
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
fn intents_payment_for_full_event_goes_to_guest_balance() {
    let (mut c, id) = setup(1);
    register(&mut c, id, &accounts(2));
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    let refund = pay(&mut c, &intents, 10 * USDC, &msg);
    assert_eq!(refund, 0);
    assert_eq!(c.get_guest_status(id, accounts(3)), None);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
}

#[test]
fn intents_payment_registers_guest() {
    let (mut c, id) = setup(10);
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, accounts(3));
    pay(&mut c, &intents, 10 * USDC, &msg);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
    assert_eq!(c.get_guests(id, None, None)[0].paid_by, intents);
}
