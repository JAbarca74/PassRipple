-- Door sales in the ledger (design 10.6): the organizer collected the money at the door, so
-- it never enters the balance (kind door_sale is excluded from it), but the platform's
-- commission on it is deducted from the event's online balance at settlement. The API
-- records each sale once it is applied, with the commission priced by the fee schedule.
--
-- The commission can exceed what the event has online (an event that sells mostly at the
-- door): the balance then goes negative, which is what the organizer owes the platform, and
-- I9 keeps any payout from going out until it is covered. Nothing at the gate waits for
-- this: the sale itself is already in door_sales.

-- One door_sale, fee and fee_tax entry per sale at most: retries are harmless.
CREATE UNIQUE INDEX ledger_entries_door_once ON settlement.ledger_entries (kind, reference)
  WHERE reference LIKE 'door:%';

-- Returns 'recorded' or 'duplicate'.
CREATE FUNCTION settlement.record_door_sale(
  p_sale_id uuid, p_event_id uuid, p_amount_crc integer, p_fee_crc integer, p_fee_tax_crc integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_reference text := 'door:' || p_sale_id;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records door sales' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sale_id IS NULL OR p_event_id IS NULL OR p_amount_crc IS NULL OR p_amount_crc < 0
     OR p_fee_crc IS NULL OR p_fee_crc < 0 OR p_fee_tax_crc IS NULL OR p_fee_tax_crc < 0 THEN
    RAISE EXCEPTION 'door sale parameters are required and not negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (SELECT 1 FROM settlement.ledger_entries
              WHERE reference = v_reference AND kind IN ('door_sale', 'fee')) THEN
    RETURN 'duplicate';
  END IF;

  -- A free door ticket (amount 0) has no door_sale entry: the ledger has no zero amounts.
  IF p_amount_crc > 0 THEN
    INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference)
    VALUES (p_event_id, 'door_sale', p_amount_crc, v_reference);
  END IF;

  IF p_fee_crc > 0 THEN
    INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference)
    VALUES (p_event_id, 'fee', -p_fee_crc, v_reference);
  END IF;
  IF p_fee_tax_crc > 0 THEN
    INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference)
    VALUES (p_event_id, 'fee_tax', -p_fee_tax_crc, v_reference);
  END IF;
  RETURN 'recorded';
END
$$;

GRANT EXECUTE ON FUNCTION settlement.record_door_sale(uuid, uuid, integer, integer, integer)
  TO passripple_api;
