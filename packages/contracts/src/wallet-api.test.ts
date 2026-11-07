import { describe, expect, test } from "vitest";
import {
  bindRequest,
  claimRequest,
  claimResponse,
  HELD_TOKEN_PREFIX,
  heldView,
  OFFER_TOKEN_PREFIX,
  offerRequest,
  recoveryRequest,
  recoveryVerifyRequest,
  recoveryVerifyResponse,
  TRANSFER_OFFER_STATES,
  transferOffered,
  transferPreview,
  transferProof,
  WALLET_TICKET_STATUSES,
  walletTicket,
  walletView,
} from "./wallet-api.ts";

describe("wallet-api contracts", () => {
  const validTicketId = "12345678-1234-4234-8234-123456789012";
  const validEventId = "87654321-4321-4321-8321-210987654321";
  const validKey = "A".repeat(43);
  const validSig = "B".repeat(86);
  const validIsoTime = "2026-11-07T12:00:00-06:00";

  describe("transferProof", () => {
    const validProof = {
      ticketId: validTicketId,
      publicKey: validKey,
      issuedAt: 1_700_000_000,
      signature: validSig,
    };

    test("accepts valid transferProof", () => {
      expect(transferProof.parse(validProof)).toEqual(validProof);
    });

    test("rejects invalid ticketId", () => {
      expect(() => transferProof.parse({ ...validProof, ticketId: "invalid-uuid" })).toThrow();
    });

    test("rejects publicKey with invalid length or non-base64url", () => {
      expect(() => transferProof.parse({ ...validProof, publicKey: "A".repeat(42) })).toThrow();
      expect(() => transferProof.parse({ ...validProof, publicKey: "A".repeat(44) })).toThrow();
      expect(() =>
        transferProof.parse({ ...validProof, publicKey: `${"A".repeat(42)}+` }),
      ).toThrow();
    });

    test("rejects negative or non-integer issuedAt", () => {
      expect(() => transferProof.parse({ ...validProof, issuedAt: -1 })).toThrow();
      expect(() => transferProof.parse({ ...validProof, issuedAt: 1.5 })).toThrow();
    });

    test("rejects signature with invalid length or non-base64url", () => {
      expect(() => transferProof.parse({ ...validProof, signature: "B".repeat(85) })).toThrow();
      expect(() => transferProof.parse({ ...validProof, signature: "B".repeat(87) })).toThrow();
      expect(() =>
        transferProof.parse({ ...validProof, signature: `${"B".repeat(85)}/` }),
      ).toThrow();
    });
  });

  describe("transferOffered and prefixes", () => {
    test("prefixes match constants", () => {
      expect(OFFER_TOKEN_PREFIX).toBe("prx_");
      expect(HELD_TOKEN_PREFIX).toBe("prh_");
    });

    test("accepts valid transferOffered with prx_ prefix", () => {
      const offered = {
        offerToken: `${OFFER_TOKEN_PREFIX}${"a".repeat(40)}`,
        expiresAt: validIsoTime,
      };
      expect(transferOffered.parse(offered)).toEqual(offered);
    });

    test("rejects offerToken without prx_ prefix or > 128 chars", () => {
      expect(() =>
        transferOffered.parse({
          offerToken: `other_${"a".repeat(40)}`,
          expiresAt: validIsoTime,
        }),
      ).toThrow();

      expect(() =>
        transferOffered.parse({
          offerToken: `${OFFER_TOKEN_PREFIX}${"a".repeat(125)}`,
          expiresAt: validIsoTime,
        }),
      ).toThrow();
    });

    test("rejects invalid expiresAt", () => {
      expect(() =>
        transferOffered.parse({
          offerToken: `${OFFER_TOKEN_PREFIX}${"a".repeat(40)}`,
          expiresAt: "not-iso",
        }),
      ).toThrow();
    });
  });

  describe("offerRequest", () => {
    test("accepts valid offerRequest with prx_ prefix", () => {
      const req = { offerToken: `${OFFER_TOKEN_PREFIX}${"x".repeat(32)}` };
      expect(offerRequest.parse(req)).toEqual(req);
    });

    test("rejects offerRequest without prx_ prefix", () => {
      expect(() =>
        offerRequest.parse({ offerToken: "pra_12345678901234567890123456789012" }),
      ).toThrow();
    });
  });

  describe("transferPreview", () => {
    test("accepts all 4 transfer offer states", () => {
      expect(TRANSFER_OFFER_STATES).toEqual(["open", "claimed", "cancelled", "expired"]);

      for (const state of TRANSFER_OFFER_STATES) {
        const preview = {
          eventName: "Concert",
          venueName: "Stadium",
          startsAt: validIsoTime,
          typeName: "General",
          expiresAt: validIsoTime,
          state,
        };
        expect(transferPreview.parse(preview)).toEqual(preview);
      }
    });

    test("rejects invalid transfer offer state", () => {
      expect(() =>
        transferPreview.parse({
          eventName: "Concert",
          venueName: "Stadium",
          startsAt: validIsoTime,
          typeName: "General",
          expiresAt: validIsoTime,
          state: "invalid_state",
        }),
      ).toThrow();
    });
  });

  describe("claimRequest and claimResponse", () => {
    test("accepts valid claimRequest", () => {
      const req = {
        offerToken: `${OFFER_TOKEN_PREFIX}${"x".repeat(32)}`,
        publicKey: validKey,
      };
      expect(claimRequest.parse(req)).toEqual(req);
    });

    test("rejects claimRequest with invalid key or invalid offerToken", () => {
      expect(() =>
        claimRequest.parse({
          offerToken: "bad_token",
          publicKey: validKey,
        }),
      ).toThrow();

      expect(() =>
        claimRequest.parse({
          offerToken: `${OFFER_TOKEN_PREFIX}${"x".repeat(32)}`,
          publicKey: "short",
        }),
      ).toThrow();
    });

    test("accepts valid claimResponse with prh_ prefix", () => {
      const res = { token: `${HELD_TOKEN_PREFIX}${"h".repeat(32)}` };
      expect(claimResponse.parse(res)).toEqual(res);
    });

    test("rejects claimResponse without prh_ prefix or > 128 chars", () => {
      expect(() =>
        claimResponse.parse({ token: "prx_12345678901234567890123456789012" }),
      ).toThrow();
      expect(() =>
        claimResponse.parse({ token: `${HELD_TOKEN_PREFIX}${"h".repeat(125)}` }),
      ).toThrow();
    });
  });

  describe("walletTicket and heldView", () => {
    const baseTicket = {
      id: validTicketId,
      typeName: "General",
      humanCode: "4K7NP-9XR2M",
      status: "bound" as const,
      keyVersion: 1,
      holderKey: validKey,
      certificate: "cert_b64url",
      transferred: false,
    };

    test("walletTicket requires transferred field", () => {
      expect(walletTicket.parse(baseTicket)).toEqual(baseTicket);
      expect(walletTicket.parse({ ...baseTicket, transferred: true }).transferred).toBe(true);

      const withoutTransferred = { ...baseTicket };
      delete (withoutTransferred as Record<string, unknown>).transferred;
      expect(() => walletTicket.parse(withoutTransferred)).toThrow();
    });

    test("walletTicket accepts null holderKey and certificate for issued/void tickets", () => {
      const ticketWithNulls = {
        ...baseTicket,
        status: "issued" as const,
        holderKey: null,
        certificate: null,
      };
      expect(walletTicket.parse(ticketWithNulls)).toEqual(ticketWithNulls);
    });

    test("heldView validates event, serverKeys, and ticket", () => {
      const validHeldView = {
        event: {
          id: validEventId,
          name: "Concert",
          venueName: "Arena",
          startsAt: validIsoTime,
        },
        serverKeys: [{ id: 1, publicKey: validKey }],
        ticket: { ...baseTicket, transferred: true },
      };

      expect(heldView.parse(validHeldView)).toEqual(validHeldView);

      // Event may be null
      expect(heldView.parse({ ...validHeldView, event: null }).event).toBeNull();

      // Missing ticket.transferred fails
      const badTicket = { ...baseTicket };
      delete (badTicket as Record<string, unknown>).transferred;
      expect(() => heldView.parse({ ...validHeldView, ticket: badTicket })).toThrow();
    });
  });

  describe("remaining wallet routes coverage", () => {
    test("bindRequest validates publicKey length 43", () => {
      expect(bindRequest.parse({ publicKey: validKey })).toEqual({ publicKey: validKey });
      expect(() => bindRequest.parse({ publicKey: "short" })).toThrow();
    });

    test("walletView validates complete structure", () => {
      const view = {
        order: {
          orderCode: "28T5CW",
          status: "paid" as const,
          amountCrc: 5000,
          expiresAt: validIsoTime,
        },
        event: {
          id: validEventId,
          name: "Festival",
          venueName: "Park",
          startsAt: validIsoTime,
        },
        serverKeys: [{ id: 0, publicKey: validKey }],
        tickets: [
          {
            id: validTicketId,
            typeName: "VIP",
            humanCode: "4K7NP-9XR2M",
            status: "bound" as const,
            keyVersion: 1,
            holderKey: validKey,
            certificate: "cert",
            transferred: false,
          },
        ],
        boundElsewhere: 0,
      };
      expect(walletView.parse(view)).toEqual(view);
    });

    test("recovery schemas validate requests and response", () => {
      const req = recoveryRequest.parse({ contact: "user@example.com" });
      expect(req).toEqual({ contact: { email: "user@example.com" } });

      const verifyReq = recoveryVerifyRequest.parse({
        contact: "user@example.com",
        code: "123456",
      });
      expect(verifyReq.code).toBe("123456");

      expect(() =>
        recoveryVerifyRequest.parse({ contact: "user@example.com", code: "12345" }),
      ).toThrow();

      const verifyRes = {
        orders: [{ orderCode: "28T5CW", token: "tok_12345678901234567890123456789012" }],
      };
      expect(recoveryVerifyResponse.parse(verifyRes)).toEqual(verifyRes);
    });

    test("WALLET_TICKET_STATUSES contains expected values", () => {
      expect(WALLET_TICKET_STATUSES).toEqual(["issued", "bound", "void"]);
    });
  });
});
