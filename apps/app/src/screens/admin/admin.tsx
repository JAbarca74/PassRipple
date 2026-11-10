// Platform administration, settlement part (design 10.7 to 10.9): custody and own income as
// two separate figures, every event that moved money with what is still owed and by when,
// and the forms to record what a person did by hand in the bank: the payout transfer, a
// refund, or an adjustment. The platform never moves money; I9 refuses paying out more
// than the event holds.

import type {
  LedgerResponse,
  PlatformTotals,
  SettlementEvent,
  SettlementEventsResponse,
  SettlementStatement,
} from "@passripple/contracts";
import { LogOut, ShieldCheck, TriangleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { failureText, PanelGate, usePanel } from "../../lib/panel.tsx";
import { PanelLayout } from "../../ui/layouts.tsx";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Notice,
  PageHeader,
  Row,
  Stat,
} from "../../ui/ui.tsx";
import { LEDGER_LABELS } from "../organizer/settlement.tsx";

const adminNav = [{ to: "/admin", label: "Liquidaciones", icon: ShieldCheck }] as const;

export function Admin() {
  return (
    <PanelGate kind="admin">
      <PanelLayout area="Administración" nav={adminNav}>
        <AdminScreen />
      </PanelLayout>
    </PanelGate>
  );
}

function eventStatus(
  event: SettlementEvent,
  now: number,
): { label: string; tone: "valid" | "verify" | "neutral" } {
  if (event.payoutConfirmedAt) return { label: "Recibida", tone: "valid" };
  if (event.payoutPaidAt) return { label: "Transferida", tone: "valid" };
  if (event.balanceCrc === 0) return { label: "Sin saldo", tone: "neutral" };
  if (Date.parse(event.dueAt) < now) return { label: "Atrasada", tone: "verify" };
  if (Date.parse(event.endsAt) + 24 * 3600_000 > now)
    return { label: "En venta o reclamos", tone: "neutral" };
  return { label: "Por transferir", tone: "verify" };
}

function AdminScreen() {
  const panel = usePanel();
  const [totals, setTotals] = useState<PlatformTotals | null>(null);
  const [events, setEvents] = useState<readonly SettlementEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextTotals, nextEvents] = await Promise.all([
        panel.call<PlatformTotals>("/admin/settlement/summary"),
        panel.call<SettlementEventsResponse>("/admin/settlement/events"),
      ]);
      setTotals(nextTotals);
      setEvents(nextEvents.events);
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const event = events?.find((candidate) => candidate.eventId === selected) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Administración"
        title="Liquidaciones"
        action={
          <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={panel.signOut}>
            <LogOut size={16} aria-hidden /> Salir
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <Notice icon={TriangleAlert} title="No pudimos cargar los datos" tone="verify">
            {error}
          </Notice>
        </div>
      )}
      {totals && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="En custodia" value={formatColones(totals.custodyCrc)} />
          <Stat label="Ingresos propios" value={formatColones(totals.ownIncomeCrc)} />
          <Stat label="Liquidaciones atrasadas" value={String(totals.overdueEvents)} />
        </div>
      )}
      <Card className="mt-6">
        <CardTitle>Eventos con dinero</CardTitle>
        {!events && !error && <p className="mt-3 text-sm text-slate-600">Cargando…</p>}
        {events?.length === 0 && (
          <p className="mt-3 text-sm text-slate-600">Ningún evento ha cobrado todavía.</p>
        )}
        {events && events.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2 pr-3 font-bold">Evento</th>
                  <th className="py-2 pr-3 font-bold">Vence</th>
                  <th className="py-2 pr-3 text-right font-bold">Cobrado</th>
                  <th className="py-2 pr-3 text-right font-bold">Saldo</th>
                  <th className="py-2 pr-3 font-bold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((candidate) => {
                  const status = eventStatus(candidate, now);
                  return (
                    <tr
                      key={candidate.eventId}
                      className={candidate.eventId === selected ? "bg-brand-soft" : undefined}
                    >
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          className="text-left font-semibold text-brand"
                          onClick={() => setSelected(candidate.eventId)}
                        >
                          {candidate.name}
                        </button>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3">
                        {formatEventDate(new Date(candidate.dueAt))}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">
                        {formatColones(candidate.collectedCrc)}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold">
                        {formatColones(candidate.balanceCrc)}
                      </td>
                      <td className="py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {event && <EventAdmin key={event.eventId} event={event} onChanged={load} />}
    </>
  );
}

