//! Real NEAR runtime tests. Unit tests never move a token or run a callback;
//! these do. Testnet-only contracts, local sandbox, no mainnet.
//!
//! The escrow is built with `--features short-windows`: one oracle "hour" is
//! 10 seconds, so the 12 h dispute window is 120 s of sandbox time. The money
//! rules and every check are the same code as the release build.
//!
//! Optional fixtures (read-only copies of on-chain code; tests that need one
//! are skipped without it):
//! - `SPUTNIK_WASM`: a Sputnik DAO v2.3.1 contract, e.g. the code of any DAO
//!   made by `sputnikv2.testnet` (hash `AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH`).
//! - `V2_ESCROW_WASM`: the code of mainnet `escrow.lold.near`
//!   (hash `7nrLLgzcUP1NUyUcKACekuq1EoEXWe5jW5a314HiVjm4`).

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use anyhow::Context;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

/// One oracle "hour" in the short-windows build (`ORACLE_HOUR_MS`).
const HOUR_MS: u64 = 10_000;
const WINDOW_MS: u64 = 12 * HOUR_MS;
const SUBMIT_MS: u64 = 72 * HOUR_MS;
const USDC: u128 = 1_000_000;

fn wasm(package: &str) -> &'static [u8] {
    static EVENTS: OnceLock<Vec<u8>> = OnceLock::new();
    static USDC_WASM: OnceLock<Vec<u8>> = OnceLock::new();
    let slot = if package == "near-events" { &EVENTS } else { &USDC_WASM };
    slot.get_or_init(|| build_wasm(package))
}

fn build_wasm(package: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut args = vec!["build", "--locked", "-p", package, "--release", "--target", "wasm32-unknown-unknown"];
    if package == "near-events" {
        args.extend(["--features", "short-windows"]);
    }
    let status = Command::new("cargo").args(args).current_dir(&root).status().expect("cargo build");
    assert!(status.success(), "wasm build failed for {package}");
    let file = package.replace('-', "_");
    std::fs::read(root.join(format!("target/wasm32-unknown-unknown/release/{file}.wasm")))
        .expect("wasm output")
}

fn fixture(var: &str) -> Option<Vec<u8>> {
    let path = std::env::var(var).ok()?;
    Some(std::fs::read(&path).unwrap_or_else(|e| panic!("{var}={path}: {e}")))
}

fn yocto(amount: u128) -> NearToken {
    NearToken::from_yoctonear(amount)
}

async fn token_balance(token: &Contract, account: &AccountId) -> anyhow::Result<u128> {
    let value: String = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": account }))
        .await?
        .json()?;
    value.parse().context("token balance")
}

async fn escrow_balance(events: &Contract, account: &AccountId) -> anyhow::Result<u128> {
    let value: String = events
        .view("balance_of")
        .args_json(json!({ "account_id": account }))
        .await?
        .json()?;
    value.parse().context("escrow balance")
}

