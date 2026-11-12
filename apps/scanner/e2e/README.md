# Gate-flow UI tests

Maestro flows for the gate app, run by `.github/workflows/scanner.yml` on the iOS simulator (ADR 0023). The job builds a release app with `EXPO_PUBLIC_E2E=1` and `EXPO_PUBLIC_API_URL=http://localhost:8787`, installs it, and runs every flow in this folder when at least one `*.yaml` exists.

## What the app offers the flows

- **App id:** `com.passripple.scanner` (unless `SCANNER_APP_ID` is set at build time).
- **QR input without a camera:** in E2E builds the scan screen shows a field `e2e-qr-input` and a button `e2e-qr-submit`; typing a QR text and tapping the button is the same as the camera reading it.
- **testIDs:** `email-input`, `email-submit`, `otp-input`, `otp-submit`, `staff-code-input`, `staff-code-submit`, `download-manifest`, `verdict`, `verdict-title`, `verdict-detail`, `open-manual`, `manual-code-input`, `manual-find`, `manual-admit`, `open-status`, `sync-now`, `open-account`, `sign-out`, `open-delete-account`, `delete-email-input`, `delete-send-code`, `delete-code-input`, `delete-confirm`, `gate-closed`.

## The API the flows talk to

The macOS runner has no Docker, so the flows need an API stand-in: if `mock-api.ts` exists here, the job starts it with `node apps/scanner/e2e/mock-api.ts` and waits for `GET /v1/health` on port 8787. It must answer the routes the app calls (`workers/api/README.md`) with the shapes of `@passripple/contracts`, put the server clock in `X-Server-Time`, serve a manifest signed by a test key, and produce QR texts that are valid now (a credential lasts about two minutes).
