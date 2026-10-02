# Gate app

Native app for event staff: ticket validation, door sales, supervisor and inspector modes. Runs on staff personal phones and works fully offline.

- Built with Expo (React Native).
- Stores public keys only (invariant I7).
- Built for Android and iOS from the start. Every native dependency must support both.
- Distributed through the Play Store. The iOS build is kept working and tested in the iOS simulator, but there is no App Store release yet.

**Status:** placeholder. Scaffolded in Phase 2.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
