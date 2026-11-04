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

fn contract_account() -> AccountId {
    "events.testnet".parse().unwrap()
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
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None);
    let id = c.create_event(meta(), U128(10 * USDC), capacity, Some(vec![accounts(1)]));
    (c, id)
}

fn setup_with_relayer(capacity: u32, relayer: AccountId) -> (Contract, u64) {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), Some(relayer));
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
    ctx(&accounts(1), one_yocto());
    c.check_in(id, vec![accounts(2), accounts(3), accounts(4)]);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);

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
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2), accounts(3)]);
    c.finalize(id);
    // 30 USDC + 3 units split by 2 → 1 unit remainder to host.
    assert_eq!(c.balance_of(accounts(2)).0, 15 * USDC + 1);
    assert_eq!(c.balance_of(accounts(0)).0, 1);
}

#[test]
fn nobody_attended_refunds_everyone() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
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
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);

    ctx(&accounts(0), NearToken::from_near(5));
    let next = c.create_event(meta(), U128(10 * USDC), 10, None);
    ctx(&accounts(2), one_yocto());
    c.register_with_balance(next);
    assert_eq!(c.balance_of(accounts(2)).0, 0);
    assert_eq!(c.get_guest_events(accounts(2)), vec![id, next]);
}

#[test]
fn undo_check_in() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(1), one_yocto());
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
    ctx(&accounts(2), one_yocto());
    c.check_in(id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "Only the host")]
fn cohost_cannot_finalize() {
    let (mut c, id) = setup(10);
    ctx(&accounts(1), one_yocto());
    c.finalize(id);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn no_registration_after_finalize() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
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
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None);
    c.create_event(meta(), U128(10 * USDC), 10, None);
}

#[test]
fn withdraw_debits_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
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

#[test]
fn relayer_can_push_payout_to_owners_intents_account() {
    let relayer: AccountId = "relayer.testnet".parse().unwrap();
    let (mut c, id) = setup_with_relayer(10, relayer.clone());
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, evm);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![evm.clone()]);
    c.finalize(id);
    assert_eq!(c.balance_of(evm.clone()).0, 10 * USDC);
    ctx(&relayer, NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(evm.clone(), None);
    assert_eq!(c.balance_of(evm).0, 0);
}

#[test]
#[should_panic(expected = "Only the owner or the relayer")]
fn stranger_cannot_payout_to_intents() {
    let (mut c, id) = setup(10);
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{},"guest":"{}"}}"#, id, evm);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![evm.clone()]);
    c.finalize(id);
    ctx(&accounts(5), NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(evm, None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn register_with_balance_requires_one_yocto() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    ctx(&accounts(0), NearToken::from_near(5));
    let next = c.create_event(meta(), U128(10 * USDC), 10, None);
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    c.register_with_balance(next);
}

#[test]
#[should_panic(expected = "Too many accounts")]
fn check_in_rejects_oversized_batch() {
    let (mut c, id) = setup(10);
    let too_many: Vec<AccountId> = (0..=MAX_CHECK_IN_BATCH)
        .map(|i| format!("guest{}.testnet", i).parse().unwrap())
        .collect();
    ctx(&accounts(0), one_yocto());
    c.check_in(id, too_many);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn remove_cohost_requires_open() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    c.remove_cohost(id, accounts(1));
}

#[test]
#[should_panic(expected = "Event must end within a year")]
fn rejects_far_future_events() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
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

#[test]
fn host_refunds_one_guest_and_last_guest_takes_the_seat() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4)] {
        register(&mut c, id, &g);
    }
    ctx(&accounts(0), one_yocto());
    c.refund_guest(id, accounts(2));

    let e = c.get_event(id).unwrap();
    assert_eq!(e.guest_count, 2);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
    assert_eq!(c.get_guest_status(id, accounts(2)), None);
    assert!(c.get_guest_events(accounts(2)).is_empty());
    let left: Vec<_> = c.get_guests(id, None, None).into_iter().map(|g| g.account_id).collect();
    assert_eq!(left, vec![accounts(4), accounts(3)]);

    // The freed seat can be taken again, and the pool still adds up.
    register(&mut c, id, &accounts(5));
    ctx(&accounts(1), one_yocto());
    c.check_in(id, vec![accounts(3)]);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    assert_eq!(c.balance_of(accounts(3)).0, 30 * USDC);
}

