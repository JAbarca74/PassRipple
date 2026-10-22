# Contributing to PassRipple

Thank you for your interest in PassRipple. Bug reports, questions, ideas and code are all welcome. Issues and discussions can be written in English or Spanish; everything committed (code, comments, commit messages and documentation) is in English.

> **Security problems are never reported in public.** Read [`SECURITY.md`](SECURITY.md) and use GitHub's private vulnerability reporting instead.

## Before you start

- Look through [existing issues](https://github.com/JAbarca74/PassRipple/issues) first. If none fits, open one before writing a large change, so we can agree on the approach.
- Issues labeled `good first issue` are small and self-contained, a good place to start.
- PassRipple is licensed under the [Functional Source License](LICENSE) (FSL-1.1-ALv2). By contributing, you agree that your contribution is released under the same license, including its future Apache 2.0 grant.

## Setting up

Requirements: Node.js 22.18 or later, pnpm (through `corepack enable`), Docker, the PostgreSQL client (`psql`) and [pre-commit](https://pre-commit.com).

```bash
pre-commit install   # scans every commit for secrets before it leaves your machine
pnpm install
pnpm verify          # lint, type check, module boundaries and unit tests
pnpm db:up && pnpm db:migrate && pnpm db:test   # database invariants (pgTAP)
```

Each package's `README.md` explains what it owns and how to work on it.

## Rules the code follows

These are enforced in review, and most of them by CI:

- **Invariants live in the database and the cryptography.** Every change that touches one of the invariants I1 to I9 (listed in the README) needs a test that tries to break it: pgTAP for the database, Vitest for pure code. A happy-path test is not enough.
- **Module boundaries.** Core packages (`packages/`) depend only on `@passripple/contracts`. Modules (`modules/`) depend on core packages and on modules at their level or below. `pnpm check:boundaries` must pass.
- **Each module owns one database schema** and is its only writer.
- **Migrations are immutable.** Never edit an existing migration: add a new numbered file in `modules/<module>/db/migrations`.
- **Erasable TypeScript only:** no `enum` or `namespace`. Relative imports use the `.ts` extension.
- **Pure packages do no I/O**, and never read the clock or the environment.
- **No secrets or personal data, anywhere.** No keys, tokens, bank details, real bank notices, phone numbers or names, not even in tests. Use obviously fictitious values (`example.com`, `0000-0000`). Bank notice samples go only in `packages/bank-parsers/fixtures/anonymized/`.
- **No new third-party scripts** in the checkout or the wallet, and no new dependency without a reason in the pull request.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change. Smaller is reviewed faster.
3. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org) style: `feat(wallet): ...`, `fix(api): ...`, `docs: ...`.
4. Sign off every commit (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org): you wrote the change or have the right to submit it.
5. Run `pnpm verify` (and the database commands if you touched SQL) before you push.
6. Fill in the pull request template, including the invariants your change could affect.

CI runs linting, type checks, unit and database tests, secret scanning, Semgrep and CodeQL on every pull request. All checks must pass, and every change is reviewed by a maintainer before it is merged.

## Code of conduct

Everyone taking part in this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
