# Gate app

Native app for event staff to validate tickets at the gate, on their personal phones, fully offline. Door sales, supervisor and inspector modes join in later phases.

**Kind:** app · Expo (React Native) with expo-router · Android and iOS

## What it does

1. **Enrollment** (design 11.2): the staff member types their email, then the six-digit code sent to it, then the staff code the organizer shared. The phone becomes a device of that event and keeps its device token in the Keychain or Keystore.
2. **Manifest download** (8.3): with signal, before the event, the phone downloads the event's ticket list into an encrypted SQLite database (op-sqlite with SQLCipher; the key lives in the Keychain or Keystore). It holds public keys only (I7). The app refuses to store it if SQLCipher is not active.
3. **Scanning** (6.3, 6.5): continuous QR reading with the back camera. Each code is verified on the phone: the credential with `@passripple/crypto` (format, server key and signature, device key and signature, window of ±2 × 30 s around the corrected clock, event), then the manifest (not used, not void, not superseded by a newer binding). Green, red with the exact reason, or amber for a valid ticket bought after the download (admitted and reconciled later). A buyer's tickets share a device key, so a burst shows "3 de 4 válidas". The same code read again within 4 s is ignored.
4. **Manual entry** (6.7): the 10-character code when the camera cannot read the QR. The operator sees the ticket type and confirms. Five failures lock entry for a minute, doubling each time, and report a `manual_entry_locked` incident.
5. **Durable queue** (8.6 to 8.9): every admission is marked locally and queued in one SQLite transaction (WAL, `synchronous = FULL`), before the screen turns green. A forced power-off loses nothing. The queue (`@passripple/outbox`) drains every two minutes, on returning to the foreground and when the network comes back, in batches with a 4-second timeout, backoff and a circuit breaker. The manifest updates every minute while active.
6. **State on screen** (8.10): pending operations, last sync, connection (circuit breaker), quarantine, manifest age and clock correction.
7. **Account deletion** (14.7): Cuenta → Eliminar mi cuenta, also from the first screen. The person confirms with an email code; an enrolled phone signs out of the event first, which needs an empty queue. The same deletion is on the public site at `/eliminar-datos`.
8. **The end** (8.3, 8.9, 11.2): when the event's window or the device's validity ends, or the organizer revokes the device, the phone stops validating, uploads what is left and deletes the event's data. Signing out or deleting the event is impossible while anything waits to be uploaded.

The screen stays on in the gate screens, and the app works in the foreground: iOS does not promise background work (8.8).

## Layout

| Path | What it holds |
|---|---|
| `src/app/` | Screens (expo-router): `enroll/` (email, code, staff code), `download`, `gate/` (scan, manual, status, account) |
| `src/gate-context.tsx` | The session and the sync loop |
| `src/lib/gate-session.ts` | Everything for one enrolled event: manifest, decisions, queue, wipe |
| `src/lib/verify.ts` | Steps 1 to 4 of 6.3 and what the operator reads for each refusal |
| `src/lib/scan-session.ts` | Repeated reads, bursts and the manual-entry lock |
| `src/lib/db.ts`, `manifest-store.ts`, `outbox-store.ts` | The encrypted database, the manifest and the outbox store |
| `src/lib/clock.ts` | The clock corrected by the server (ADR 0024) |
| `src/lib/api.ts`, `secure.ts`, `random.ts` | The API client, the Keychain or Keystore, secure randomness |

## Running it locally

There is no Expo Go build: the app uses native modules (camera, SQLCipher), so it runs as a **development build** generated with `expo prebuild` (ADR 0022). `android/` and `ios/` are generated and never committed.

You need Node.js 22.18+, pnpm through `corepack`, Docker, and for Android: Android Studio with an SDK and an emulator (or a phone with USB debugging) and JDK 17. Building for iOS needs a Mac; without one, CI builds it on a macOS runner: for the simulator on every relevant change, and for a real iPhone on demand, installed with xtool from Windows (see "iOS on a real iPhone without a Mac" below).

### 1. Database and API (no Cloudflare account needed)

```bash
corepack pnpm install
corepack pnpm db:up
corepack pnpm db:migrate
corepack pnpm db:api-login
```