function EventAdmin({
  event,
  onChanged,
}: {
  event: SettlementEvent;
  onChanged: () => Promise<void>;
}) {
  const panel = usePanel();
  const [statement, setStatement] = useState<SettlementStatement | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse["entries"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutRef, setPayoutRef] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundRef, setRefundRef] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await panel.call<SettlementStatement>(
        `/admin/settlement/events/${event.eventId}/statement`,
      );
      setStatement(next);
      setPayoutAmount((current) => current || String(next.balanceCrc));
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel, event.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setStatement(await panel.call<SettlementStatement>(path, { method: "POST", body }));
      setDone(message);
      await onChanged();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  function recordPayout(submit: FormEvent) {
    submit.preventDefault();
    void send(
      `/admin/settlement/events/${event.eventId}/payout`,
      { amountCrc: Number(payoutAmount), sinpeRef: payoutRef },
      "Transferencia registrada. El organizador ya la ve.",
    );
  }

  function recordRefund(submit: FormEvent) {
    submit.preventDefault();
    void send(
      `/admin/settlement/events/${event.eventId}/entries`,
      {
        kind: "refund",
        amountCrc: -Math.abs(Number(refundAmount)),
        reference: refundRef,
        reason: refundReason.trim() === "" ? null : refundReason,
      },
      "Devolución registrada.",
    ).then(() => {
      setRefundAmount("");
      setRefundRef("");
      setRefundReason("");
    });
  }

  if (!statement) {
    return error ? (
      <Notice icon={TriangleAlert} title="No pudimos cargar el evento" tone="verify">
        {error}
      </Notice>
    ) : (
      <p className="mt-6 text-sm text-slate-600">Cargando…</p>
    );
  }

  const claimsOpen = Date.parse(event.endsAt) + 24 * 3600_000 > Date.now();

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardTitle>{event.name}</CardTitle>
        <div className="mt-3 divide-y divide-line">
          <Row label="Cobrado" value={formatColones(statement.collectedCrc)} />
          <Row
            label="Comisión + IVA"
            value={formatColones(-(statement.feeCrc + statement.feeTaxCrc))}
          />
          <Row label="Devoluciones" value={formatColones(-statement.refundsCrc)} />
          <Row label="Ajustes" value={formatColones(statement.adjustmentsCrc)} />
          <Row label="Transferido" value={formatColones(-statement.paidOutCrc)} />
          <Row strong label="Saldo del organizador" value={formatColones(statement.balanceCrc)} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Vence: {formatEventDate(new Date(statement.dueAt))}
          {statement.payout &&
            ` · Transferido con ${statement.payout.sinpeRef}${statement.payout.confirmedAt ? ", recibido" : ", sin confirmar"}`}
        </p>
        {done && <p className="mt-3 text-sm font-semibold text-green-700">{done}</p>}
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
        <LedgerList
          eventId={event.eventId}
          ledger={ledger}
          setLedger={setLedger}
          statement={statement}
        />
      </Card>
      <div className="space-y-6">
        <Card>
          <CardTitle>Registrar la transferencia al organizador</CardTitle>
          {statement.payout ? (
            <p className="mt-3 text-sm text-slate-600">Este evento ya está liquidado.</p>
          ) : claimsOpen ? (
            <p className="mt-3 text-sm text-slate-600">
              Se puede registrar cuando pasen 24 horas desde que terminó el evento.
            </p>
          ) : (
            <form onSubmit={recordPayout} className="mt-3 space-y-4">
              <p className="text-sm text-slate-600">
                Primero haga la transferencia por SINPE desde la banca en línea; después anótela
                aquí. El sistema no mueve dinero.
              </p>
              <Field
                label="Monto transferido (colones)"
                inputMode="numeric"
                pattern="[0-9]+"
                required
                value={payoutAmount}
                onChange={(change) => setPayoutAmount(change.target.value)}
              />
              <Field
                label="Referencia del SINPE"
                required
                pattern="[0-9A-Za-z\-]{1,64}"
                value={payoutRef}
                onChange={(change) => setPayoutRef(change.target.value)}
              />
              <Button submit className="w-full" disabled={busy}>
                Registrar transferencia
              </Button>
            </form>
          )}
        </Card>
        <Card>
          <CardTitle>Registrar una devolución</CardTitle>
          <form onSubmit={recordRefund} className="mt-3 space-y-4">
            <Field
              label="Monto devuelto (colones)"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={refundAmount}
              onChange={(change) => setRefundAmount(change.target.value)}
            />
            <Field
              label="Referencia del SINPE de la devolución"
              required
              pattern="[0-9A-Za-z\-]{1,64}"
              value={refundRef}
              onChange={(change) => setRefundRef(change.target.value)}
            />
            <Field
              label="Motivo (opcional)"
              value={refundReason}
              onChange={(change) => setRefundReason(change.target.value)}
            />
            <Button submit variant="secondary" className="w-full" disabled={busy}>
              Registrar devolución
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

/** The event's movements, loaded on demand to keep the list screen light. */
function LedgerList({
  eventId,
  ledger,
  setLedger,
  statement,
}: {
  eventId: string;
  ledger: LedgerResponse["entries"];
  setLedger: (entries: LedgerResponse["entries"]) => void;
  statement: SettlementStatement;
}) {
  const panel = usePanel();
  // Reload whenever the statement changes: a new payout or refund adds a movement.
  useEffect(() => {
    void statement;
    panel
      .call<LedgerResponse>(`/admin/settlement/events/${eventId}/ledger`)
      .then((body) => setLedger(body.entries))
      .catch(() => setLedger([]));
  }, [panel, eventId, statement, setLedger]);
  if (ledger.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
      {ledger.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
          <span>
            {LEDGER_LABELS[entry.kind]}
            <span className="ml-2 font-mono text-xs text-slate-600">{entry.reference ?? ""}</span>
          </span>
          <span className="font-semibold">{formatColones(entry.amountCrc)}</span>
        </li>
      ))}
    </ul>
  );
}
