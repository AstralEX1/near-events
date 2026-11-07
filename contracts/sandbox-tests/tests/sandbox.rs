//! Real NEAR runtime tests. Unit tests never move a token or run a callback;
//! these do. Testnet-only contracts, local sandbox, no mainnet.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use anyhow::Context;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

fn wasm(package: &str) -> &'static [u8] {
    static EVENTS: OnceLock<Vec<u8>> = OnceLock::new();
    static USDC: OnceLock<Vec<u8>> = OnceLock::new();
    let slot = if package == "near-events" { &EVENTS } else { &USDC };
    slot.get_or_init(|| build_wasm(package))
}

fn build_wasm(package: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let status = Command::new("cargo")
        .args(["build", "--locked", "-p", package, "--release", "--target", "wasm32-unknown-unknown"])
        .current_dir(&root)
        .status()
        .expect("cargo build");
    assert!(status.success(), "wasm build failed for {package}");
    let file = package.replace('-', "_");
    std::fs::read(root.join(format!("target/wasm32-unknown-unknown/release/{file}.wasm")))
        .expect("wasm output")
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

fn panic_text(result: &near_workspaces::result::ExecutionFinalResult) -> String {
    format!("{result:?}")
}

/// A contract built without `--cfg near` turns `require!` into a bare
/// unreachable trap. `contracts/.cargo/config.toml` sets that cfg. Unit tests
/// lock the text; here either form counts as the expected refusal.
fn expect_reject(result: &near_workspaces::result::ExecutionFinalResult, needle: &str) {
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
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
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
    // An implicit account cannot be created with CreateAccount; the unit test
    // covers that init refusal. Sandbox subaccounts are `*.test.near`.

    let usdc = worker.dev_deploy_tla(usdc_wasm).await?;
    usdc.call("new").transact().await?.into_result()?;
    let too_much = usdc
        .call("mint")
        .args_json(json!({ "amount": (1_000 * 1_000_000 + 1).to_string(), "account_id": null }))
        .transact()
        .await?;
    expect_reject(&too_much, "Max 1000");

    let events = worker.dev_deploy(events_wasm).await?;
    let untrusted = worker.dev_create_account().await?;
    let rejected = untrusted.call(events.id(), "new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null }))
        .transact().await?;
    assert!(rejected.is_failure(), "a third party initialized the escrow");
    events
        .call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null }))
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
    let minted = 50 * 1_000_000;
    for account in [guest.id(), noshow.id(), friend.id(), sponsor.id()] {
        mint(&usdc, &guest, account, minted).await?;
    }

    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let event_id: u64 = host
        .call(events.id(), "create_event")
        .args_json(json!({
            "metadata": {
                "title": "QA meetup",
                "starts_at": now_ms + 3_600_000,
                "ends_at": now_ms + 7_200_000
            },
            "deposit": "10000000",
            "capacity": 10
        }))
        .transact()
        .await?
        .json()?;

    let stranger_finalize = stranger
        .call(events.id(), "finalize")
        .args_json(json!({ "event_id": event_id, "attended": [] }))
        .deposit(yocto(1))
        .transact()
        .await?;
    expect_reject(&stranger_finalize, "Only the host");

    let helper_finalize = helper
        .call(events.id(), "finalize")
        .args_json(json!({ "event_id": event_id, "attended": [] }))
        .deposit(yocto(1))
        .transact()
        .await?;
    expect_reject(&helper_finalize, "Only the host");

    // Exact self payment, then a second one. The second must come back.
    let deposit = 10 * 1_000_000;
    let first = transfer_call(
        &guest,
        usdc.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": event_id }),
    )
    .await?;
    first.into_result()?;
    assert_eq!(token_balance(&usdc, guest.id()).await?, minted - deposit);

    let second = transfer_call(
        &guest,
        usdc.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": event_id }),
    )
    .await?;
    second.into_result()?;
    assert_eq!(token_balance(&usdc, guest.id()).await?, minted - deposit, "double RSVP must refund");

    transfer_call(
        &noshow,
        usdc.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": event_id }),
    )
    .await?
    .into_result()?;

    // A short third-party payment returns to the friend without opening a balance.
    let late: AccountId = "late.testnet".parse().unwrap();
    let short = 4 * 1_000_000;
    let friend_before = token_balance(&usdc, friend.id()).await?;
    transfer_call(
        &friend,
        usdc.id(),
        events.id(),
        short,
        json!({ "action": "register", "event_id": event_id, "guest": late }),
    )
    .await?
    .into_result()?;
    assert_eq!(token_balance(&usdc, friend.id()).await?, friend_before);
    assert_eq!(escrow_balance(&events, &late).await?, 0);
    let late_status: Option<String> = events
        .view("get_guest_status")
        .args_json(json!({ "event_id": event_id, "account_id": late }))
        .await?
        .json()?;
    assert!(late_status.is_none(), "a short payment must not take a seat");

    // Some other NEP-141. The escrow panics, and that token refunds the sender.
    let other = worker.dev_deploy_tla(usdc_wasm).await?;
    other.call("new").transact().await?.into_result()?;
    mint(&other, &friend, friend.id(), minted).await?;
    storage_deposit(&other, &host, events.id()).await?;
    let other_before = token_balance(&other, friend.id()).await?;
    transfer_call(
        &friend,
        other.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": event_id }),
    )
    .await?
    .into_result()?;
    assert_eq!(token_balance(&other, friend.id()).await?, other_before, "wrong token must be refunded");

    // The old "sponsor" action is gone: the token sends the whole amount back.
    let sponsor_before = token_balance(&usdc, sponsor.id()).await?;
    let _ = transfer_call(
        &sponsor,
        usdc.id(),
        events.id(),
        5 * 1_000_000,
        json!({ "action": "sponsor", "event_id": event_id }),
    )
    .await?;
    assert_eq!(token_balance(&usdc, sponsor.id()).await?, sponsor_before, "unknown action must be refunded");

    // Check-in happened off-chain; the host closes with the list of who came.
    host.call(events.id(), "finalize")
        .args_json(json!({ "event_id": event_id, "attended": [guest.id()] }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?
        .into_result()?;

    let again = host
        .call(events.id(), "finalize")
        .args_json(json!({ "event_id": event_id, "attended": [] }))
        .deposit(yocto(1))
        .transact()
        .await?;
    expect_reject(&again, "Event is closed");

    // 2 deposits, one attendee.
    assert_eq!(escrow_balance(&events, guest.id()).await?, 20 * 1_000_000);
    assert_eq!(escrow_balance(&events, noshow.id()).await?, 0);

    let event: Value = events.view("get_event").args_json(json!({ "event_id": event_id })).await?.json()?;
    assert_eq!(event["status"], "Finalized");
    assert_eq!(event["payout_per_attendee"], "20000000");

    // Sending the payout to an account the token does not know fails.
    // The callback has to put the balance back.
    guest
        .call(events.id(), "withdraw")
        .args_json(json!({
            "amount": null,
            "receiver_id": fresh.id(),
            "to_intents": false
        }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(escrow_balance(&events, guest.id()).await?, 20 * 1_000_000, "failed transfer must restore the balance");

    let forged = guest
        .call(events.id(), "on_withdraw")
        .args_json(json!({
            "owner": guest.id(),
            "amount": "1",
            "to_intents": false
        }))
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
    assert_eq!(token_balance(&usdc, guest.id()).await?, guest_tokens_before + 20 * 1_000_000);

    // A second event: cancel returns the deposit.
    let cancel_id: u64 = host
        .call(events.id(), "create_event")
        .args_json(json!({
            "metadata": {
                "title": "Cancel me",
                "starts_at": now_ms,
                "ends_at": now_ms + 60_000
            },
            "deposit": "10000000",
            "capacity": 4
        }))
        .transact()
        .await?
        .json()?;
    transfer_call(
        &noshow,
        usdc.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": cancel_id }),
    )
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

    // Past the end, a stranger still cannot cancel: only after 30 more days.
    let ended: u64 = host
        .call(events.id(), "create_event")
        .args_json(json!({
            "metadata": {
                "title": "Ends soon",
                "starts_at": now_ms,
                "ends_at": now_ms + 1_000
            },
            "deposit": "10000000",
            "capacity": 4
        }))
        .transact()
        .await?
        .json()?;
    transfer_call(
        &guest,
        usdc.id(),
        events.id(),
        deposit,
        json!({ "action": "register", "event_id": ended }),
    )
    .await?
    .into_result()?;
    worker.fast_forward(400).await?;
    let later = worker.view_block().await?.timestamp() / 1_000_000;
    assert!(later > now_ms + 1_000, "clock did not pass the event end: {later} vs {now_ms}");
    let too_soon = stranger
        .call(events.id(), "cancel")
        .args_json(json!({ "event_id": ended }))
        .deposit(yocto(1))
        .transact()
        .await?;
    expect_reject(&too_soon, "Only the host can cancel");

    // Direct callback forgery was already checked. Gas for a wider event is
    // measured below so a full room cannot brick finalize.
    measure_full_event_gas(&worker, &usdc, &events, &host, events_wasm).await?;

    Ok(())
}

async fn measure_full_event_gas(
    worker: &Worker<Sandbox>,
    usdc: &Contract,
    events: &Contract,
    host: &Account,
    escrow_wasm: &[u8],
) -> anyhow::Result<()> {
    let mut guests = Vec::new();
    for _ in 0..300 {
        guests.push(worker.dev_create_account().await?);
    }
    for batch in guests.chunks(16) {
        let mut tasks = tokio::task::JoinSet::new();
        for guest in batch.iter().cloned() {
            let usdc = usdc.clone();
            tasks.spawn(async move { mint(&usdc, &guest, guest.id(), 3_000_000).await });
        }
        while let Some(result) = tasks.join_next().await {
            result??;
        }
    }

    // "abandoned" is `cancel` by a stranger, 30+ days after the event ended.
    let stranger = worker.dev_create_account().await?;
    for operation in ["finalize", "cancel", "abandoned"] {
        // Each settlement starts without balance entries for these guests.
        let target = if operation == "finalize" {
            events.clone()
        } else {
            let contract = worker.dev_deploy(escrow_wasm).await?;
            contract.call("new")
                .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null }))
                .transact().await?.into_result()?;
            storage_deposit(usdc, host, contract.id()).await?;
            contract
        };
        let now = worker.view_block().await?.timestamp() / 1_000_000;
        let start = if operation == "abandoned" {
            now - 31 * 24 * 60 * 60 * 1000
        } else {
            now
        };
        let event_id: u64 = host.call(target.id(), "create_event")
            .args_json(json!({
                "metadata": {
                    "title": "Full event gas check",
                    "starts_at": start, "ends_at": start + 60_000
                },
                "deposit": "1000000", "capacity": guests.len()
            }))
            .transact().await?.json()?;
        for batch in guests.chunks(16) {
            let mut tasks = tokio::task::JoinSet::new();
            for guest in batch.iter().cloned() {
                let usdc = usdc.id().clone();
                let receiver = target.id().clone();
                tasks.spawn(async move {
                    let used: String = transfer_call(
                        &guest, &usdc, &receiver, 1_000_000,
                        json!({ "action": "register", "event_id": event_id }),
                    ).await?.json()?;
                    anyhow::ensure!(used == "1000000", "registration payment was not accepted");
                    Ok::<(), anyhow::Error>(())
                });
            }
            while let Some(result) = tasks.join_next().await {
                result??;
            }
        }

        let args = if operation == "finalize" {
            let accounts: Vec<_> = guests.iter().map(|guest| guest.id()).collect();
            json!({ "event_id": event_id, "attended": accounts })
        } else {
            json!({ "event_id": event_id })
        };
        let (caller, method) = if operation == "abandoned" { (&stranger, "cancel") } else { (host, operation) };
        let result = caller.call(target.id(), method)
            .args_json(args)
            .deposit(yocto(1)).gas(Gas::from_tgas(300))
            .transact().await?.into_result()?;
        let gas = result.total_gas_burnt.as_gas();
        eprintln!("300-guest {operation} used {gas} gas");
        assert!(gas < 250_000_000_000_000, "300-guest {operation} used {gas} gas");
        assert_eq!(escrow_balance(&target, guests.last().unwrap().id()).await?, 1_000_000);
    }
    Ok(())
}

