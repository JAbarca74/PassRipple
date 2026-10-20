// Adapters of the PaymentProvider port (rule R5, ADR 0034). The only one in Phase 3 is the
// manual channel: a platform administrator types a bank notice they read in the bank's app.
// Parsers for the bank's own notices (email or SMS) arrive when anonymized real notices
// exist to write them against.

import type { ManualNoticeRequest, PaymentNotice, PaymentProvider } from "@passripple/contracts";

const encoder = new TextEncoder();

/**
 * The evidence hash of a typed notice: SHA-256 over its fields in a fixed order, so typing
 * the same notice again gives the same hash and is recognized as the same notice (I4).
 */
async function evidence(input: ManualNoticeRequest): Promise<Uint8Array> {
  const canonical = JSON.stringify([
    "PassRipple/manual-notice/v1",
    input.reference,
    input.amountCrc,
    input.description,
    input.payerName,
    input.payerPhone,
    new Date(input.paidAt).toISOString(),
  ]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical)));
}

export const manualPaymentProvider: PaymentProvider<ManualNoticeRequest> = {
  source: "manual",
  async toNotice(input): Promise<PaymentNotice> {
    return {
      source: "manual",
      reference: input.reference,
      amountCrc: input.amountCrc,
      description: input.description,
      payerName: input.payerName,
      payerPhone: input.payerPhone,
      paidAt: new Date(input.paidAt).toISOString(),
      rawSha256: await evidence(input),
    };
  },
};
