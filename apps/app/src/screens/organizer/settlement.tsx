// The organizer's settlement screen (design 10.7 and 10.8): every movement of the event's
// money with its bank reference, refreshed while open, the statement, and "La recibí" once
// the platform records the transfer. Read-only otherwise: the ledger is never edited.

import type {
  LedgerKind,
  LedgerResponse,
  SettlementEvent,
  SettlementStatement,
} from "@passripple/contracts";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { failureText, PanelGate, usePanel } from "../../lib/panel.tsx";
import { Badge, Button, Card, CardTitle, Notice, Row, type Tone } from "../../ui/ui.tsx";
import { OrganizerEventScreen } from "./event-screen.tsx";
import { OrganizerLayout } from "./organizer.tsx";

/** How often the open screen asks for new movements: a live view without a socket. */
const REFRESH_MS = 30_000;

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  payment_in: "Cobro por SINPE",
  door_sale: "Venta en puerta",
  fee: "Cargo por servicio",
  fee_tax: "IVA del cargo por servicio",
  refund: "Devolución",
  adjustment: "Ajuste",
  payout: "Liquidación transferida",
};

export function settlementSteps(
  event: Pick<SettlementEvent, "endsAt">,
  statement: SettlementStatement,
  now: number,
): readonly { label: string; tone: Tone }[] {
  const ended = Date.parse(event.endsAt) <= now;
  const claimsClosed = Date.parse(event.endsAt) + 24 * 3600_000 <= now;
  const paid = statement.payout !== null;
  const received = statement.payout?.confirmedAt != null;
  const tone = (done: boolean, current: boolean): Tone =>
    done ? "valid" : current ? "verify" : "neutral";
  return [
    { label: "Evento terminado", tone: tone(ended, !ended) },
    { label: "Periodo de reclamos", tone: tone(claimsClosed, ended && !claimsClosed) },
    { label: "Transferencia registrada", tone: tone(paid, claimsClosed && !paid) },
    { label: "Recibido por usted", tone: tone(received, paid && !received) },
  ];
}

export function Settlement() {
  return (
    <PanelGate kind="organizer">
      <OrganizerLayout>
        <SettlementScreen />
      </OrganizerLayout>
    </PanelGate>
  );
}

function SettlementScreen() {
  return (
    <OrganizerEventScreen
      title="Liquidación"
      // The most recent event that has moved money, else the most recent one.
      pick={(events) => events.find((event) => event.collectedCrc > 0)}
    >
      {(event) => <EventSettlement event={event} />}
    </OrganizerEventScreen>
  );
}

function EventSettlement({ event }: { event: SettlementEvent }) {
  const panel = usePanel();
  const [statement, setStatement] = useState<SettlementStatement | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse["entries"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [nextStatement, nextLedger] = await Promise.all([
        panel.call<SettlementStatement>(`/settlement/events/${event.eventId}/statement`),
        panel.call<LedgerResponse>(`/settlement/events/${event.eventId}/ledger`),
      ]);
      setStatement(nextStatement);
      setLedger(nextLedger.entries);
      setRefreshedAt(Date.now());
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel, event.eventId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function confirmReceived() {
    setBusy(true);
    try {
      setStatement(
        await panel.call<SettlementStatement>(
          `/settlement/events/${event.eventId}/payout/confirm`,
          { method: "POST" },
        ),
      );
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!statement || !ledger) {
    return error ? (
      <Notice icon={TriangleAlert} title="No pudimos cargar la liquidación" tone="verify">
        {error}
      </Notice>
    ) : (
      <p className="text-sm text-slate-600">Cargando…</p>
    );
  }

  const steps = settlementSteps(event, statement, refreshedAt);
  const payout = statement.payout;

  return (
    <>
      {error && (
        <div className="mb-4">
          <Notice icon={TriangleAlert} title="No se pudo completar" tone="verify">
            {error}
          </Notice>
        </div>
      )}
      <Card>
        <ol className="grid gap-3 sm:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.label}
              className="flex items-center gap-2 text-sm sm:flex-col sm:text-center"
            >
              <Badge tone={step.tone}>{index + 1}</Badge>
              <span className="font-semibold">{step.label}</span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
        <Card>
          <CardTitle>Estado de liquidación</CardTitle>
          <div className="mt-3 divide-y divide-line">
            <Row label="Cobrado por SINPE" value={formatColones(statement.collectedCrc)} />
            <Row label="Cargo por servicio" value={formatColones(-statement.feeCrc)} />
            <Row label="IVA del cargo" value={formatColones(-statement.feeTaxCrc)} />
            {statement.refundsCrc > 0 && (
              <Row label="Devoluciones" value={formatColones(-statement.refundsCrc)} />
            )}
            {statement.adjustmentsCrc !== 0 && (
              <Row label="Ajustes" value={formatColones(statement.adjustmentsCrc)} />
            )}
            {statement.paidOutCrc > 0 && (
              <Row label="Ya transferido" value={formatColones(-statement.paidOutCrc)} />
            )}
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <Row
              strong
              label={payout ? "Pendiente" : "Monto a transferir"}
              value={formatColones(statement.balanceCrc)}
            />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {payout
              ? `Transferido el ${formatEventDate(new Date(payout.paidAt))}, referencia ${payout.sinpeRef}.`
              : `Fecha límite de la transferencia: ${formatEventDate(new Date(statement.dueAt))}.`}
          </p>
          {statement.overdue && (
            <p className="mt-2 text-sm font-semibold text-amber-800">
              La transferencia está atrasada. La plataforma ya recibió el aviso.
            </p>
          )}
          <p className="mt-3 text-xs text-slate-600">
            Impuesto municipal estimado: {formatColones(statement.municipalTaxCrc)}. Es solo
            información: lo paga el organizador a su municipalidad.
          </p>
          <Button
            className="mt-4 w-full"
            disabled={!payout || payout.confirmedAt !== null || busy}
            onClick={confirmReceived}
          >
            {payout?.confirmedAt
              ? `Recibido el ${formatEventDate(new Date(payout.confirmedAt))}`
              : "Confirmar que la recibí"}
          </Button>
        </Card>
        <Card>
          <CardTitle
            action={
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                onClick={() => void load()}
              >
                <RefreshCw size={14} aria-hidden /> Actualizar
              </button>
            }
          >
            Libro del evento
          </CardTitle>
          {ledger.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">Todavía no hay movimientos.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-600">
                  <tr>
                    <th className="py-2 pr-3 font-bold">Fecha</th>
                    <th className="py-2 pr-3 font-bold">Concepto</th>
                    <th className="py-2 pr-3 font-bold">Referencia</th>
                    <th className="py-2 pr-3 text-right font-bold">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap py-3 pr-3">
                        {formatEventDate(new Date(entry.createdAt))}
                      </td>
                      <td className="py-3 pr-3">
                        {LEDGER_LABELS[entry.kind]}
                        {entry.reason && (
                          <span className="block text-xs text-slate-600">{entry.reason}</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs">{entry.reference ?? "—"}</td>
                      <td className="whitespace-nowrap py-3 text-right font-semibold">
                        {formatColones(entry.amountCrc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-600">
            <TriangleAlert size={14} aria-hidden /> Los asientos no se editan: un error se corrige
            con un ajuste. Se actualiza solo cada 30 segundos.
          </p>
        </Card>
      </div>
    </>
  );
}
