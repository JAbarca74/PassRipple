# Security Policy

PassRipple handles payments, personal data and the credentials that let people into events. We take every report seriously.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Email **security@&lt;domain&gt;** with:<!-- TODO: replace with the real address once the domain is registered. -->

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected component (wallet, gate app, API, payment reconciliation, dashboard)
- Your name or handle, if you want credit

We will:

- Acknowledge your report within **3 business days**
- Keep you informed while we investigate
- Tell you when the issue is fixed, and credit you if you wish

There is no bug bounty at this stage.

## Scope

In scope:

- Forging, cloning or replaying a ticket credential
- Redeeming a ticket more than once, or exceeding an event's capacity
- Getting a payment confirmed without a real bank transfer
- Accessing another buyer's tickets or another organizer's data
- Extracting anything from a gate device that helps forge tickets
- Altering ledger entries or payouts

Out of scope:

- Attacks that require physical access to an unlocked device
- Social engineering of staff or organizers
- Denial of service through traffic volume
- Reports from automated scanners without a demonstrated impact

## Safe harbor

We will not pursue legal action against research done in good faith that:

- Uses only test events and accounts you control
- Does not access, modify or keep other people's data
- Does not move real money or disrupt a live event
- Gives us reasonable time to fix the issue before any disclosure

## Our own practices

- Secrets live only in platform secret stores, never in this repository
- Every commit is scanned for secrets, and every change is analyzed statically
- Dependencies are monitored and updated weekly
- The system cannot initiate money transfers
