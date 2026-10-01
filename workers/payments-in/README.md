# Payment notices

Receives bank payment notices, by email or from the SMS forwarder, verifies their origin, and hands them to the `payments` module.

- Email: DKIM, SPF and DMARC must pass.
- SMS: HMAC signature from the forwarder device.

**Status:** placeholder. Scaffolded in Phase 3.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