#[tokio::test]
async fn sandbox_ticket_cycle() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy_tla(wasm("test-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let events = worker.dev_deploy(wasm("near-events")).await?;
    events
        .call("new")
        .args_json(json!({ "usdc": usdc.id(), "intents": null, "relayer": null }))
        .transact()
        .await?
        .into_result()?;

    let host = worker.dev_create_account().await?;
    let a = worker.dev_create_account().await?;
    let b = worker.dev_create_account().await?;
    storage_deposit(&usdc, &host, events.id()).await?;
    storage_deposit(&usdc, &host, host.id()).await?;
    let price = 20 * 1_000_000;
    for g in [&a, &b] {
        mint(&usdc, g, g.id(), price).await?;
    }

    // Started a minute ago, so the host may close it right away.
    let now_ms = worker.view_block().await?.timestamp() / 1_000_000;
    let event_id: u64 = host
        .call(events.id(), "create_event")
        .args_json(json!({
            "metadata": {
                "title": "Paid workshop",
                "starts_at": now_ms - 60_000,
                "ends_at": now_ms + 3_600_000
            },
            "deposit": price.to_string(),
            "capacity": 10,
            "mode": "Ticket"
        }))
        .transact()
        .await?
        .json()?;
    let view: serde_json::Value = events.view("get_event").args_json(json!({ "event_id": event_id })).await?.json()?;
    assert_eq!(view["mode"], "Ticket");
    assert_eq!(view["deposit"], price.to_string());
    assert!(view.get("price").is_none() && view.get("cohosts").is_none());

    for g in [&a, &b] {
        transfer_call(g, usdc.id(), events.id(), price, json!({ "action": "register", "event_id": event_id }))
            .await?
            .into_result()?;
        assert_eq!(token_balance(&usdc, g.id()).await?, 0);
    }

    // Nobody checked in: in Ticket mode the host is still paid for both tickets.
    host.call(events.id(), "finalize")
        .args_json(json!({ "event_id": event_id, "attended": [] }))
        .deposit(yocto(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
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
