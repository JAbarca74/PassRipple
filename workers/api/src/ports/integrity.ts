// Device integrity behind a port (rule R5, ADR 0006): Play Integrity on Android and App
// Attest on iOS. The verdict is a signal stored with the device, never a reason to refuse
// enrollment (design 11.2). Phase 2 records whether a token came and that it was not
// verified; real verifiers need the Google Cloud and Apple accounts and plug in here.

import type { DevicePlatform } from "@passripple/contracts";

export interface IntegrityInput {
  readonly platform: DevicePlatform;
  readonly token: string | null;
}

export interface IntegrityVerifier {
  /** A short verdict label to store with the device, such as `unverified:android`. */
  verify(input: IntegrityInput): Promise<string>;
}

export const unverifiedIntegrity: IntegrityVerifier = {
  async verify({ platform, token }) {
    return token === null ? `none:${platform}` : `unverified:${platform}`;
  },
};
