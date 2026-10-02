import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, test } from "vitest";
import { bytesEqual } from "./bytes.ts";
import { signCertificate } from "./certificate.ts";
import { presentCredential, verifyCredential } from "./credential.ts";
import type { Signer } from "./signer.ts";
import { createServerSigner } from "./testing.ts";

describe("WebCrypto compatibility", () => {
  test("PKCS#8 imported seed signs exactly like @noble/curves", async () => {
    const seed = new Uint8Array(32);
    seed.fill(0x42);
    const pkcs8Hex =
      "302e020100300506032b657004220420" +
      Array.from(seed)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const pkcs8 = hexToBytes(pkcs8Hex);

    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      false,
      ["sign"],
    );

    const message = utf8ToBytes("test message");
    const webSig = await globalThis.crypto.subtle.sign("Ed25519", cryptoKey, message);
    const nobleSig = ed25519.sign(message, seed);

    expect(new Uint8Array(webSig)).toEqual(nobleSig);
  });

  test("generates non-extractable key and completes a credential flow", async () => {
    const keyPair = await globalThis.crypto.subtle.generateKey(
      { name: "Ed25519" },
      false, // non-extractable
      ["sign", "verify"],
    );
    const pubKeyBuffer = await globalThis.crypto.subtle.exportKey("raw", keyPair.publicKey);
    const holderPubkey = new Uint8Array(pubKeyBuffer);

    const holderSigner: Signer = {
      publicKey: holderPubkey,
      async sign(message: Uint8Array) {
        const sig = await globalThis.crypto.subtle.sign(
          "Ed25519",
          keyPair.privateKey,
          message.buffer as ArrayBuffer,
        );
        return new Uint8Array(sig);
      },
    };

    const serverSigner = createServerSigner("server-1", 1);

    const cert = await signCertificate(
      {
        ticketId: "12345678-1234-1234-1234-123456789012",
        eventId: "87654321-4321-4321-4321-210987654321",
        typeRef: 5,
        entryMode: "single_use",
        ageRating: "all",
        named: false,
        holderPubkey,
        keyVersion: 1,
      },
      serverSigner,
    );

    const nowMs = 1000000;
    const qr = await presentCredential(cert, holderSigner, nowMs);

    const context = {
      serverKeys: new Map([[1, serverSigner.publicKey]]),
      eventId: "87654321-4321-4321-4321-210987654321",
    };

    const verdict = verifyCredential(qr, context, nowMs);
    expect(verdict.ok).toBe(true);
  });
});
