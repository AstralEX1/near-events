//! Test USDC for NEAR testnet: a plain NEP-141 token with 6 decimals and an
//! open faucet, so anyone can run a full Near Events cycle for free.
//! Never deploy this to mainnet.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

/// Max 1,000 USDC per faucet call.
const FAUCET_LIMIT: u128 = 1_000 * 1_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        // L-02: open faucet must never land on mainnet. Named mainnet accounts
        // end in `.near`. Implicit accounts are 64 hex characters and have no
        // suffix, so the suffix check alone does not stop a mainnet deploy.
        let id = env::current_account_id();
        let name = id.as_str();
        let implicit = name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit());
        require!(
            !name.ends_with(".near") && !implicit,
            "test-usdc is testnet-only; do not deploy to mainnet"
        );
        Self { token: FungibleToken::new(b"t".to_vec()) }
    }

    /// Mints test USDC to the caller (or `account_id`). Registers the account
    /// for storage if the caller attaches the standard storage deposit.
    #[payable]
    pub fn mint(&mut self, amount: U128, account_id: Option<AccountId>) {
        require!(amount.0 > 0, "Mint amount must be positive");
        require!(amount.0 <= FAUCET_LIMIT, "Max 1000 USDC per call");
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        if !self.token.accounts.contains_key(&account) || !env::attached_deposit().is_zero() {
            self.token.storage_deposit(Some(account.clone()), Some(true));
        }
        self.token.internal_deposit(&account, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account,
            amount,
            memo: Some("faucet"),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (Near Events)".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::fungible_token::FungibleTokenCore;
    use near_contract_standards::fungible_token::metadata::FungibleTokenMetadataProvider;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(contract: &str) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(contract.parse().unwrap())
            .predecessor_account_id("alice.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_millinear(100))
            .build());
    }

    #[test]
    #[should_panic(expected = "testnet-only")]
    fn rejects_a_mainnet_account_name() {
        ctx("usdc.alice.near");
        let _ = Contract::new();
    }

    #[test]
    #[should_panic(expected = "testnet-only")]
    fn rejects_an_implicit_account() {
        ctx(&"ab".repeat(32));
        let _ = Contract::new();
    }

    #[test]
    #[should_panic(expected = "testnet-only")]
    fn rejects_a_sandbox_style_near_name() {
        ctx("usdc.test.near");
        let _ = Contract::new();
    }

    #[test]
    fn mints_on_a_testnet_name_and_caps_each_call() {
        ctx("usdc.demo.testnet");
        let mut token = Contract::new();
        assert_eq!(token.ft_metadata().decimals, 6);
        assert_eq!(token.ft_metadata().symbol, "USDC");
        token.mint(U128(1_000 * 1_000_000), None);
        let alice: AccountId = "alice.testnet".parse().unwrap();
        assert_eq!(token.ft_balance_of(alice.clone()).0, 1_000 * 1_000_000);
        assert_eq!(token.ft_total_supply().0, 1_000 * 1_000_000);
        let bob: AccountId = "bob.testnet".parse().unwrap();
        token.mint(U128(5 * 1_000_000), Some(bob.clone()));
        assert_eq!(token.ft_balance_of(bob).0, 5 * 1_000_000);
        assert_eq!(token.ft_total_supply().0, 1_005 * 1_000_000);
    }

    #[test]
    #[should_panic(expected = "Max 1000 USDC per call")]
    fn mint_rejects_more_than_one_thousand() {
        ctx("usdc.demo.testnet");
        let mut token = Contract::new();
        token.mint(U128(1_000 * 1_000_000 + 1), None);
    }
}
