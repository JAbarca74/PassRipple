-- A buyer's right of access (design 14.7, Ley 8968): everything PassRipple keeps about the
-- address behind a used code, as one document the buyer downloads from the wallet. The
-- buyer proves the address with a code, as in recovery and erasure (ADR 0036); the code's
-- purpose is 'export', so a code drawn for another purpose never opens it.
--
-- What it holds: the orders of the address with their lines, events and tickets; each
-- ticket's bindings and the transfers its buyer offered; the consents recorded with each
-- order; and the codes the address asked for. A ticket the buyer gave away belongs to its
-- receiver (6.6): the document stops at the transfer, so it never shows the receiver's
-- device or later history. Secrets are left out: token and code hashes, and device keys
-- (they identify nobody once printed, and the wallet already holds them).

ALTER TABLE orders.contact_codes DROP CONSTRAINT contact_codes_purpose_check;
ALTER TABLE orders.contact_codes
  ADD CONSTRAINT contact_codes_purpose_check CHECK (purpose IN ('recovery', 'erasure', 'export'));

CREATE FUNCTION orders.buyer_export(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_email text;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system exports buyer data' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.contact_email INTO v_email FROM orders.contact_codes c
   WHERE c.id = p_code_id AND c.purpose = 'export' AND c.used_at > now() - interval '5 minutes';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'no export code was just used' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'contact', jsonb_build_object('email', v_email),
    'orders', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'orderCode', o.pay_code,
               'status', o.status,
               'amountCrc', o.amount_crc,
               'contactPhone', o.contact_phone,
               'createdAt', o.created_at,
               'paidAt', o.paid_at,
               'expiresAt', o.expires_at,
               'event', jsonb_build_object(
                 'name', e.name, 'venueName', e.venue_name, 'startsAt', e.starts_at),
               'items', (
                 SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'typeName', tt.name,
                          'quantity', i.quantity,
                          'unitPriceCrc', i.unit_price_crc,
                          'unitFeeCrc', i.unit_fee_crc,
                          'unitFeeTaxCrc', i.unit_fee_tax_crc) ORDER BY i.created_at, i.id), '[]')
                   FROM orders.order_items i
                   JOIN catalog.ticket_types tt ON tt.id = i.ticket_type_id
                  WHERE i.order_id = o.id),
               'tickets', (
                 SELECT coalesce(jsonb_agg(ticket ORDER BY ticket ->> 'issuedAt', ticket ->> 'humanCode'), '[]')
                   FROM (
                     SELECT jsonb_build_object(
                              'typeName', tt.name,
                              -- A ticket given away is shown as such, without its code: it
                              -- is the receiver's now.
                              'humanCode', CASE WHEN g.given_at IS NULL THEN t.code_human END,
                              'status', CASE WHEN g.given_at IS NULL THEN t.status ELSE 'transferred' END,
                              'entryMode', t.entry_mode,
                              'issuedAt', t.created_at,
                              'transferredAt', g.given_at,
                              'bindings', (
                                SELECT coalesce(jsonb_agg(jsonb_build_object(
                                         'reason', b.reason, 'boundAt', b.bound_at)
                                         ORDER BY b.key_version), '[]')
                                  FROM ticketing.ticket_bindings b
                                 WHERE b.ticket_id = t.id
                                   AND b.key_version < coalesce(g.key_version, 32767)),
                              'transferOffers', (
                                SELECT coalesce(jsonb_agg(jsonb_build_object(
                                         'createdAt', x.created_at,
                                         'expiresAt', x.expires_at,
                                         'cancelledAt', x.cancelled_at,
                                         'claimedAt', x.claimed_at) ORDER BY x.created_at), '[]')
                                  FROM ticketing.transfers x
                                 WHERE x.ticket_id = t.id
                                   AND x.from_key_version < coalesce(g.key_version, 32767))
                            ) AS ticket
                       FROM ticketing.tickets t
                       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
                       -- The first transfer of the ticket, if any: where the buyer's part ends.
                       LEFT JOIN LATERAL (
                         SELECT b.key_version, b.bound_at AS given_at
                           FROM ticketing.ticket_bindings b
                          WHERE b.ticket_id = t.id AND b.reason = 'transfer'
                          ORDER BY b.key_version
                          LIMIT 1
                       ) g ON true
                      WHERE t.order_id = o.id
                   ) tickets),
               'consents', (
                 SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'purpose', k.purpose,
                          'granted', k.granted,
                          'documentVersion', k.document_version,
                          'source', k.source,
                          'recordedAt', k.created_at) ORDER BY k.created_at, k.purpose), '[]')
                   FROM privacy.consents k
                  WHERE k.subject_id = o.id)
             ) ORDER BY o.created_at)
        FROM orders.orders o
        JOIN events.events e ON e.id = o.event_id
       WHERE o.contact_email = v_email), '[]'),
    'contactCodes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'purpose', c.purpose,
               'requestedAt', c.created_at,
               'usedAt', c.used_at) ORDER BY c.created_at)
        FROM orders.contact_codes c
       WHERE c.contact_email = v_email), '[]')
  );
END
$$;

GRANT EXECUTE ON FUNCTION orders.buyer_export(uuid) TO passripple_api;