#[test]
#[should_panic(expected = "Only the host")]
fn cohost_cannot_refund_a_guest() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(1), one_yocto());
    c.refund_guest(id, accounts(2));
}

#[test]
#[should_panic(expected = "Guest is already checked in")]
fn cannot_refund_a_checked_in_guest() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(1), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    ctx(&accounts(0), one_yocto());
    c.refund_guest(id, accounts(2));
}

#[test]
#[should_panic(expected = "Not registered")]
fn refund_of_an_unknown_guest_is_not_an_overflow() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.refund_guest(id, accounts(2));
}

/// A Sputnik DAO is just another account. It can host; a human co-host checks
/// guests in; only the DAO account can finalize. Mirrors the unmerged DAO-host
/// cycle without adding DAO-specific methods.
#[test]
fn contract_account_can_host_and_a_cohost_checks_in() {
    let dao: AccountId = "community.sputnik-v2.testnet".parse().unwrap();
    ctx(&dao, NearToken::from_near(5));
    let mut c = Contract::new(usdc(), Some("intents.near".parse().unwrap()), None);
    let id = c.create_event(meta(), U128(10 * USDC), 10, Some(vec![accounts(1)]));
    assert_eq!(c.get_event(id).unwrap().host, dao);

    register(&mut c, id, &accounts(2));
    register(&mut c, id, &accounts(3));

    ctx(&accounts(1), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    ctx(&dao, one_yocto());
    c.finalize(id);

    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.get_event(id).unwrap().payout_per_attendee.0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(2)).0, 20 * USDC);
    assert_eq!(c.balance_of(accounts(3)).0, 0);
    assert_eq!(c.balance_of(dao).0, 0);
}

#[test]
#[should_panic(expected = "Only the host")]
fn cohost_cannot_finalize_a_contract_hosted_event() {
    let dao: AccountId = "community.sputnik-v2.testnet".parse().unwrap();
    ctx(&dao, NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
    let id = c.create_event(meta(), U128(10 * USDC), 10, Some(vec![accounts(1)]));
    ctx(&accounts(1), one_yocto());
    c.finalize(id);
}

#[test]
fn third_party_short_payment_is_kept_for_the_guest() {
    let (mut c, id) = setup(10);
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &intents, USDC, &msg);
    assert_eq!(refund, 0);
    assert_eq!(c.get_guest_status(id, accounts(3)), None);
    assert_eq!(c.balance_of(accounts(3)).0, USDC);

    let friend_msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(4));
    let refund = pay(&mut c, &accounts(2), 4 * USDC, &friend_msg);
    assert_eq!(refund, 0);
    assert_eq!(c.get_guest_status(id, accounts(4)), None);
    assert_eq!(c.balance_of(accounts(4)).0, 4 * USDC);
}

#[test]
fn third_party_payment_for_a_missing_or_closed_event_is_kept_for_the_guest() {
    let (mut c, id) = setup(10);
    let missing = format!(r#"{{"action":"register","event_id":99,"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &missing);
    assert_eq!(refund, 0);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);

    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    let closed = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(4));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &closed);
    assert_eq!(refund, 0);
    assert_eq!(c.get_guest_status(id, accounts(4)), None);
    assert_eq!(c.balance_of(accounts(4)).0, 10 * USDC);
}

