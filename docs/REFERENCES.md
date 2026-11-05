# REFERENCES — all links for Near Me

One place for every repo and doc we use. Add new links here with `(date, source)`.
Take contract addresses (USDC, intents.near) only from official docs,
never from memory. (2026-11-02, Claude)

## Reference projects (GitHub, sent by Alex)
- Kickback (original event deposit dApp): https://github.com/wearekickback
- Commit by ETH Belgrade: https://github.com/Commit-by-ETH-Belgrade
- ShowUp: https://github.com/Xavierhuang/ShowUp
- UI inspiration (style only, no copied assets): https://luma.com

## NEAR Hackathon
- Site: https://nearhackathon.com/
- Rules: https://nearhackathon.com/HACKATHON.md
- Track prompts and setup: https://github.com/nearai/near-hackathon-prompt-examples
  (tracks `12-social` = Social Money, `08-realworld` = Real-World Money, `00-setup`)
- NEAR agent skills: https://github.com/near/agent-skills · `npx skills add near/agent-skills` (includes `near-contract-audit`)
- Contract audit report: `docs/SECURITY-AUDIT.md` (2026-11-03, Cursor)

## NEAR docs
- Docs home: https://docs.near.org · source: https://github.com/near/docs
- Smart contracts (Rust, near-sdk): https://docs.near.org/smart-contracts/what-is
- near-sdk-rs: https://github.com/near/near-sdk-rs · API: https://docs.rs/near-sdk
- cargo-near (build/deploy): https://github.com/near/cargo-near
- Fungible token standard NEP-141: https://github.com/near/NEPs/blob/master/neps/nep-0141.md
- Multi token standard NEP-245: https://github.com/near/NEPs/blob/master/neps/nep-0245.md
- Events standard NEP-297: https://github.com/near/NEPs/blob/master/neps/nep-0297.md
- Meta-transactions (NEP-366): https://docs.near.org/protocol/transactions/meta-tx
- Gas keys: https://docs.near.org/protocol/accounts-contracts/gas-keys
- NEAR Auth (Google/email login): https://docs.near.org/web3-apps/tutorials/near-auth
- Universal Accounts: https://docs.near.org/protocol/tutorials/creating-universal-accounts
- near-api-js: https://github.com/near/near-api-js
- Testnet faucet / explorer: https://testnet.nearblocks.io · mainnet explorer: https://nearblocks.io

## NEAR Intents and 1Click
- Docs home: https://docs.near-intents.org · page index: https://docs.near-intents.org/llms.txt
- 1Click API: https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api.md
- 1Click quote request: https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote.md
- Fees: https://docs.near-intents.org/resources/fees.md
- React swap widget: https://docs.near-intents.org/integration/devkit/react-widget.md
- Verifier contract (intents.near): https://docs.near-intents.org/integration/verifier-contract/introduction.md
- Deposits: https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md
- Withdrawals (`ft_withdraw` with `msg` → `ft_transfer_call`): https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md
- Balances and token IDs: https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/balances.md
- Intent types: https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.md
- Signing intents: https://docs.near-intents.org/integration/verifier-contract/signing-intents.md
- Account abstraction: https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md
- Cross-pay use case: https://intents.near.org/use-cases/cross-pay
