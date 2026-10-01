# SMS forwarder

Minimal Android app for a dedicated phone that holds the SIM of the collection SINPE number. It forwards each payment SMS from the bank to the `payments-in` worker, signed with an HMAC key.

- Forwards only messages from the bank's exact sender.
- Signs each request; the key lives in the device keystore and in Workers secrets, never in this repository.
- Keeps a local copy of every message so a failed delivery can be retried.

**Status:** placeholder. Built in Phase 3, and only if the bank cannot send payment notices by email.
