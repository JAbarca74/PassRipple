// Municipal oversight (Phase 8, design 12). Three kinds of caller share these routes:
//   - an organizer (X-Org-Id) asks for the emission authorization and reads its own figures;
//   - a municipal account (an official or an inspector) decides, watches the live count, reads
//     the declaration and verifies tickets;
//   - an administrator grants and revokes municipal accounts (in admin.ts).
// The municipal and events schemas decide who may do what, and that an official only reaches
// events of their own canton; the API only shapes the answers and calculates the tax.

import {
  type AuthorizationItem,
  type AuthorizationsResponse,
  type CourtesyDeductible,
  type DeclarationFigures,
  decideAuthorizationRequest,
  type LiveCounts,
  type MunicipalEvent,
  type MunicipalEventsResponse,
  requestAuthorizationRequest,
  type VerifyTicketResponse,
  verifyTicketRequest,
} from "@passripple/contracts";
import { computeDeclaration, declarationCsv } from "@passripple/tax";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { ApiError } from "../errors.ts";
import { iso, isoRequired, jsonBody, param } from "../validation.ts";

const uuid = z.uuid();

interface AuthorizationRow {
  authorization_id: string;
  event_id: string;
  event_name: string;
  organization: string;
  canton_code: string;
  starts_at: Date;
  permit_number: string | null;
  permitted_capacity: number;
  mode: AuthorizationItem["mode"];
  status: AuthorizationItem["status"];
  reference: string | null;
  notes: string | null;
  requested_at: Date;
  decided_at: Date | null;
  estimated_tax_crc: number;
  guarantee_crc: number | null;
}

interface EventRow {
  event_id: string;
  name: string;
  organization: string;
  canton_code: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  emission_auth: string | null;
  counts: LiveCounts;
}

/** An organizer names its organization in X-Org-Id; anyone else is a municipal account. */
function viewer(c: Context) {
  return userActor(c, c.req.header("x-org-id") ? "organizer" : "inspector");
}

export const municipalRoutes = new Hono<AppEnv>()
  // The organizer asks for the authorization of an event (or records the canton's own).
  .post("/authorizations", async (c) => {
    const input = await jsonBody(c, requestAuthorizationRequest);
    const id = await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        SELECT municipal.request_authorization(
                 ${input.eventId}, ${input.mode},
                 ${input.mode === "document" ? input.reference : null}) AS id`;
      if (!row) throw new Error("municipal.request_authorization returned nothing");
      return row.id;
    });
    return c.json({ authorizationId: id }, 201);
  })

  // The authorizations the caller may see, requests waiting first.
  .get("/authorizations", async (c) => {
    const rows = await c.var.db.transaction(
      await viewer(c),
      (tx) => tx<AuthorizationRow[]>`SELECT * FROM municipal.authorizations_list()`,
    );
    const body: AuthorizationsResponse = {
      authorizations: rows.map((row) => ({
        authorizationId: row.authorization_id,
        eventId: row.event_id,
        eventName: row.event_name,
        organization: row.organization,
        cantonCode: row.canton_code,
        startsAt: isoRequired(row.starts_at),
        permitNumber: row.permit_number,
        permittedCapacity: row.permitted_capacity,
        mode: row.mode,
        status: row.status,
        reference: row.reference,
        notes: row.notes,
        requestedAt: isoRequired(row.requested_at),
        decidedAt: iso(row.decided_at),
        estimatedTaxCrc: row.estimated_tax_crc,
        guaranteeCrc: row.guarantee_crc,
      })),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  // An official authorizes the emission or sends it back to the organizer.
  .post("/authorizations/:id/decision", async (c) => {
    const id = param(c.req.param("id"), uuid);
    const input = await jsonBody(c, decideAuthorizationRequest);
    const reference = await c.var.db.transaction(await userActor(c, "inspector"), async (tx) => {
      const [row] = await tx<{ reference: string | null }[]>`
        SELECT municipal.decide(${id}, ${input.approve}, ${input.notes ?? null}) AS reference`;
      return row?.reference ?? null;
    });
    return c.json({ approved: input.approve, reference });
  })

  // The events of the municipal account's cantons with their live count.
  .get("/events", async (c) => {
    const rows = await c.var.db.transaction(
      await userActor(c, "inspector"),
      (tx) => tx<EventRow[]>`SELECT * FROM municipal.events_overview()`,
    );
    const body: MunicipalEventsResponse = {
      events: rows.map(
        (row): MunicipalEvent => ({
          eventId: row.event_id,
          name: row.name,
          organization: row.organization,
          cantonCode: row.canton_code,
          startsAt: isoRequired(row.starts_at),
          endsAt: isoRequired(row.ends_at),
          status: row.status,
          emissionAuth: row.emission_auth,
          counts: row.counts,
        }),
      ),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  .get("/events/:id/counts", async (c) => {
    const id = param(c.req.param("id"), uuid);
    const counts = await c.var.db.transaction(await viewer(c), async (tx) => {
      const [row] = await tx<{ counts: LiveCounts }[]>`
        SELECT municipal.live_counts(${id}) AS counts`;
      return row?.counts;
    });
    if (!counts) throw new ApiError(404, "not_found", "Not found.");
    c.header("Cache-Control", "no-store");
    return c.json(counts);
  })

  // The alert of the deductible courtesies, for the organizer's panel.
  .get("/events/:id/courtesy", async (c) => {
    const id = param(c.req.param("id"), uuid);
    const body = await c.var.db.transaction(await viewer(c), async (tx) => {
      const [row] = await tx<{ courtesy: CourtesyDeductible }[]>`
        SELECT municipal.courtesy_deductible(${id}) AS courtesy`;
      return row?.courtesy;
    });
    if (!body) throw new ApiError(404, "not_found", "Not found.");
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  // The declaration: JSON, or CSV with ?format=csv. The hash is of the record at this moment.
  .get("/events/:id/declaration", async (c) => {
    const id = param(c.req.param("id"), uuid);
    const figures = await c.var.db.transaction(await viewer(c), async (tx) => {
      const [row] = await tx<{ figures: DeclarationFigures }[]>`
        SELECT municipal.declaration_figures(${id}) AS figures`;
      return row?.figures;
    });
    if (!figures) throw new ApiError(404, "not_found", "Not found.");
    const declaration = computeDeclaration(figures);
    c.header("Cache-Control", "no-store");
    if (c.req.query("format") === "csv") {
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="declaracion-${id}.csv"`);
      return c.body(declarationCsv(declaration));
    }
    return c.json(declaration);
  })

  // Inspector mode: checks a ticket by its human code without admitting it.
  .post("/verify", async (c) => {
    const input = await jsonBody(c, verifyTicketRequest);
    const result = await c.var.db.transaction(await userActor(c, "inspector"), async (tx) => {
      const [row] = await tx<{ result: VerifyTicketResponse }[]>`
        SELECT municipal.verify_ticket(${input.code}) AS result`;
      return row?.result;
    });
    if (!result) throw new Error("municipal.verify_ticket returned nothing");
    c.header("Cache-Control", "no-store");
    return c.json(result);
  });