async fn mint(token: &Contract, caller: &Account, account: &AccountId, amount: u128) -> anyhow::Result<()> {
    storage_deposit(token, caller, account).await?;
    caller
        .call(token.id(), "mint")
        .args_json(json!({ "amount": amount.to_string(), "account_id": account }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn storage_deposit(token: &Contract, payer: &Account, account: &AccountId) -> anyhow::Result<()> {
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let min: u128 = bounds["min"].as_str().context("storage min")?.parse()?;
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": account, "registration_only": true }))
        .deposit(yocto(min))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

fn panic_text(result: &ExecutionFinalResult) -> String {
    format!("{result:?}")
}

/// A contract built without `--cfg near` turns `require!` into a bare
/// unreachable trap. `contracts/.cargo/config.toml` sets that cfg. Unit tests
/// lock the text; here either form counts as the expected refusal.
fn expect_reject(result: &ExecutionFinalResult, needle: &str) {
    let text = panic_text(result);
    assert!(result.is_failure(), "expected {needle}, call succeeded: {text}");
    assert!(
        text.contains(needle) || text.contains("unreachable"),
        "expected {needle}, got {text}"
    );
}

async fn transfer_call(
    payer: &Account,
    token: &AccountId,
    receiver: &AccountId,
    amount: u128,
    msg: Value,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(payer
        .call(token, "ft_transfer_call")
        .args_json(json!({
            "receiver_id": receiver,
            "amount": amount.to_string(),
            "memo": null,
            "msg": msg.to_string(),
        }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?)
}

/// Produces blocks until the sandbox clock reaches `ms`.
async fn wait_until(worker: &Worker<Sandbox>, ms: u64) -> anyhow::Result<()> {
    for _ in 0..400 {
        if worker.view_block().await?.timestamp() / 1_000_000 > ms {
            return Ok(());
        }
        worker.fast_forward(500).await?;
    }
    anyhow::bail!("the sandbox clock did not reach {ms}")
}

async fn now_ms(worker: &Worker<Sandbox>) -> anyhow::Result<u64> {
    Ok(worker.view_block().await?.timestamp() / 1_000_000)
}

async fn event_view(events: &Contract, id: u64) -> anyhow::Result<Value> {
    Ok(events.view("get_event").args_json(json!({ "event_id": id })).await?.json()?)
}

/// A v3 escrow with its owner and a plain account standing in for the DAO.
async fn new_escrow(worker: &Worker<Sandbox>, usdc: &Contract, payer: &Account) -> anyhow::Result<(Contract, Account, Account)> {
    let events = worker.dev_deploy(wasm("near-events")).await?;
    let owner = worker.dev_create_account().await?;
    let dao = worker.dev_create_account().await?;
    events.call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": owner.id() }))
        .transact().await?.into_result()?;
    configure(&owner, &events, dao.id()).await?;
    storage_deposit(usdc, payer, events.id()).await?;
    Ok((events, owner, dao))
}

/// The default rules with a court: 2 deposits per seat, 12 h window, 72 h to publish, 7 days for the court.
fn court_rules(dao: &AccountId, treasury: &AccountId) -> Value {
    json!({ "dao": dao, "treasury": treasury, "bond_per_seat": 2, "close_at_start": true,
            "challenge_hours": 12, "submit_hours": 72, "resolve_hours": 168 })
}

/// The treasury is the owner in these tests.
async fn configure(owner: &Account, events: &Contract, dao: &AccountId) -> anyhow::Result<()> {
    owner.call(events.id(), "set_rules")
        .args_json(json!({ "rules": court_rules(dao, owner.id()) }))
        .deposit(yocto(1))
        .transact().await?.into_result()?;
    Ok(())
}

/// The host mints and locks the bond the event needs (one deposit per seat).
async fn lock_bond(host: &Account, usdc: &Contract, events: &Contract, id: u64) -> anyhow::Result<()> {
    let bond: u128 = event_view(events, id).await?["bond_due"].as_str().unwrap().parse()?;
    mint(usdc, host, host.id(), bond).await?;
    transfer_call(host, usdc.id(), events.id(), bond, json!({ "action": "host_bond", "event_id": id }))
        .await?
        .into_result()?;
    assert_eq!(event_view(events, id).await?["host_bond"], bond.to_string(), "the bond was not taken");
    Ok(())
}

async fn call_settle(caller: &Account, events: &Contract, id: u64) -> anyhow::Result<ExecutionFinalResult> {
    Ok(caller.call(events.id(), "settle")
        .args_json(json!({ "event_id": id }))
        .gas(Gas::from_tgas(300))
        .transact().await?)
}

async fn finalize(host: &Account, events: &Contract, id: u64, attended: Value) -> anyhow::Result<ExecutionFinalResult> {
    Ok(host.call(events.id(), "finalize")
        .args_json(json!({ "event_id": id, "attended": attended }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(300))
        .transact().await?)
}

/// Standard base64, for `FunctionCall` proposal arguments.
fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// Each guest pays 1 USDC with its own message, 16 at a time; every payment must be kept.
async fn pay_each(usdc: &AccountId, receiver: &AccountId, guests: &[Account], msgs: Vec<Value>) -> anyhow::Result<()> {
    let mut msgs = msgs.into_iter();
    for batch in guests.chunks(16) {
        let mut tasks = tokio::task::JoinSet::new();
        for guest in batch.iter().cloned() {
            let (usdc, receiver, msg) = (usdc.clone(), receiver.clone(), msgs.next().unwrap());
            tasks.spawn(async move {
                let used: String = transfer_call(&guest, &usdc, &receiver, USDC, msg).await?.json()?;
                anyhow::ensure!(used == "1000000", "payment was not accepted");
                Ok::<(), anyhow::Error>(())
            });
        }
        while let Some(result) = tasks.join_next().await {
            result??;
        }
    }
    Ok(())
}

async fn act(dao: &Contract, member: &Account, pid: u64, action: &str) -> anyhow::Result<ExecutionFinalResult> {
    // Sputnik checks that `proposal` repeats the proposal's kind (ERR_WRONG_KIND).
    let kind = dao.view("get_proposal").args_json(json!({ "id": pid })).await?.json::<Value>()?["kind"].clone();
    Ok(member.call(dao.id(), "act_proposal")
        .args_json(json!({ "id": pid, "action": action, "proposal": kind }))
        .gas(Gas::from_tgas(300))
        .transact().await?)
}

/// Three council votes; returns the third (the one that executes or rejects).
async fn vote3(dao: &Contract, council: &[Account], pid: u64, action: &str) -> anyhow::Result<ExecutionFinalResult> {
    act(dao, &council[0], pid, action).await?.into_result()?;
    act(dao, &council[1], pid, action).await?.into_result()?;
    act(dao, &council[2], pid, action).await
}

async fn proposal_status(dao: &Contract, pid: u64) -> anyhow::Result<String> {
    let p: Value = dao.view("get_proposal").args_json(json!({ "id": pid })).await?.json()?;
    Ok(p["status"].as_str().unwrap_or_default().to_string())
}

fn dispute(id: u64, target: &AccountId, attended: bool) -> Value {
    json!({ "action": "dispute", "event_id": id, "target": target, "attended": attended })
}

#[tokio::test]
async fn sandbox_escrow_cycle() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let usdc_wasm = wasm("test-usdc");
    let events_wasm = wasm("near-events");

    // A `*.test.near` name and an implicit account are mainnet-shaped. The
    // faucet must refuse to initialize on either.
    let named = worker.dev_deploy(usdc_wasm).await?;
    let refused = named.call("new").transact().await?;
    expect_reject(&refused, "testnet-only");

    let usdc = worker.dev_deploy_tla(usdc_wasm).await?;
    usdc.call("new").transact().await?.into_result()?;
    let too_much = usdc
        .call("mint")
        .args_json(json!({ "amount": (1_000 * USDC + 1).to_string(), "account_id": null }))
        .transact()
        .await?;
    expect_reject(&too_much, "Max 1000");

    let events = worker.dev_deploy(events_wasm).await?;
    let owner = worker.dev_create_account().await?;
    let dao = worker.dev_create_account().await?;
    let untrusted = worker.dev_create_account().await?;
    let rejected = untrusted.call(events.id(), "new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": owner.id() }))
        .transact().await?;
    assert!(rejected.is_failure(), "a third party initialized the escrow");
    events
        .call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": owner.id() }))
        .transact()
        .await?
        .into_result()?;

    let host = worker.dev_create_account().await?;
    let helper = worker.dev_create_account().await?;
    let guest = worker.dev_create_account().await?;
    let noshow = worker.dev_create_account().await?;
    let friend = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;
    let sponsor = worker.dev_create_account().await?;
    let fresh = worker.dev_create_account().await?;

    storage_deposit(&usdc, &host, events.id()).await?;
    let minted = 50 * USDC;
    for account in [guest.id(), noshow.id(), friend.id(), sponsor.id()] {
        mint(&usdc, &guest, account, minted).await?;
    }

    // Deposit events wait for the owner to name the dispute DAO.
    let start = now_ms(&worker).await?;
    let create = |host: &Account, title: &str, starts_at: u64, ends_at: u64, capacity: u32| {
        host.call(events.id(), "create_event")
            .args_json(json!({
                "metadata": { "title": title, "starts_at": starts_at, "ends_at": ends_at },
                "deposit": "10000000",
                "capacity": capacity
            }))
            .transact()
    };
    // Before the owner names a court, a Deposit event takes no bond (the host's list is final).
    let early: u64 = create(&stranger, "No court yet", start + 300_000, start + 600_000, 10).await?.json()?;
    let early = event_view(&events, early).await?;
    assert_eq!((early["dao"].clone(), early["bond_due"].clone()), (Value::Null, json!("0")));
    let stranger_config = stranger.call(events.id(), "set_rules")
        .args_json(json!({ "rules": court_rules(stranger.id(), helper.id()) }))
        .deposit(yocto(1))
        .transact().await?;
    expect_reject(&stranger_config, "Only the owner");
    // A bond above 2 deposits per seat is out of range (0-2, Alex 2026-11-13).
    let mut big_bond = court_rules(dao.id(), owner.id());
    big_bond["bond_per_seat"] = json!(3);
    let unsafe_rules = owner.call(events.id(), "set_rules").args_json(json!({ "rules": big_bond })).deposit(yocto(1)).transact().await?;
    expect_reject(&unsafe_rules, "out of range");
    configure(&owner, &events, dao.id()).await?;

    let now_ms = now_ms(&worker).await?;
    // Registration closes at the start (Deposit), so it is set well after the sign-ups below.
    let event_id: u64 = create(&host, "QA meetup", now_ms + 300_000, now_ms + 600_000, 10).await?.json()?;

    for caller in [&stranger, &helper] {
        expect_reject(&finalize(caller, &events, event_id, json!([])).await?, "Only the host");
    }
    expect_reject(&finalize(&host, &events, event_id, json!([])).await?, "The event has not ended yet");

    // Registration opens once the host bond is in: before that the USDC comes back.
    let deposit = 10 * USDC;
    let register = json!({ "action": "register", "event_id": event_id });
    transfer_call(&guest, usdc.id(), events.id(), deposit, register.clone()).await?.into_result()?;
    assert_eq!(token_balance(&usdc, guest.id()).await?, minted, "registered before the host bond");
    // The bond is 2 deposits per seat: 10 seats × 2 × 10 USDC. A short bond is refused in full by the real token resolver.
    assert_eq!(event_view(&events, event_id).await?["bond_due"], "200000000");
    mint(&usdc, &host, host.id(), 400 * USDC).await?;
    transfer_call(&host, usdc.id(), events.id(), 199 * USDC, json!({ "action": "host_bond", "event_id": event_id })).await?.into_result()?;
    assert_eq!(token_balance(&usdc, host.id()).await?, 400 * USDC, "a short bond was kept");
    // Overpaid: the change comes back.
    transfer_call(&host, usdc.id(), events.id(), 210 * USDC, json!({ "action": "host_bond", "event_id": event_id })).await?.into_result()?;
    assert_eq!(token_balance(&usdc, host.id()).await?, 200 * USDC);
    assert_eq!(event_view(&events, event_id).await?["host_bond"], "200000000");
    // The host cannot take a seat.
    transfer_call(&host, usdc.id(), events.id(), deposit, register.clone()).await?.into_result()?;
    assert_eq!(token_balance(&usdc, host.id()).await?, 200 * USDC, "the host took a seat");

    // Exact self payment, then a second one. The second must come back.
    transfer_call(&guest, usdc.id(), events.id(), deposit, register.clone()).await?.into_result()?;
    assert_eq!(token_balance(&usdc, guest.id()).await?, minted - deposit);
    transfer_call(&guest, usdc.id(), events.id(), deposit, register.clone()).await?.into_result()?;
    assert_eq!(token_balance(&usdc, guest.id()).await?, minted - deposit, "double RSVP must refund");
    transfer_call(&noshow, usdc.id(), events.id(), deposit, register.clone()).await?.into_result()?;

    // Paying for someone else returns the whole amount without opening a balance.
    let late: AccountId = "late.testnet".parse().unwrap();
    let friend_before = token_balance(&usdc, friend.id()).await?;
    transfer_call(&friend, usdc.id(), events.id(), 4 * USDC, json!({ "action": "register", "event_id": event_id, "guest": late }))
        .await?
        .into_result()?;
    assert_eq!(token_balance(&usdc, friend.id()).await?, friend_before);
    assert_eq!(escrow_balance(&events, &late).await?, 0);

    // Some other NEP-141. The escrow panics, and that token refunds the sender.
    let other = worker.dev_deploy_tla(usdc_wasm).await?;
    other.call("new").transact().await?.into_result()?;
    mint(&other, &friend, friend.id(), minted).await?;
    storage_deposit(&other, &host, events.id()).await?;
    let other_before = token_balance(&other, friend.id()).await?;
    transfer_call(&friend, other.id(), events.id(), deposit, register.clone()).await?.into_result()?;
    assert_eq!(token_balance(&other, friend.id()).await?, other_before, "wrong token must be refunded");

    // An unknown action: the token sends the whole amount back.
    let sponsor_before = token_balance(&usdc, sponsor.id()).await?;
    let _ = transfer_call(&sponsor, usdc.id(), events.id(), 5 * USDC, json!({ "action": "sponsor", "event_id": event_id })).await?;
    assert_eq!(token_balance(&usdc, sponsor.id()).await?, sponsor_before, "unknown action must be refunded");

    // Registration closes at the start: a late payment comes back in full (audit E-H1).
    wait_until(&worker, now_ms + 300_000).await?;
    let late: String = transfer_call(&sponsor, usdc.id(), events.id(), deposit, register.clone()).await?.json()?;
    assert_eq!(late, "0", "a payment after the start was accepted");
    wait_until(&worker, now_ms + 600_000).await?;

    // The host publishes who came; nothing is paid during the dispute window.
    finalize(&host, &events, event_id, json!([guest.id()])).await?.into_result()?;
    expect_reject(&finalize(&host, &events, event_id, json!([])).await?, "Event is closed");
    let event = event_view(&events, event_id).await?;
    assert_eq!(event["status"], "Submitted");
    assert_eq!(escrow_balance(&events, guest.id()).await?, 0);
    expect_reject(&call_settle(&stranger, &events, event_id).await?, "window is still open");

    // The window passes with no dispute: anyone settles.
    let ends = event["challenge_ends_at"].as_u64().unwrap();
    wait_until(&worker, ends).await?;
    call_settle(&stranger, &events, event_id).await?.into_result()?;
    expect_reject(&call_settle(&stranger, &events, event_id).await?, "Nothing to settle");
    assert_eq!(escrow_balance(&events, guest.id()).await?, 20 * USDC);
    assert_eq!(escrow_balance(&events, noshow.id()).await?, 0);
    assert_eq!(escrow_balance(&events, host.id()).await?, 200 * USDC, "the bond goes back to the host");
    let event = event_view(&events, event_id).await?;
    assert_eq!(event["status"], "Finalized");
    assert_eq!(event["payout_per_attendee"], "20000000");

    // Sending the payout to an account the token does not know fails.
    // The callback has to put the balance back.
    guest
        .call(events.id(), "withdraw")
        .args_json(json!({ "amount": null, "receiver_id": fresh.id(), "to_intents": false }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(escrow_balance(&events, guest.id()).await?, 20 * USDC, "failed transfer must restore the balance");

    let forged = guest
        .call(events.id(), "on_withdraw")
        .args_json(json!({ "owner": guest.id(), "amount": "1", "to_intents": false }))
        .transact()
        .await?;
    expect_reject(&forged, "private");

    let guest_tokens_before = token_balance(&usdc, guest.id()).await?;
    guest
        .call(events.id(), "withdraw")
        .args_json(json!({ "amount": null, "receiver_id": guest.id(), "to_intents": false }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(escrow_balance(&events, guest.id()).await?, 0);
    assert_eq!(token_balance(&usdc, guest.id()).await?, guest_tokens_before + 20 * USDC);

    // A second event: the host cancels before the start, deposits and bond come back.
    let now = worker.view_block().await?.timestamp() / 1_000_000;
    let cancel_id: u64 = create(&host, "Cancel me", now + 50_000, now + 60_000, 4).await?.json()?;
    transfer_call(&host, usdc.id(), events.id(), 80 * USDC, json!({ "action": "host_bond", "event_id": cancel_id })).await?.into_result()?;
    transfer_call(&noshow, usdc.id(), events.id(), deposit, json!({ "action": "register", "event_id": cancel_id }))
        .await?
        .into_result()?;
    host.call(events.id(), "cancel")
        .args_json(json!({ "event_id": cancel_id }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(escrow_balance(&events, noshow.id()).await?, deposit);
    assert_eq!(escrow_balance(&events, host.id()).await?, 280 * USDC, "both bonds back (10 and 4 seats)");

    // A third event the host never closes: strangers cannot cancel it, but
    // after the publish deadline anyone opens the window on an empty list,
    // then settles: deposits back and the bond shared.
    // Hosted by `helper`: `host` has used its 2 free events for 30 days.
    let ends_soon = worker.view_block().await?.timestamp() / 1_000_000 + 30_000;
    let ended: u64 = create(&helper, "Ends soon", ends_soon - 10_000, ends_soon, 4).await?.json()?;
    lock_bond(&helper, &usdc, &events, ended).await?;
    transfer_call(&guest, usdc.id(), events.id(), deposit, json!({ "action": "register", "event_id": ended }))
        .await?
        .into_result()?;
    wait_until(&worker, ends_soon).await?;
    let too_soon = stranger
        .call(events.id(), "cancel")
        .args_json(json!({ "event_id": ended }))
        .deposit(yocto(1))
        .transact()
        .await?;
    expect_reject(&too_soon, "Only the host can cancel");
    let refund = |caller: &Account| caller.call(events.id(), "refund").args_json(json!({ "event_id": ended })).gas(Gas::from_tgas(100)).transact();
    expect_reject(&refund(&stranger).await?, "can still publish");
    wait_until(&worker, ends_soon + SUBMIT_MS).await?;
    refund(&stranger).await?.into_result()?;
    // An empty list is published in the host's place; guests who came could still dispute it.
    let view = event_view(&events, ended).await?;
    assert_eq!((view["status"].as_str(), view["abandoned"].as_bool()), (Some("Submitted"), Some(true)));
    wait_until(&worker, view["challenge_ends_at"].as_u64().unwrap()).await?;
    call_settle(&stranger, &events, ended).await?.into_result()?;
    assert_eq!(event_view(&events, ended).await?["status"], "Finalized");
    // The deposit plus half of the 80 USDC bond (4 seats × 2; no winner, so uncapped); the other half to the treasury (the owner).
    assert_eq!(escrow_balance(&events, guest.id()).await?, deposit + 40 * USDC);
    assert_eq!(escrow_balance(&events, owner.id()).await?, 40 * USDC);
    assert_eq!(escrow_balance(&events, helper.id()).await?, 0);

    // Every unit the escrow holds is on someone's balance.
    let mut owed = 0;
    for account in [guest.id(), noshow.id(), host.id(), helper.id(), owner.id()] {
        owed += escrow_balance(&events, account).await?;
    }
    assert_eq!(token_balance(&usdc, events.id()).await?, owed);

    measure_full_event_gas(&worker, &usdc, &events, &host).await?;
    Ok(())
}

/// 300 guests, every record disputed (all disputes expire, so every
/// challenger is paid back): the heaviest `settle`. Also the heaviest `cancel`.
async fn measure_full_event_gas(
    worker: &Worker<Sandbox>,
    usdc: &Contract,
    events: &Contract,
    host: &Account,
) -> anyhow::Result<()> {
    let mut guests = Vec::new();
    // MAX_CAPACITY in the escrow.
    for _ in 0..300 {
        guests.push(worker.dev_create_account().await?);
    }
    for batch in guests.chunks(16) {
        let mut tasks = tokio::task::JoinSet::new();
        for guest in batch.iter().cloned() {
            let usdc = usdc.clone();
            tasks.spawn(async move { mint(&usdc, &guest, guest.id(), 4 * USDC).await });
        }
        while let Some(result) = tasks.join_next().await {
            result??;
        }
    }

    // "final": no court, so `finalize` publishes and pays out 300 guests in one call (audit 2, L-3).
    for operation in ["settle", "cancel", "final"] {
        let target = if operation == "settle" {
            events.clone()
        } else if operation == "cancel" {
            let (contract, _, _) = new_escrow(worker, usdc, host).await?;
            contract
        } else {
            let contract = worker.dev_deploy(wasm("near-events")).await?;
            contract.call("new")
                .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": host.id() }))
                .transact().await?.into_result()?;
            storage_deposit(usdc, host, contract.id()).await?;
            contract
        };
        // Long enough for 300 registrations before the start (registration closes there); the cancel run cancels before it.
        let start = now_ms(worker).await?;
        let end = start + 1_200_000;
        let create = json!({
            "metadata": {
                "title": "Full event gas check",
                "starts_at": end - 1_000, "ends_at": end
            },
            "deposit": "1000000", "capacity": guests.len()
        });
        // Beyond the free tier: the host pays for storage, the excess comes back.
        let cost: String = target.view("create_event_cost")
            .args_json(json!({ "host": host.id(), "capacity": guests.len() }))
            .await?.json()?;
        let cost: u128 = cost.parse()?;
        assert!(cost > 0, "300 seats must not be free");
        let unpaid = host.call(target.id(), "create_event").args_json(create.clone()).transact().await?;
        expect_reject(&unpaid, "beyond the free tier");
        let before = host.view_account().await?.balance.as_yoctonear();
        let created = host.call(target.id(), "create_event")
            .args_json(create)
            .deposit(NearToken::from_yoctonear(cost + NearToken::from_near(1).as_yoctonear()))
            .gas(Gas::from_tgas(50))
            .transact().await?.into_result()?;
        let spent = before - host.view_account().await?.balance.as_yoctonear();
        let fees = created.total_gas_burnt.as_gas() as u128 * 1_000_000_000 * 10;
        assert!(spent <= cost + fees, "the excess deposit was not returned: spent {spent}, cost {cost}");
        eprintln!("300-seat create_event cost {cost} yoctoNEAR");
        let event_id: u64 = created.json()?;
        if operation != "final" {
            lock_bond(host, usdc, &target, event_id).await?;
        }
        let host_before = escrow_balance(&target, host.id()).await?;
        let register = vec![json!({ "action": "register", "event_id": event_id }); guests.len()];
        pay_each(usdc.id(), target.id(), &guests, register).await?;

        let last = guests.last().unwrap().id();
        if operation == "settle" {
            wait_until(worker, end).await?;
            let accounts: Vec<_> = guests.iter().map(|guest| guest.id()).collect();
            let published = finalize(host, &target, event_id, json!(accounts)).await?.into_result()?;
            eprintln!("300-guest finalize (publish) used {} gas", published.total_gas_burnt.as_gas());
            // Every guest says the next one did not come.
            let claims = (0..guests.len()).map(|i| dispute(event_id, guests[(i + 1) % guests.len()].id(), false)).collect();
            pay_each(usdc.id(), target.id(), &guests, claims).await?;
            let event = event_view(&target, event_id).await?;
            assert_eq!(event["open_disputes"], 300);
            wait_until(worker, event["resolve_by"].as_u64().unwrap()).await?;
        }
        let result = if operation == "settle" {
            call_settle(host, &target, event_id).await?.into_result()?
        } else if operation == "final" {
            wait_until(worker, end).await?;
            let accounts: Vec<_> = guests.iter().map(|guest| guest.id()).collect();
            finalize(host, &target, event_id, json!(accounts)).await?.into_result()?
        } else {
            host.call(target.id(), "cancel")
                .args_json(json!({ "event_id": event_id }))
                .deposit(yocto(1)).gas(Gas::from_tgas(300))
                .transact().await?.into_result()?
        };
        let gas = result.total_gas_burnt.as_gas();
        eprintln!("300-guest {operation} used {gas} gas");
        // 25% headroom below the 300 Tgas a function call may use.
        assert!(gas < 240_000_000_000_000, "300-guest {operation} used {gas} gas");
        let expected = if operation == "settle" { 2 * USDC } else { USDC };
        assert_eq!(escrow_balance(&target, last).await?, expected);
        let bond = if operation == "final" { 0 } else { 600 * USDC };
        assert_eq!(escrow_balance(&target, host.id()).await? - host_before, bond, "the host gets the 300-seat bond back");
    }
    Ok(())
}

#[tokio::test]
async fn sandbox_ticket_cycle() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy_tla(wasm("test-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let events = worker.dev_deploy(wasm("near-events")).await?;
    // Ticket events need no dispute DAO.
    events
        .call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": "owner.test.near" }))
        .transact()
        .await?
        .into_result()?;

    let host = worker.dev_create_account().await?;
    let a = worker.dev_create_account().await?;
    let b = worker.dev_create_account().await?;
    storage_deposit(&usdc, &host, events.id()).await?;
    storage_deposit(&usdc, &host, host.id()).await?;
    let price = 20 * USDC;
    for g in [&a, &b] {
        mint(&usdc, g, g.id(), price).await?;
    }

    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let event_id: u64 = host
        .call(events.id(), "create_event")
        .args_json(json!({
            "metadata": { "title": "Paid workshop", "starts_at": now_ms - 60_000, "ends_at": now_ms + 120_000 },
            "deposit": price.to_string(),
            "capacity": 10,
            "mode": "Ticket"
        }))
        .transact()
        .await?
        .json()?;
    let view = event_view(&events, event_id).await?;
    assert_eq!(view["mode"], "Ticket");
    assert_eq!(view["deposit"], price.to_string());
    assert_eq!(view["dao"], Value::Null);

    for (i, g) in [&a, &b].into_iter().enumerate() {
        transfer_call(g, usdc.id(), events.id(), price, json!({ "action": "register", "event_id": event_id }))
            .await?
            .into_result()?;
        assert_eq!(token_balance(&usdc, g.id()).await?, 0);
        // The host is paid at registration.
        assert_eq!(escrow_balance(&events, host.id()).await?, (i as u128 + 1) * price);
    }

    // Finalize only closes the event at once; the host keeps exactly the two tickets.
    wait_until(&worker, now_ms + 120_000).await?;
    finalize(&host, &events, event_id, json!([])).await?.into_result()?;
    assert_eq!(event_view(&events, event_id).await?["status"], "Finalized");
    assert_eq!(escrow_balance(&events, host.id()).await?, 2 * price);
    assert_eq!(escrow_balance(&events, a.id()).await?, 0);

    host.call(events.id(), "withdraw")
        .args_json(json!({ "amount": null, "receiver_id": null, "to_intents": null }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(token_balance(&usdc, host.id()).await?, 2 * price);
    assert_eq!(token_balance(&usdc, events.id()).await?, 0);
    Ok(())
}

/// An event with an access rule: a guest who came to the host's last
/// (settled) event registers, a newcomer's USDC comes back through the real
/// token resolver.
#[tokio::test]
async fn sandbox_access_rule() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy_tla(wasm("test-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let host = worker.dev_create_account().await?;
    let (events, _, _) = new_escrow(&worker, &usdc, &host).await?;
    let regular = worker.dev_create_account().await?;
    let newcomer = worker.dev_create_account().await?;
    for guest in [&regular, &newcomer] {
        mint(&usdc, guest, guest.id(), 20 * USDC).await?;
    }
    let create = |title: &str, ends_at: u64, access: Value| {
        host.call(events.id(), "create_event")
            .args_json(json!({
                "metadata": { "title": title, "starts_at": ends_at - 1_000, "ends_at": ends_at },
                "deposit": "10000000", "capacity": 10, "access": access
            }))
            .transact()
    };
    let register = |event_id: u64| json!({ "action": "register", "event_id": event_id });

    let now = now_ms(&worker).await?;
    create("Last meetup", now + 20_000, Value::Null).await?.into_result()?;
    lock_bond(&host, &usdc, &events, 0).await?;
    transfer_call(&regular, usdc.id(), events.id(), 10 * USDC, register(0)).await?.into_result()?;
    wait_until(&worker, now + 20_000).await?;
    finalize(&host, &events, 0, json!([regular.id()])).await?.into_result()?;
    // A rule may only point at finalized (settled) events.
    let now = now_ms(&worker).await?;
    expect_reject(&create("Too soon", now + 600_000, json!({ "past_events": [0], "min_attended": 1 })).await?, "must be finalized");
    wait_until(&worker, event_view(&events, 0).await?["challenge_ends_at"].as_u64().unwrap()).await?;
    call_settle(&regular, &events, 0).await?.into_result()?;

    let now = now_ms(&worker).await?;
    create("Regulars first", now + 600_000, json!({ "past_events": [0], "min_attended": 1 })).await?.into_result()?;
    lock_bond(&host, &usdc, &events, 1).await?;
    transfer_call(&regular, usdc.id(), events.id(), 10 * USDC, register(1)).await?.into_result()?;
    let before = token_balance(&usdc, newcomer.id()).await?;
    transfer_call(&newcomer, usdc.id(), events.id(), 10 * USDC, register(1)).await?.into_result()?;
    assert_eq!(token_balance(&usdc, newcomer.id()).await?, before, "the newcomer's USDC came back");

    let status = |account: &Account| {
        events.view("get_guest_status").args_json(json!({ "event_id": 1, "account_id": account.id() }))
    };
    assert_eq!(status(&regular).await?.json::<Value>()?, json!("Registered"));
    assert_eq!(status(&newcomer).await?.json::<Value>()?, Value::Null);
    let check: Value = events.view("check_access")
        .args_json(json!({ "event_id": 1, "account_id": newcomer.id() }))
        .await?.json()?;
    assert_eq!(check, json!({ "allowed": false, "attended": 0, "no_shows": 0 }));
    assert_eq!(event_view(&events, 1).await?["access"]["past_events"], json!([0]));
    Ok(())
}

/// The owner upgrades the code through the contract itself, with no access
/// key left on the escrow account; v3 state with events survives; a broken
/// upgrade changes nothing; after `freeze` nobody can upgrade. A v2 escrow
/// (the mainnet code) refuses v3 and keeps its own code.
#[tokio::test]
async fn sandbox_upgrade_and_freeze() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let events_wasm = wasm("near-events");
    let usdc = worker.dev_deploy_tla(wasm("test-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let host = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;
    let events = worker.dev_deploy(events_wasm).await?;
    events.call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": owner.id() }))
        .transact().await?.into_result()?;
    configure(&owner, &events, stranger.id()).await?;
    // Lock the account: no key can deploy code any more.
    events.as_account().batch(events.id())
        .delete_key(events.as_account().secret_key().public_key())
        .transact().await?.into_result()?;

    owner.call(events.id(), "add_to_whitelist")
        .args_json(json!({ "accounts": [host.id()] }))
        .deposit(yocto(1))
        .transact().await?.into_result()?;
    let now = now_ms(&worker).await?;
    host.call(events.id(), "create_event")
        .args_json(json!({
            "metadata": { "title": "Before upgrade", "starts_at": now, "ends_at": now + 60_000 },
            "deposit": "1000000", "capacity": 10
        }))
        .transact().await?.into_result()?;

    let upgrade = |caller: &Account, target: &AccountId, code: Vec<u8>| {
        caller.call(target, "upgrade").args(code).deposit(yocto(1)).gas(Gas::from_tgas(300)).transact()
    };
    expect_reject(&upgrade(&stranger, events.id(), events_wasm.to_vec()).await?, "Only the owner");
    upgrade(&owner, events.id(), events_wasm.to_vec()).await?.into_result()?;
    let kept: bool = events.view("is_whitelisted").args_json(json!({ "account_id": host.id() })).await?.json()?;
    assert!(kept, "state did not survive the upgrade");
    assert_eq!(event_view(&events, 0).await?["metadata"]["title"], "Before upgrade", "the event did not survive");
    let config: Value = events.view("get_config").await?.json()?;
    assert_eq!(config["rules"]["dao"], stranger.id().as_str());
    assert_eq!(config["oracle_hour_ms"], HOUR_MS);

    // Not a contract: the batch fails and the old code keeps working.
    let broken = upgrade(&owner, events.id(), b"not a wasm module".to_vec()).await?;
    assert!(broken.is_failure(), "a broken upgrade went through");
    let config: Value = events.view("get_config").await?.json()?;
    assert_eq!(config["owner"], owner.id().as_str());

    owner.call(events.id(), "freeze").deposit(yocto(1)).transact().await?.into_result()?;
    let config: Value = events.view("get_config").await?.json()?;
    assert_eq!(config["frozen"], true);
    expect_reject(&upgrade(&owner, events.id(), events_wasm.to_vec()).await?, "The code is frozen");

    // The mainnet escrow (v2 code, no events) upgrades in place: one receipt
    // deploys v3 and runs migrate. With an event the old records would not
    // decode, so migrate panics and the deploy is rolled back.
    if let Some(v2) = fixture("V2_ESCROW_WASM") {
        let deploy_v2 = || async {
            let old = worker.dev_deploy(&v2).await?;
            old.call("new")
                .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null, "owner": owner.id() }))
                .transact().await?.into_result()?;
            anyhow::Ok(old)
        };
        let busy = deploy_v2().await?;
        let now = now_ms(&worker).await?;
        busy.as_account().call(busy.id(), "create_event")
            .args_json(json!({ "metadata": { "title": "Old event", "starts_at": now + 60_000, "ends_at": now + 120_000 }, "deposit": "1000000", "capacity": 10 }))
            .transact().await?.into_result()?;
        expect_reject(&upgrade(&owner, busy.id(), events_wasm.to_vec()).await?, "Events exist");
        let count: u32 = busy.view("get_attended_count").args_json(json!({ "account_id": host.id() })).await?.json()?;
        assert_eq!(count, 0, "the v2 code is still there");

        let empty = deploy_v2().await?;
        upgrade(&owner, empty.id(), events_wasm.to_vec()).await?.into_result()?;
        let config: Value = empty.view("get_config").await?.json()?;
        assert_eq!(config["owner"], owner.id().as_str());
        assert_eq!(config["rules"]["dao"], Value::Null, "no court until the owner names one");
        assert_eq!(config["rules"]["bond_per_seat"], 0);
        configure(&owner, &empty, stranger.id()).await?;
        let config: Value = empty.view("get_config").await?.json()?;
        assert_eq!(config["rules"]["bond_per_seat"], 2);
    } else {
        eprintln!("V2_ESCROW_WASM not set: skipped the v2 -> v3 in-place upgrade");
    }
    Ok(())
}

/// The whole dispute path with a real Sputnik DAO (v2.3.1) using the proposed
/// policy (`docs/oracle-upgrade/evidence/dao-policy-v3.json`): the bot opens a
/// pair of proposals per dispute, three council votes make the DAO call
/// `resolve_dispute`, the opposite proposal then fails, an undecided dispute
/// expires, and `settle` pays exactly what came in.
#[tokio::test]
async fn sandbox_sputnik_dispute_cycle() -> anyhow::Result<()> {
    let Some(dao_wasm) = fixture("SPUTNIK_WASM") else {
        eprintln!("SPUTNIK_WASM not set: skipped");
        return Ok(());
    };
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy_tla(wasm("test-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let host = worker.dev_create_account().await?;
    let (events, owner, _) = new_escrow(&worker, &usdc, &host).await?;

    let mut council = Vec::new();
    for _ in 0..5 {
        council.push(worker.dev_create_account().await?);
    }
    let bot = worker.dev_create_account().await?;
    let dao = worker.dev_deploy(&dao_wasm).await?;
    let policy_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/oracle-upgrade/evidence/dao-policy-v3.json");
    let mut policy: Value = serde_json::from_str(&std::fs::read_to_string(policy_path)?)?;
    policy["roles"][0]["kind"]["Group"] = json!(council.iter().map(|c| c.id()).collect::<Vec<_>>());
    policy["roles"][1]["kind"]["Group"] = json!([bot.id()]);
    dao.call("new")
        .args_json(json!({ "config": { "name": "nearvent-court", "purpose": "Nearvent attendance disputes", "metadata": "" }, "policy": policy }))
        .gas(Gas::from_tgas(100))
        .transact().await?.into_result()?;
    let version: String = dao.view("version").await?.json()?;
    eprintln!("Sputnik DAO version {version}");
    configure(&owner, &events, dao.id()).await?;

    let mut guests = Vec::new();
    for _ in 0..4 {
        let g = worker.dev_create_account().await?;
        mint(&usdc, &g, g.id(), 30 * USDC).await?;
        guests.push(g);
    }
    let (ga, gb, gc, gd) = (&guests[0], &guests[1], &guests[2], &guests[3]);
    let start = now_ms(&worker).await?;
    let id: u64 = host.call(events.id(), "create_event")
        .args_json(json!({
            "metadata": { "title": "Court test", "starts_at": start + 30_000, "ends_at": start + 60_000 },
            "deposit": "10000000", "capacity": 10
        }))
        .transact().await?.json()?;
    assert_eq!(event_view(&events, id).await?["dao"], dao.id().as_str());
    lock_bond(&host, &usdc, &events, id).await?;
    for g in &guests {
        transfer_call(g, usdc.id(), events.id(), 10 * USDC, json!({ "action": "register", "event_id": id })).await?.into_result()?;
    }
    wait_until(&worker, start + 60_000).await?;
    // All four came; the host left C off the list.
    finalize(&host, &events, id, json!([ga.id(), gb.id(), gd.id()])).await?.into_result()?;
    // C: "I came" (will be upheld). A: "B did not come" (dismissed). C: "D did not come" (left undecided).
    for (challenger, target, attended) in [(gc, gc, true), (ga, gb, false), (gc, gd, false)] {
        transfer_call(challenger, usdc.id(), events.id(), 10 * USDC, dispute(id, target.id(), attended)).await?.into_result()?;
    }
    let disputes: Vec<Value> = events.view("get_disputes").args_json(json!({ "event_id": id })).await?.json()?;
    assert_eq!(disputes.len(), 3);

    // The bot: one Uphold / Dismiss pair per dispute (proposal ids 0..6).
    let mut ids = std::collections::HashMap::new();
    for (target, upheld) in [(gc, true), (gc, false), (gb, true), (gb, false), (gd, true), (gd, false)] {
        let args = json!({ "event_id": id, "target": target.id(), "upheld": upheld }).to_string();
        let label = if upheld { "uphold" } else { "dismiss" };
        let proposal = json!({ "proposal": {
            "description": format!("nearvent:dispute:{}:{id}:{}:{label}", events.id(), target.id()),
            "kind": { "FunctionCall": { "receiver_id": events.id(), "actions": [{
                "method_name": "resolve_dispute",
                "args": base64(args.as_bytes()),
                "deposit": "0", "gas": "30000000000000"
            }]}}
        }});
        let pid: u64 = bot.call(dao.id(), "add_proposal").args_json(proposal).gas(Gas::from_tgas(100)).transact().await?.json()?;
        ids.insert((target.id().clone(), upheld), pid);
    }
    let pid = |target: &Account, upheld: bool| ids[&(target.id().clone(), upheld)];
    // The bot may only propose.
    expect_reject(&act(&dao, &bot, pid(gc, true), "VoteApprove").await?, "ERR_PERMISSION_DENIED");
    // Nobody but the DAO resolves.
    let forged = council[0].call(events.id(), "resolve_dispute")
        .args_json(json!({ "event_id": id, "target": gc.id(), "upheld": true }))
        .transact().await?;
    expect_reject(&forged, "Only this event's DAO");

    // C was right: three approvals and the DAO itself calls the escrow.
    let third = vote3(&dao, &council, pid(gc, true), "VoteApprove").await?;
    eprintln!("third council vote (executes resolve_dispute) burnt {} gas", third.total_gas_burnt.as_gas());
    third.into_result()?;
    assert_eq!(proposal_status(&dao, pid(gc, true)).await?, "Approved");
    let disputes: Vec<Value> = events.view("get_disputes").args_json(json!({ "event_id": id })).await?.json()?;
    assert_eq!(disputes.iter().find(|x| x["target"] == gc.id().as_str()).unwrap()["upheld"], true);
    // The opposite verdict, approved by mistake, is refused by the escrow: the proposal fails.
    let _ = vote3(&dao, &council, pid(gc, false), "VoteApprove").await?;
    assert_eq!(proposal_status(&dao, pid(gc, false)).await?, "Failed");
    // B's record: three rejections of "uphold", three approvals of "dismiss".
    vote3(&dao, &council, pid(gb, true), "VoteReject").await?.into_result()?;
    assert_eq!(proposal_status(&dao, pid(gb, true)).await?, "Rejected");
    vote3(&dao, &council, pid(gb, false), "VoteApprove").await?.into_result()?;
    let event = event_view(&events, id).await?;
    assert_eq!((event["open_disputes"].as_u64(), event["upheld_disputes"].as_u64(), event["dismissed_disputes"].as_u64()), (Some(1), Some(1), Some(1)));

    // D's dispute stays open: settle waits until it expires.
    wait_until(&worker, event["challenge_ends_at"].as_u64().unwrap()).await?;
    expect_reject(&call_settle(&host, &events, id).await?, "waiting for the DAO");
    wait_until(&worker, event["resolve_by"].as_u64().unwrap()).await?;
    // A verdict after the deadline: the escrow refuses, the proposal fails.
    let _ = vote3(&dao, &council, pid(gd, true), "VoteApprove").await?;
    assert_eq!(proposal_status(&dao, pid(gd, true)).await?, "Failed");
    call_settle(&host, &events, id).await?.into_result()?;

    // N = 4, D = 10, H = 200 (10 seats × 2). Final list A, B, C, D: 10 each from the pool.
    // H: C's prize is capped at 5 deposits (50), 150 to the treasury (owner). A's lost bond: 5 treasury, 1.25 to each attendee.
    // C: both bonds back (one upheld, one expired).
    let want = [(ga, 11_250_000u128), (gb, 11_250_000), (gc, 81_250_000), (gd, 11_250_000)];
    for (g, amount) in want {
        assert_eq!(escrow_balance(&events, g.id()).await?, amount, "guest {}", g.id());
    }
    assert_eq!(escrow_balance(&events, host.id()).await?, 0);
    assert_eq!(escrow_balance(&events, owner.id()).await?, 155 * USDC);
    assert_eq!(token_balance(&usdc, events.id()).await?, 270 * USDC);
    let status: Value = events.view("get_guest_status").args_json(json!({ "event_id": id, "account_id": gc.id() })).await?.json()?;
    assert_eq!(status, "Attended");
    // A late verdict on a closed event fails too.
    let _ = vote3(&dao, &council, pid(gd, false), "VoteApprove").await?;
    assert_eq!(proposal_status(&dao, pid(gd, false)).await?, "Failed");
    Ok(())
}
