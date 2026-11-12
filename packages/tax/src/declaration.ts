// The municipal declaration (design 12.4): pure arithmetic over the figures the database
// reports and the rules of the canton. Nothing here reads a clock or a database.
//
// Choices the owner confirms against the canton's regulation (pendientes-del-titular):
//   - the tax base is what was charged (online and at the door) plus the courtesies over the
//     deductible limit, valued at the average paid price;
//   - tax is rounded to the nearest colon;
//   - "next_business_day" skips weekends only: public holidays are not modeled.

import type { Declaration, DeclarationFigures } from "@passripple/contracts";

/** Costa Rica has no daylight saving time: local time is UTC minus six hours, always. */
const COSTA_RICA_OFFSET_MS = -6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The first working day (Monday to Friday, Costa Rica time) after the day `endsAt` falls on.
 * Returns null for a settlement rule this package does not know, so the declaration shows
 * no deadline instead of a wrong one.
 */
export function nextBusinessDay(endsAt: string, rule: string): string | null {
  if (rule !== "next_business_day") return null;
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return null;
  // The local calendar day, as midnight UTC of that date.
  let day = Date.parse(isoDate(end + COSTA_RICA_OFFSET_MS));
  do {
    day += DAY_MS;
  } while ([0, 6].includes(new Date(day).getUTCDay()));
  return isoDate(day);
}

/** Calculates the tax and the deadline from the figures of the database. */
export function computeDeclaration(figures: DeclarationFigures): Declaration {
  let gross = 0;
  let paidTickets = 0;
  for (const type of figures.types) {
    const paid = type.online + type.door;
    gross += paid * type.priceCrc;
    paidTickets += paid;
  }
  const averagePrice = paidTickets === 0 ? 0 : Math.round(gross / paidTickets);
  const courtesyExcessCrc = figures.courtesy.excess * averagePrice;
  const taxableBaseCrc = gross + courtesyExcessCrc;
  return {
    figures,
    grossCrc: gross,
    courtesyExcessCrc,
    taxableBaseCrc,
    taxCrc: Math.round((taxableBaseCrc * figures.rules.taxRateBps) / 10000),
    dueDate: nextBusinessDay(figures.event.endsAt, figures.rules.settlementRule),
  };
}

/** A CSV cell: quoted, and neutralized when a spreadsheet would read it as a formula. */
function cell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The declaration as CSV (UTF-8, one row per line), for the municipality's own tools. */
export function declarationCsv(declaration: Declaration): string {
  const { figures: f } = declaration;
  const rows: (string | number | null)[][] = [
    ["Declaración de espectáculo público"],
    ["Evento", f.event.name],
    ["Lugar", f.event.venue],
    ["Inicio", f.event.startsAt],
    ["Fin", f.event.endsAt],
    ["Organizador", f.organization],
    ["Cantón", f.canton.name],
    ["Permiso", f.event.permitNumber],
    ["Autorización de emisión", f.event.emissionAuth],
    [],
    ["Tipo", "Precio (CRC)", "En línea", "En puerta", "Cortesías", "Canjeadas", "Anuladas"],
    ...f.types.map((t) => [
      t.name,
      t.priceCrc,
      t.online,
      t.door,
      t.courtesies,
      t.redeemed,
      t.voided,
    ]),
    [],
    ["Monto bruto (CRC)", declaration.grossCrc],
    ["Cortesías deducibles (límite)", f.courtesy.limit],
    ["Cortesías en exceso", f.courtesy.excess],
    ["Exceso valorado (CRC)", declaration.courtesyExcessCrc],
    ["Base imponible (CRC)", declaration.taxableBaseCrc],
    ["Tasa (puntos base)", f.rules.taxRateBps],
    ["Impuesto (CRC)", declaration.taxCrc],
    ["Fecha de liquidación", declaration.dueDate],
    ["Lecturas repetidas", f.duplicateScans],
    ["Incidentes de aforo", f.capacityIncidents],
    ["Hash de la bitácora (sha256)", f.logHash],
    ["Generado", f.generatedAt],
  ];
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
