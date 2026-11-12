import { describe, expect, test } from "vitest";
import { courtesyQuotaRequest, grantCourtesyRequest, grantedCourtesy } from "./courtesy-api.ts";

const id = "12345678-1234-4234-8234-123456789010";

describe("courtesy-api", () => {
  test("a quota is a whole number from 0", () => {
    expect(courtesyQuotaRequest.parse({ eventId: id, quota: 0 }).quota).toBe(0);
    expect(courtesyQuotaRequest.safeParse({ eventId: id, quota: -1 }).success).toBe(false);
    expect(courtesyQuotaRequest.safeParse({ eventId: id, quota: 1.5 }).success).toBe(false);
  });

  test("a grant has 1 to 20 tickets of one type", () => {
    expect(
      grantCourtesyRequest.parse({ eventId: id, ticketTypeId: id, quantity: 20 }).quantity,
    ).toBe(20);
    for (const quantity of [0, 21]) {
      expect(
        grantCourtesyRequest.safeParse({ eventId: id, ticketTypeId: id, quantity }).success,
      ).toBe(false);
    }
  });

  test("each granted ticket carries a transfer-style link token", () => {
    const granted = {
      grantId: id,
      links: [
        {
          ticketId: id,
          offerToken: `prx_${"a".repeat(43)}`,
          expiresAt: "2026-12-01T18:00:00-06:00",
        },
      ],
    };
    expect(grantedCourtesy.parse(granted)).toEqual(granted);
    expect(
      grantedCourtesy.safeParse({ ...granted, links: [{ ...granted.links[0], offerToken: "x" }] })
        .success,
    ).toBe(false);
  });
});
