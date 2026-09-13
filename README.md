# TrustEscrow web app

The buyer and seller web app and the arbitrator console for TrustEscrow, a peer-to-peer escrow on Stellar. A buyer deposits into a contract made for one trade. The seller proves delivery on-chain. The buyer proves receipt by handing over a delivery code or signing a confirmation. The seller is paid only when both sides have spoken, or when the arbitrator rules. No timer ever pays the seller.

**This app holds no authority over funds.** It is a convenience layer over the contracts ([trustedescrow-contract](../trustedescrow-contract)) and the off-chain services ([trustedescrow-backend](../trustedescrow-backend)). Every escrow can still be funded, completed, disputed or timed out from a CLI with neither of them running.

## What it does

| Area | Route | Notes |
|---|---|---|
| Sign-in | `/` | Freighter signs a SEP-53 message; the backend issues a session. New devices need 2FA if it's enabled. |
| Negotiation | `/orders/new`, `/orders/[id]` | Propose, counter and accept terms; chat. Each revision is immutable. |
| Create escrow | `/orders/[id]` (buyer, once agreed) | Verifies the terms, generates and seals the delivery code, checks the factory's WASM against the pinned hash, deploys, verifies, links. |
| Escrow | `/escrow/[contractId]` | Read live from contract storage. Offers exactly the calls the contract would accept for your role, now. Works without signing in. |
| Arbitration | `/arbitrator`, `/arbitrator/[contractId]` | Arbitrator accounts only. Case file, local terms-hash and content-hash checks, a seller-claimed code check that never leaves the device, and the ruling. |
| Account | `/settings`, `/notifications` | Payout address, email, TOTP 2FA and backup codes, sessions, devices, code-vault passkeys. |

## Trust anchors

Four values come from this build's environment and are never taken from the backend. A compromised backend must not be able to redirect the app:

- `NEXT_PUBLIC_FACTORY_CONTRACT_ID`: the factory that deploys escrows.
- `NEXT_PUBLIC_ESCROW_WASM_HASH`: the audited escrow binary. The app refuses to create through a factory configured with any other hash, and refuses to fund an escrow instance running anything else.
- `NEXT_PUBLIC_NETWORK_PASSPHRASE` and `NEXT_PUBLIC_SOROBAN_RPC_URL`.

The backend's `/meta` is informational only.

## Security properties the code keeps

- **The delivery code exists in plaintext only on the buyer's device.** It is generated from the platform CSPRNG (80 bits, 16 Crockford base32 characters), hashed locally for `Factory::create`, and sealed with AES-256-GCM before upload. The key comes from a passkey (WebAuthn PRF, then HKDF) or from a password (PBKDF2-SHA256, 600k iterations). The AEAD additional data binds each envelope to its draft and committed hash. The code is revealed only after a step-up, and only behind the "this code is the money" warning, once the buyer confirms they are holding the goods.
- **Code handling matches the contract byte for byte.** [`src/sdk/code.ts`](src/sdk/code.ts) passes the contract repo's shared vectors ([`test/fixtures/delivery-codes.json`](test/fixtures/delivery-codes.json)).
- **The terms hash is computed here.** The buyer hashes the canonical RFC 8785 bytes on-device and refuses bytes that are not canonical. After deployment, every committed field is compared against the agreed terms before linking or funding.
- **Simulation before signature.** Every contract call is simulated first. A call that would fail is explained without the user paying for it, and archived escrows get an explicit restore step.
- **Codes stay out of chat and evidence.** The client blocks a message containing the code by exact hash match, and warns on anything code-shaped. The backend refuses it again as a backstop.
- **2FA gates sessions, not the chain.** Step-up protects vault reads, payout changes and dispute statements. On-chain calls are authorised by the wallet signature alone, and the UI does not pretend otherwise.

## Getting started

Requires Node 22+ and the [Freighter](https://freighter.app) browser extension on the same network as the build.

```sh
npm install
cp .env.example .env.local   # set the factory id and escrow WASM hash from deployments/testnet.env
npm run dev                  # http://localhost:3001
```

Run the backend on :3000 with `PUBLIC_WEB_URL=http://localhost:3001` (or add this origin to `CORS_ORIGINS`), and set `AUTH_DOMAIN` to the domain users see.

The escrow WASM hash must equal `ESCROW_WASM_HASH` written by the contract repo's `scripts/deploy-testnet.sh`, which is the sha256 of `trustescrow_escrow.wasm`.

## Scripts

```sh
npm run dev         # development server on :3001
npm run build       # production build
npm run typecheck
npm run lint
npm test            # unit tests: code vectors, canonical JSON, vault, actions, ABI, decoding
```

## Layout

```
src/sdk/          Escrow SDK: no React, no backend. Works against Soroban RPC alone.
  code.ts           delivery code: encode, normalise, hash (matches crates/code)
  chain.ts          contract ABI, simulate/restore/sign/submit, WASM pinning, rail readiness
  actions.ts        which calls the contract accepts for a viewer at a time (mirrors the escrow's guards)
  vault.ts          envelope sealing and opening (passkey PRF or PBKDF2, AES-256-GCM)
  canonical-json.ts RFC 8785, identical to the backend's
  terms.ts, decode.ts, proof.ts, amount.ts, errors.ts, types.ts
src/lib/          app wiring: config, backend API client, wallet adapter, auth, step-up, transactions
src/components/   UI; src/app/ routes
test/             unit tests
```

`src/sdk` has no React and no backend dependency, so it can be extracted into the standalone SDK package the architecture describes.


