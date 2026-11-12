// The organizer's side of the municipal oversight (design 12.2 and 12.3): ask the municipality
// to authorize the emission (or record the authorization of the canton's own process), see
// where it stands, and watch the courtesies against the canton's deductible limit.

import type {
  AuthorizationsResponse,
  CourtesyDeductible,
  SettlementEvent,
} from "@passripple/contracts";
import { Landmark, TriangleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatColones } from "../../lib/format.ts";
import { failureText, usePanel } from "../../lib/panel.tsx";
import { Badge, Button, Card, CardTitle, Field, Notice, Row } from "../../ui/ui.tsx";

const STATUS_LABELS = {
  requested: { label: "En revisión", tone: "verify" },
  authorized: { label: "Autorizada", tone: "valid" },
  rejected: { label: "Devuelta", tone: "verify" },
} as const;

export function MunicipalCard({ event }: { event: SettlementEvent }) {
  const panel = usePanel();
  const [authorizations, setAuthorizations] = useState<AuthorizationsResponse["authorizations"]>(
    [],
  );
  const [courtesy, setCourtesy] = useState<CourtesyDeductible | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, alert] = await Promise.all([
        panel.call<AuthorizationsResponse>("/municipal/authorizations"),
        panel.call<CourtesyDeductible>(`/municipal/events/${event.eventId}/courtesy`),
      ]);
      setAuthorizations(list.authorizations.filter((item) => item.eventId === event.eventId));
      setCourtesy(alert);
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel, event.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ask(body: unknown) {
    setBusy(true);
    try {
      await panel.call("/municipal/authorizations", { method: "POST", body });
      setReference("");
      await load();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  const current = authorizations[0] ?? null;
  const open = current?.status === "requested" || current?.status === "authorized";
  const status = current ? STATUS_LABELS[current.status] : null;

  return (
    <Card>
      <CardTitle action={status ? <Badge tone={status.tone}>{status.label}</Badge> : undefined}>
        <Landmark size={18} className="mr-2 inline" aria-hidden /> Autorización municipal
      </CardTitle>
      {error && (
        <div className="mt-3">
          <Notice icon={TriangleAlert} title="No se pudo completar" tone="verify">
            {error}
          </Notice>
        </div>
      )}
      {current && (
        <div className="mt-3 divide-y divide-line">
          {current.reference && <Row label="Referencia" value={current.reference} />}
          <Row label="Impuesto máximo estimado" value={formatColones(current.estimatedTaxCrc)} />
          {current.guaranteeCrc !== null && (
            <Row label="Garantía previa" value={formatColones(current.guaranteeCrc)} />
          )}
          {current.notes && <Row label="Observaciones" value={current.notes} />}
        </div>
      )}
      {!open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">
            Si su cantón acepta entradas digitales, la municipalidad debe autorizar la emisión antes
            de publicar. Si su cantón sigue su trámite habitual, registre aquí la referencia de la
            autorización que ya tiene.
          </p>
          <Button
            disabled={busy}
            onClick={() => void ask({ mode: "portal", eventId: event.eventId })}
          >
            Pedir autorización a la municipalidad
          </Button>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(submit: FormEvent) => {
              submit.preventDefault();
              void ask({ mode: "document", eventId: event.eventId, reference });
            }}
          >
            <Field
              className="min-w-56 flex-1"
              label="Ya tengo la autorización"
              hint="Número o referencia del documento de su trámite."
              value={reference}
              onChange={(change) => setReference(change.target.value)}
              maxLength={100}
            />
            <Button variant="secondary" submit disabled={busy || reference.trim() === ""}>
              Registrar
            </Button>
          </form>
        </div>
      )}
      {courtesy && courtesy.deductBps !== null && (
        <div className="mt-4">
          {courtesy.excess > 0 ? (
            <Notice icon={TriangleAlert} title="Cortesías sobre el límite deducible" tone="verify">
              Tiene {courtesy.courtesies} cortesías y el límite del cantón es {courtesy.limit} (
              {courtesy.deductBps / 100} % de {courtesy.entries} entradas). Las {courtesy.excess} de
              más pagan impuesto como si fueran ventas.
            </Notice>
          ) : (
            <p className="text-sm text-slate-600">
              Cortesías: {courtesy.courtesies} de {courtesy.limit} deducibles (
              {courtesy.deductBps / 100} % de {courtesy.entries} entradas).
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