#[test]
#[should_panic(expected = "Event not found")]
fn self_payment_for_a_missing_event_still_refunds() {
    let (mut c, id) = setup(10);
    let _ = id;
    pay(&mut c, &accounts(2), 10 * USDC, r#"{"action":"register","event_id":99}"#);
}

#[test]
fn second_payment_for_someone_already_registered_is_kept_on_their_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(3));
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{}"}}"#, accounts(3));
    let refund = pay(&mut c, &accounts(2), 10 * USDC, &msg);
    assert_eq!(refund, 0);
    assert_eq!(c.get_guest_status(id, accounts(3)), Some(GuestStatus::Registered));
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
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
fn refunds_check_ins_and_dust_still_add_up_to_the_pool() {
    let (mut c, id) = setup(10);
    for g in [accounts(2), accounts(3), accounts(4), accounts(5)] {
        register(&mut c, id, &g);
    }
    ctx(&accounts(0), one_yocto());
    c.refund_guest(id, accounts(3));
    c.check_in(id, vec![accounts(2), accounts(4)]);
    c.finalize(id);

    // 3 seats left × 10 USDC, split by 2 attendees.
    let pool = 30 * USDC;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(4)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, 10 * USDC);
    assert_eq!(c.balance_of(accounts(5)).0, 0);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2);
    let paid_out = c.balance_of(accounts(2)).0
        + c.balance_of(accounts(4)).0
        + c.balance_of(accounts(0)).0
        + c.balance_of(accounts(3)).0;
    assert_eq!(paid_out, 40 * USDC);
}

#[test]
fn empty_event_can_be_finalized() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(0)).0, 0);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_finalize_twice() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    c.finalize(id);
}

#[test]
#[should_panic(expected = "Event is closed")]
fn cannot_abandon_a_finalized_event() {
    let (mut c, id) = setup(10);
    ctx(&accounts(0), one_yocto());
    c.finalize(id);
    c.refund_if_abandoned(id);
}

#[test]
fn host_can_finalize_before_the_event_starts() {
    // The test clock is 1_000_000 ms. The sample event starts at 2_000_000 ms.
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Finalized);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
fn cohost_can_check_in_after_the_event_has_ended() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let after_end_ns = (meta().ends_at + 1) * 1_000_000;
    ctx_at(&accounts(1), one_yocto(), after_end_ns);
    c.check_in(id, vec![accounts(2)]);
    assert_eq!(c.get_event(id).unwrap().attended_count, 1);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Open);
}

#[test]
#[should_panic(expected = "Grace period has not passed")]
fn check_in_after_the_end_does_not_open_the_abandon_refund() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let after_end_ns = (meta().ends_at + 1) * 1_000_000;
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), after_end_ns);
    c.refund_if_abandoned(id);
}

#[test]
fn abandon_refund_opens_one_millisecond_after_the_grace_period() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), (boundary_ms + 1) * 1_000_000);
    c.refund_if_abandoned(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
#[should_panic(expected = "Grace period has not passed")]
fn abandon_refund_is_closed_on_the_exact_grace_timestamp() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    let boundary_ms = meta().ends_at + ABANDON_GRACE_MS;
    ctx_at(&accounts(5), NearToken::from_yoctonear(0), boundary_ms * 1_000_000);
    c.refund_if_abandoned(id);
}

#[test]
fn event_created_already_past_the_grace_period_can_be_refunded_immediately() {
    let now_ms = ABANDON_GRACE_MS + 60_000;
    ctx_at(&accounts(0), NearToken::from_near(5), now_ms * 1_000_000);
    let mut c = Contract::new(usdc(), None, None);
    let mut m = meta();
    m.starts_at = 0;
    m.ends_at = 0;
    let id = c.create_event(m, U128(10 * USDC), 10, None);
    register(&mut c, id, &accounts(2));
    let stranger: AccountId = "stranger.testnet".parse().unwrap();
    ctx_at(&stranger, NearToken::from_yoctonear(0), now_ms * 1_000_000);
    c.refund_if_abandoned(id);
    assert_eq!(c.get_event(id).unwrap().status, EventStatus::Cancelled);
    assert_eq!(c.balance_of(accounts(2)).0, 10 * USDC);
}

#[test]
fn added_cohost_draws_from_that_events_storage_budget() {
    let (mut c, id) = setup(10);
    let before = c.event(id).storage_budget;
    let extra: AccountId = "door.testnet".parse().unwrap();
    ctx(&accounts(0), one_yocto());
    c.add_cohost(id, extra.clone());
    let after_cohost = c.event(id).storage_budget;
    assert!(after_cohost < before, "a new co-host has to be paid for by this event");
    ctx(&accounts(0), one_yocto());
    c.add_cohost(id, extra.clone());
    assert_eq!(c.event(id).storage_budget, after_cohost, "adding the same co-host twice is free");
    ctx(&accounts(0), one_yocto());
    c.remove_cohost(id, extra);
    assert!(c.event(id).storage_budget > after_cohost);
}

