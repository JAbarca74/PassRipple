# Security Policy

PassRipple handles payments, personal data and the credentials that let people into events. We take every report seriously.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub: open the [**Security** tab](https://github.com/JAbarca74/PassRipple/security) of this repository and choose **Report a vulnerability** ([direct link](https://github.com/JAbarca74/PassRipple/security/advisories/new)). Only the maintainers can see the report.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected component (wallet, gate app, API, payment reconciliation, dashboard)
- Your name or handle, if you want credit

We will:

- Acknowledge your report within **3 business days**
- Keep you informed while we investigate
- Tell you when the issue is fixed, publish an advisory, and credit you if you wish

There is no bug bounty at this stage.

## Supported versions

PassRipple is pre-alpha and has no releases yet. Only the latest commit on `main` is supported.

## Scope

In scope:

- Forging, cloning or replaying a ticket credential
- Redeeming a ticket more than once, or exceeding an event's capacity
- Getting a payment confirmed without a real bank transfer
- Accessing another buyer's tickets or another organizer's data
- Extracting anything from a gate device that helps forge tickets
- Altering ledger entries or payouts
- A secret, key or personal data committed to this repository, in any commit

Out of scope:

- Attacks that require physical access to an unlocked device
- Social engineering of staff or organizers
- Denial of service through traffic volume
- Reports from automated scanners without a demonstrated impact

## Safe harbor

We will not pursue legal action against research done in good faith that:

- Uses only test events and accounts you control, or a local copy of this code
- Does not access, modify or keep other people's data
- Does not move real money or disrupt a live event
- Gives us reasonable time to fix the issue before any disclosure

## Our own practices

- Secrets live only in platform secret stores, never in this repository
- Every commit and the full history are scanned for secrets (gitleaks), every change is analyzed statically (Semgrep and CodeQL), and the supply chain is graded by OpenSSF Scorecard
- Every GitHub Action is pinned to a full commit SHA, and downloaded tools are checksum-verified
- Dependencies are monitored and updated weekly, after a cooldown period
- The system cannot initiate money transfers