Create `workers/api/.dev.vars` from `.dev.vars.example`, with a random `SIGN_IN_PEPPER` and `MAIL_PROVIDER=log` (sign-in codes are printed in the API's console instead of being emailed).

### 2. Test data

```bash
corepack pnpm dev:fixtures seed
```

It creates an organizer (`organizer@example.test`), a "Development event" open from an hour ago for two days, three ticket types (General, VIP and a multi-scan Staff type), 20 tickets bound to test device keys (ticket 3 has no credential, only its code; ticket 4 is void; tickets 0 and 1, 4 and 5, 8 and 9… share a phone, for bursts) and a **staff code**, which it prints. Copy the `SERVER_PUBLIC_KEYS=…` line it prints into `workers/api/.dev.vars`. Every key and datum is fictitious and only for a local machine. Without `psql` on PATH, prefix the command with `DB_CONTAINER=passripple-db`.

To scan, show the QR codes on the computer's screen:

```bash
corepack pnpm dev:fixtures serve     # http://localhost:8790, renews every 20 s
corepack pnpm dev:fixtures images    # or SVG files and codes in .dev-fixtures/ (ignored by Git)
corepack pnpm dev:fixtures list      # index, human code, type and state of each ticket
```

A QR is valid for about two minutes (its 30-second window and two on each side, ADR 0014): that is the point of the design, so the page renews them. The human codes for manual entry are on the page and in `.dev-fixtures/codes.txt`.

### 3. API

```bash
corepack pnpm dev:api
```

`wrangler dev` serves the API on port 8787 and reaches the Docker database through the Hyperdrive binding's local connection. Sign-in codes appear in this console.

### 4. The app

Create `apps/scanner/.env` from `.env.example` with the API's address as the phone sees it:

| Where the app runs | `EXPO_PUBLIC_API_URL` |
|---|---|
| Android emulator | `http://10.0.2.2:8787` |
| Android phone over USB | `http://localhost:8787`, after `adb reverse tcp:8787 tcp:8787` |
| Android phone on the same Wi-Fi | `http://<computer's LAN address>:8787`, with the API started as `corepack pnpm --filter @passripple/worker-api exec wrangler dev --ip 0.0.0.0` |
| iOS simulator (Mac) | `http://localhost:8787` |

Then, from `apps/scanner`:

```bash
corepack pnpm android    # expo run:android: builds the development build, installs it and starts Metro
```

On a Mac, `corepack pnpm ios` does the same for the simulator. Later runs only need `corepack pnpm start` while the build is installed. Development builds allow plain HTTP to the local API; release builds do not.

In the app: type any email (for example `staff1@example.test`), copy the six-digit code from the API's console, type the staff code from `seed`, and download the event.

### 5. Airplane mode and power-off tests

The gate's acceptance test (Phase 2): a phone in airplane mode validates a whole event, and a forced power-off loses nothing.

1. Enroll and download the event with signal.
2. Turn on airplane mode. Scan several tickets from the `serve` page: green, then red when the same one is shown again; a burst of two from one phone; ticket 4 (void) in red; a QR from more than two minutes ago in red. Type ticket 3's code by hand. The pill at the bottom counts what waits to sync, and "Estado" shows the connection as without signal.
3. Force the phone off in the middle of it (hold the power button, or on the emulator `adb emu kill`). Start it again: the pending count is the same, nothing was lost.
4. Turn airplane mode off. Within two minutes (or with "Sincronizar ahora") the count goes to zero. In the database, `redemption.redemptions` has one row per scan, with `admitted` or `duplicate`.
5. Try "Salir del evento" with something pending: it refuses.

To check revocation: revoke the device as the organizer (`POST /v1/staff/devices/:id/revoke`, see `workers/api/README.md`). The phone stops validating at its next sync, uploads what it has and deletes the event.

After trying it, run `corepack pnpm db:down` and `corepack pnpm db:up` before `corepack pnpm db:test`: the pgTAP suite expects a database without fixtures.

## iOS on a real iPhone without a Mac

Field tests on an iPhone (camera, SQLCipher, performance) use [xtool](https://github.com/xtool-org/xtool) before there is a paid Apple Developer account (ADR 0027). xtool does not build the app: CI builds it unsigned on macOS, and xtool signs it with an Apple ID and installs it over USB from WSL.

> **Pending:** the `scanner-field-ipa` workflow and the iOS plain-HTTP exception for field builds in `app.config.ts` are not written yet. Until they are, there is no `.ipa` to install.

### One-time setup (Windows)

1. Install WSL with Ubuntu, and [usbipd-win](https://learn.microsoft.com/en-us/windows/wsl/connect-usb) to pass the iPhone through to WSL. In PowerShell as administrator, with the iPhone plugged in and trusted:

   ```powershell
   usbipd list
   usbipd bind --busid <BUSID>
   usbipd attach --wsl --busid <BUSID>
   ```

   `attach` is needed again each time the iPhone is plugged in.

2. In WSL, follow xtool's [Linux installation guide](https://xtool.sh/documentation/xtooldocs/installation-linux): the Swift toolchain, `usbmuxd` (`sudo apt-get install usbmuxd`), and `Xcode.xip` downloaded in the browser from developer.apple.com. Then install the AppImage:

   ```bash
   curl -fL "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" -o xtool
   chmod +x xtool
   sudo mv xtool /usr/local/bin/
   xtool setup
   ```

3. In `xtool setup`, choose **Password** with the project's dedicated Apple ID, never a personal one: it uses Apple's private APIs, and running Apple's SDK outside a Mac goes against Apple's developer agreement. With a paid account, **API Key** (an App Store Connect team key with the App Manager role) replaces it.

### Each test round

1. Run the `scanner-field-ipa` workflow from the Actions tab with the API's address as the iPhone sees it, as for the field APK.
2. Download its artifact and install it from WSL, with the iPhone attached:

   ```bash
   gh run download <run-id> --name passripple-gate-field-ipa
   xtool devices
   xtool install <path-to>.ipa
   ```

3. On the iPhone, trust the developer profile (Settings → General → VPN & Device Management) the first time.

Free signing lasts 7 days and allows up to 3 apps per device: after that, install it again. The build is Release, with its JavaScript bundled, so it needs no Metro and has no hot reload: each code change is a new CI run.

## UI tests

UI-test builds set `EXPO_PUBLIC_E2E=1`, which adds a hidden field (`e2e-qr-input`, `e2e-qr-submit`) that feeds QR text to the scanner, because simulators have no camera. Screens carry `testID`s for the flows. Production builds never set it. The flows run with Maestro in CI on the iOS simulator (ADR 0023), against [`e2e/mock-api.ts`](e2e/mock-api.ts), which answers every route the app calls in the shared wire format; [`e2e/check-mock-api.ts`](e2e/check-mock-api.ts) checks that before the flows start.

## Google Play

Play takes a signed Android App Bundle. The [`scanner-play-aab`](../../.github/workflows/scanner-play-aab.yml) workflow builds it (arm64-v8a and armeabi-v7a, SQLCipher checked, no plain HTTP) and signs it with the **upload key**; Play App Signing then signs what reaches phones with Google's own key, so a lost upload key can be reset and never locks the app.

### Once: the upload key

On your own machine, with the JDK's `keytool`. Choose the passwords yourself and keep the `.jks` file and both passwords in your password manager: they are not in this repository and nobody else needs them.

```bash
keytool -genkeypair -v -keystore passripple-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=PassRipple, O=PassRipple, C=CR"
```

Then store it as four repository secrets (the base64 one from the file, the others typed when `gh` asks):

```bash
base64 -w0 passripple-upload.jks | gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64
gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD
gh secret set ANDROID_UPLOAD_KEY_ALIAS
gh secret set ANDROID_UPLOAD_KEY_PASSWORD
```

### Each upload

Run `scanner-play-aab` from the Actions tab with the production API address (HTTPS) and a version code higher than any uploaded before, then upload the `.aab` artifact to the track in Play Console. Until Phase 2 reaches `main`, GitHub only offers the manual run on `main`; a push that changes the workflow file runs it with defaults instead.

### The closed test

Personal developer accounts created after 13 November 2023 must run a closed test with at least 12 testers for 14 days in a row before production (design 15.2). The testers are the first organizers' real staff; start at least three weeks before the first event, with more than 12 people for margin. The privacy policy is at `https://passripple.com/privacidad` and account deletion at `https://passripple.com/eliminar-datos`, both linked from the Play listing.

## Dependencies

Every native dependency supports Android and iOS (ADR 0006): `expo-camera` (QR reading with ML Kit on Android and AVFoundation on iOS), `@op-engineering/op-sqlite` with SQLCipher, `expo-secure-store`, `expo-crypto`, `expo-keep-awake`, `expo-haptics`, `@react-native-community/netinfo`. op-sqlite reads its `"op-sqlite": { "sqlcipher": true }` setting from the first `package.json` above its real location; with pnpm that is the repository's root, so the setting is in both this `package.json` and the root one.

Workspace packages are consumed as TypeScript (`@passripple/contracts`, `@passripple/crypto`, `@passripple/outbox`): Metro follows pnpm's links and the packages' `exports`.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