#[test]
fn storage_cost_quote_covers_the_largest_event() {
    ctx(&accounts(0), NearToken::from_yoctonear(0));
    let c = Contract::new(usdc(), None, None);
    let quote = c.storage_cost(MAX_CAPACITY).0;
    ctx(&accounts(0), NearToken::from_yoctonear(quote));
    let mut c = Contract::new(usdc(), None, None);
    let mut m = meta();
    m.title = "t".repeat(MAX_TITLE_LEN);
    m.description = "d".repeat(MAX_TEXT_LEN);
    m.location = "l".repeat(MAX_SHORT_LEN);
    m.cover_url = Some("u".repeat(MAX_SHORT_LEN));
    let cohosts: Vec<AccountId> = (0..MAX_COHOSTS).map(|i| format!("{i:064x}").parse().unwrap()).collect();
    c.create_event(m, U128(1), MAX_CAPACITY, Some(cohosts));
}

#[test]
fn prepaid_seat_covers_registration_for_a_guest_with_history() {
    let guest: AccountId = format!("{:064x}", 7).parse().unwrap();
    ctx(&accounts(0), NearToken::from_near(40));
    let mut c = Contract::new(usdc(), None, None);
    let mut max_used = 0u128;
    for _ in 0..24 {
        ctx(&accounts(0), NearToken::from_near(40));
        let id = c.create_event(meta(), U128(10 * USDC), 1, None);
        let before = c.event(id).storage_budget;
        register(&mut c, id, &guest);
        let used = before - c.event(id).storage_budget;
        max_used = max_used.max(used);
    }
    assert!(
        max_used <= bytes_cost(STORAGE_BYTES_PER_GUEST),
        "one registration used {max_used} yoctoNEAR, the prepaid seat is {}",
        bytes_cost(STORAGE_BYTES_PER_GUEST)
    );
}

#[test]
fn top_up_extends_an_existing_balance_only() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    let refund = pay(
        &mut c,
        &accounts(4),
        3 * USDC,
        &format!(r#"{{"action":"top_up","account_id":"{}"}}"#, accounts(2)),
    );
    assert_eq!(refund, 0);
    assert_eq!(c.balance_of(accounts(2)).0, 13 * USDC);
}

#[test]
#[should_panic(expected = "Top-up needs an existing balance")]
fn top_up_rejects_a_new_account() {
    let (mut c, _) = setup(10);
    pay(&mut c, &accounts(2), USDC, r#"{"action":"top_up"}"#);
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn register_with_balance_rejects_a_short_balance() {
    let (mut c, id) = setup(10);
    ctx(&accounts(2), one_yocto());
    c.register_with_balance(id);
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_rejects_zero() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(0)), None, None);
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn withdraw_rejects_more_than_the_balance() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    ctx(&accounts(2), one_yocto());
    let _ = c.withdraw(Some(U128(11 * USDC)), None, None);
}

#[test]
fn withdraw_schedules_a_token_transfer_and_a_callback() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
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
    let (mut c, id) = setup(10);
    let evm: AccountId = "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap();
    let intents: AccountId = "intents.near".parse().unwrap();
    let msg = format!(r#"{{"action":"register","event_id":{id},"guest":"{evm}"}}"#);
    pay(&mut c, &intents, 10 * USDC, &msg);
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![evm.clone()]);
    c.finalize(id);
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
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
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
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
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
    let mut c = Contract::new(usdc(), None, None);
    let id = c.create_event(meta(), U128(10 * USDC), 10, None);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.finalize(id);
    ctx(&accounts(2), NearToken::from_yoctonear(0));
    let _ = c.payout_to_intents(accounts(2), None);
}

