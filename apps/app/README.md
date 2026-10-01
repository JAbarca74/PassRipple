# Application

Single-page application served on `app.<domain>`: three-tap checkout, the buyer wallet, the organizer dashboard, the municipal portal and administration.

- Built with Vite and React as an installable PWA.
- No third-party scripts and a strict Content Security Policy (invariant I8).

**Status:** placeholder. Scaffolded in Phase 3.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
