## What and why

<!-- What does this change do, and why is it needed? -->

## Invariants touched

<!-- Check every one this change could affect, and link the test that protects it. -->

- [ ] None
- [ ] I1 — single redemption
- [ ] I2 — permitted capacity
- [ ] I3 — complimentary quota
- [ ] I4 — no double payment
- [ ] I5 — frozen fees
- [ ] I6 — no lost offline operations
- [ ] I7 — gate devices cannot forge credentials
- [ ] I8 — no third-party scripts where buyer keys live
- [ ] I9 — payouts never exceed collections

## Security checklist

- [ ] No secrets, personal data, bank details or real bank notices in code, logs or fixtures
- [ ] All external input is validated with the shared Zod schemas
- [ ] Database changes are new migrations in the owning module, with RLS policies and pgTAP tests
- [ ] Module boundaries respected: `pnpm check:boundaries` passes
- [ ] No new third-party script or dependency without a reason written here
- [ ] The three-tap checkout still takes three taps

## How it was tested

<!-- Commands run (`pnpm verify`, `pnpm db:test`), devices used, offline scenarios covered. -->