#[test]
#[should_panic(expected = "overflow")]
fn finalize_does_not_wrap_a_huge_pool() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
    let deposit = u128::MAX / 2 + 1;
    let id = c.create_event(meta(), U128(deposit), 2, None);
    for guest in [accounts(2), accounts(3)] {
        let refund = pay(&mut c, &guest, deposit, &format!(r#"{{"action":"register","event_id":{id}}}"#));
        assert_eq!(refund, 0);
    }
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2), accounts(3)]);
    c.finalize(id);
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
    ctx(&accounts(0), one_yocto());
    c.check_in(big, vec![accounts(2), accounts(3)]);
    c.finalize(big);
    let pool = deposit * 3;
    let share = pool / 2;
    assert_eq!(c.balance_of(accounts(2)).0, share);
    assert_eq!(c.balance_of(accounts(3)).0, share);
    assert_eq!(c.balance_of(accounts(0)).0, pool - share * 2);
    assert_eq!(c.balance_of(accounts(4)).0, 0);
    let _ = id;
}

#[test]
fn undo_twice_does_not_underflow() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2)]);
    c.undo_check_in(id, accounts(2));
    c.undo_check_in(id, accounts(2));
    assert_eq!(c.get_event(id).unwrap().attended_count, 0);
}

#[test]
#[should_panic(expected = "Only the host or a co-host")]
fn removed_cohost_cannot_check_in() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.remove_cohost(id, accounts(1));
    ctx(&accounts(1), one_yocto());
    c.check_in(id, vec![accounts(2)]);
}

#[test]
#[should_panic(expected = "Only the host")]
fn stranger_cannot_add_a_cohost() {
    let (mut c, id) = setup(10);
    let stranger: AccountId = "stranger.testnet".parse().unwrap();
    ctx(&stranger, one_yocto());
    c.add_cohost(id, "door.testnet".parse().unwrap());
}

#[test]
#[should_panic(expected = "Only the host")]
fn cohost_cannot_cancel() {
    let (mut c, id) = setup(10);
    ctx(&accounts(1), one_yocto());
    c.cancel(id);
}

#[test]
#[should_panic(expected = "Too many co-hosts")]
fn eleventh_cohost_is_rejected() {
    let (mut c, id) = setup(10);
    for i in 0..MAX_COHOSTS {
        ctx(&accounts(0), one_yocto());
        let account: AccountId = format!("door{i}.testnet").parse().unwrap();
        c.add_cohost(id, account);
    }
}

#[test]
#[should_panic(expected = "Capacity out of range")]
fn capacity_above_the_max_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
    c.create_event(meta(), U128(USDC), MAX_CAPACITY + 1, None);
}

#[test]
#[should_panic(expected = "Deposit must be positive")]
fn zero_deposit_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
    c.create_event(meta(), U128(0), 10, None);
}

#[test]
#[should_panic(expected = "Bad title")]
fn blank_title_is_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
    let mut m = meta();
    m.title = "   ".into();
    c.create_event(m, U128(USDC), 10, None);
}

#[test]
#[should_panic(expected = "Event ends before it starts")]
fn inverted_times_are_rejected() {
    ctx(&accounts(0), NearToken::from_near(5));
    let mut c = Contract::new(usdc(), None, None);
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
    assert_eq!(c.usdc(), usdc());
    assert_eq!(c.intents().unwrap().as_str(), "intents.near");
    assert!(c.relayer().is_none());
    assert_eq!(c.get_events_count(), 1);
    assert!(c.get_event(99).is_none());
    assert!(c.get_events(Some(5), Some(10)).is_empty());
    assert_eq!(c.get_events(Some(0), Some(1_000)).len(), 1);
    assert_eq!(c.get_guests(id, Some(1), Some(1)).len(), 1);
    assert_eq!(c.get_guests(id, Some(1), Some(1))[0].account_id, accounts(3));
    assert!(c.get_guests(id, Some(50), Some(10)).is_empty());
    let unknown: AccountId = "unknown.testnet".parse().unwrap();
    assert_eq!(c.balance_of(unknown).0, 0);
    assert_eq!(c.get_guest_events(accounts(2)), vec![id]);
}

#[test]
#[should_panic(expected = "is not registered")]
fn check_in_of_an_unknown_guest_reverts_the_batch() {
    let (mut c, id) = setup(10);
    register(&mut c, id, &accounts(2));
    ctx(&accounts(0), one_yocto());
    c.check_in(id, vec![accounts(2), accounts(3)]);
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
