import { decodeQr } from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import { signCertificate } from "./certificate.ts";
import { presentCredential } from "./credential.ts";
import { createServerSigner, createSigner } from "./testing.ts";
import {
  signTransferProof,
  TRANSFER_PROOF_MAX_SKEW_SECONDS,
  type TransferProofInput,
  verifyTransferProof,
} from "./transfer.ts";

describe("transfer proof", () => {
  const holder = createSigner("holder");
  const server = createServerSigner("server", 1);
  const now = 1_700_000_000;
  const validInput: TransferProofInput = {
    ticketId: "12345678-1234-4234-8234-123456789012",
    keyVersion: 1,
    issuedAt: now,
  };

  test("valid signature verifies", async () => {
    const signature = await signTransferProof(validInput, holder);
    expect(signature.length).toBe(64);
    expect(verifyTransferProof(validInput, signature, holder.publicKey, now)).toBe(true);
  });

  test("fails if ticketId, keyVersion, issuedAt, holderPubkey, or a signature byte changes", async () => {
    const signature = await signTransferProof(validInput, holder);

    // changed ticketId
    expect(
      verifyTransferProof(
        { ...validInput, ticketId: "87654321-4321-4321-8321-210987654321" },
        signature,
        holder.publicKey,
        now,
      ),
    ).toBe(false);

    // changed keyVersion
    expect(
      verifyTransferProof({ ...validInput, keyVersion: 2 }, signature, holder.publicKey, now),
    ).toBe(false);

    // changed issuedAt
    expect(
      verifyTransferProof({ ...validInput, issuedAt: now - 1 }, signature, holder.publicKey, now),
    ).toBe(false);

    // changed holderPubkey
    const otherHolder = createSigner("other");
    expect(verifyTransferProof(validInput, signature, otherHolder.publicKey, now)).toBe(false);

    // changed signature byte
    const corrupted = new Uint8Array(signature);
    corrupted[0] = (corrupted[0] as number) ^ 0xff;
    expect(verifyTransferProof(validInput, corrupted, holder.publicKey, now)).toBe(false);
  });

  test("skew boundaries: passes at exactly 300s, fails beyond 300s in either direction", async () => {
    const signature = await signTransferProof(validInput, holder);

    // Exactly 300 seconds in the future
    expect(
      verifyTransferProof(
        validInput,
        signature,
        holder.publicKey,
        validInput.issuedAt + TRANSFER_PROOF_MAX_SKEW_SECONDS,
      ),
    ).toBe(true);

    // Exactly 300 seconds in the past
    expect(
      verifyTransferProof(
        validInput,
        signature,
        holder.publicKey,
        validInput.issuedAt - TRANSFER_PROOF_MAX_SKEW_SECONDS,
      ),
    ).toBe(true);

    // 301 seconds in the future -> false
    expect(
      verifyTransferProof(
        validInput,
        signature,
        holder.publicKey,
        validInput.issuedAt + TRANSFER_PROOF_MAX_SKEW_SECONDS + 1,
      ),
    ).toBe(false);

    // 301 seconds in the past -> false
    expect(
      verifyTransferProof(
        validInput,
        signature,
        holder.publicKey,
        validInput.issuedAt - TRANSFER_PROOF_MAX_SKEW_SECONDS - 1,
      ),
    ).toBe(false);
  });

  test("invalid keyVersion or issuedAt: sign throws RangeError, verify returns false", async () => {
    const signature = await signTransferProof(validInput, holder);

    const invalidInputs: TransferProofInput[] = [
      { ...validInput, keyVersion: 0 },
      { ...validInput, keyVersion: 6 },
      { ...validInput, keyVersion: 1.5 },
      { ...validInput, keyVersion: Number.NaN },
      { ...validInput, issuedAt: -1 },
      { ...validInput, issuedAt: 1.5 },
      { ...validInput, issuedAt: 0x1_0000_0000 },
      { ...validInput, issuedAt: Number.NaN },
    ];

    for (const badInput of invalidInputs) {
      await expect(signTransferProof(badInput, holder)).rejects.toThrow(RangeError);
      expect(verifyTransferProof(badInput, signature, holder.publicKey, now)).toBe(false);
    }
  });

  test("signature length != 64 or small-order key returns false", async () => {
    const signature = await signTransferProof(validInput, holder);

    // Signature lengths != 64
    expect(verifyTransferProof(validInput, new Uint8Array(63), holder.publicKey, now)).toBe(false);
    expect(verifyTransferProof(validInput, new Uint8Array(65), holder.publicKey, now)).toBe(false);

    // Small order key (all zeroes)
    const smallOrderKey = new Uint8Array(32);
    expect(verifyTransferProof(validInput, signature, smallOrderKey, now)).toBe(false);
  });

  test("signer that returns invalid signature causes signTransferProof to throw", async () => {
    // Bad length
    const shortSigner = {
      publicKey: holder.publicKey,
      async sign() {
        return new Uint8Array(63);
      },
    };
    await expect(signTransferProof(validInput, shortSigner)).rejects.toThrow(
      "the device produced a signature that does not verify",
    );

    // Corrupted signature
    const corruptSigner = {
      publicKey: holder.publicKey,
      async sign() {
        return new Uint8Array(64);
      },
    };
    await expect(signTransferProof(validInput, corruptSigner)).rejects.toThrow(
      "the device produced a signature that does not verify",
    );
  });

  test("domain separation: presentation signature does not verify as transfer proof", async () => {
    const cert = await signCertificate(
      {
        ticketId: validInput.ticketId,
        eventId: "87654321-4321-4321-8321-210987654321",
        typeRef: 1,
        entryMode: "single_use",
        ageRating: "all",
        named: false,
        holderPubkey: holder.publicKey,
        keyVersion: validInput.keyVersion,
      },
      server,
    );
    const qr = await presentCredential(cert, holder, now * 1000);
    const decoded = decodeQr(qr);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("failed to decode qr");
    expect(decoded.value.holderSig.length).toBe(64);

    expect(verifyTransferProof(validInput, decoded.value.holderSig, holder.publicKey, now)).toBe(
      false,
    );
  });
});
