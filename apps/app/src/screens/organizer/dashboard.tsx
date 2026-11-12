// The organizer's live dashboard (design 8.10, Phase 4): how full the event is, sales by
// hour, who got in, the latest payments with their bank reference, and each gate device's
// last synchronization. Refreshed every 30 seconds while the tab is visible.

import {
  csvDocument,
  type EventDashboard,
  type EventExport,
  exportCsvRows,
  type LedgerResponse,
  type SettlementEvent,
} from "@passripple/contracts";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatColones, formatEventDate, formatEventTime } from "../../lib/format.ts";
import { failureText, PanelGate, usePanel } from "../../lib/panel.tsx";
import { Badge, Button, Card, CardTitle, Notice, Stat } from "../../ui/ui.tsx";
import { OrganizerEventScreen } from "./event-screen.tsx";
import { OrganizerLayout } from "./organizer.tsx";

const REFRESH_MS = 30_000;
/** A device silent for longer than this, while the event runs, deserves a look. */
const STALE_SYNC_MS = 15 * 60_000;

const ROLE_LABELS = {
  gate: "Puerta",
  door_sales: "Venta en puerta",
  supervisor: "Supervisión",
  inspector: "Fiscalización",
} as const;

export function OrganizerDashboard() {
  return (
    <PanelGate kind="organizer">
      <OrganizerLayout>
        <OrganizerEventScreen
          title="Dashboard"
          // The event happening now, else the next one, else the most recent.
          pick={(events) => {
            const now = Date.now();
            const live = events.find(
              (event) => Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) > now,
            );
            const upcoming = events
              .filter((event) => Date.parse(event.startsAt) > now)
              .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
            return live ?? upcoming;
          }}
        >
          {(event) => <EventDashboardView event={event} />}
        </OrganizerEventScreen>
      </OrganizerLayout>
    </PanelGate>
  );
}

/** Fraction of the permitted capacity as a ring: a quick read of how full the event is. */
function CapacityGauge({ committed, capacity }: { committed: number; capacity: number }) {
  const ratio = Math.min(1, committed / capacity);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative mx-auto size-44">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="10"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={ratio >= 0.9 ? "var(--color-verify)" : "var(--color-brand)"}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-3xl font-black">{Math.round(ratio * 100)}%</p>
          <p className="text-xs text-slate-600">
            {committed} / {capacity}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "Hace 3 min", "Hace 2 h" or the date, for the last synchronization of a device. */
export function sinceText(instant: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(instant)) / 60_000));
  if (minutes < 1) return "Hace menos de 1 min";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 24 * 60) return `Hace ${Math.round(minutes / 60)} h`;
  return formatEventDate(new Date(instant));
}

function EventDashboardView({ event }: { event: SettlementEvent }) {
  const panel = usePanel();
  const [dashboard, setDashboard] = useState<EventDashboard | null>(null);
  const [payments, setPayments] = useState<LedgerResponse["entries"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [nextDashboard, ledger] = await Promise.all([
        panel.call<EventDashboard>(`/reporting/events/${event.eventId}/dashboard`),
        panel.call<LedgerResponse>(`/settlement/events/${event.eventId}/ledger`),
      ]);
      setDashboard(nextDashboard);
      setPayments(
        ledger.entries
          .filter((entry) => entry.kind === "payment_in")
          .slice(-5)
          .reverse(),
      );
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

  // One row per issued ticket, no personal data: for a spreadsheet or an accountant.
  async function exportTickets() {
    try {
      const data = await panel.call<EventExport>(`/reporting/events/${event.eventId}/export`);
      const blob = new Blob([`﻿${csvDocument(exportCsvRows(data.rows))}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `entradas-${event.eventId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      setError(failureText(failure));
    }
  }

  if (!dashboard) {
    return error ? (
      <Notice icon={TriangleAlert} title="No pudimos cargar el dashboard" tone="verify">
        {error}
      </Notice>
    ) : (
      <p className="text-sm text-slate-600">Cargando…</p>
    );
  }

  const { counters, devices } = dashboard;
  const running =
    Date.parse(event.startsAt) <= refreshedAt && Date.parse(event.endsAt) > refreshedAt;
  const maxHour = Math.max(1, ...counters.salesByHour.map((hour) => hour.tickets));
  const issued = counters.sold + counters.courtesies + counters.doorSales;

  return (
    <>
      <p className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {formatEventDate(new Date(event.startsAt))}
        {running && <Badge tone="valid">En curso</Badge>}
        <Button
          variant="secondary"
          className="ml-auto min-h-10 px-3 text-sm"
          onClick={() => void exportTickets()}
        >
          <Download size={16} aria-hidden /> Exportar entradas (CSV)
        </Button>
      </p>
      {error && (
        <div className="mb-4">
          <Notice icon={TriangleAlert} title="No se pudo actualizar" tone="verify">
            {error}
          </Notice>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Entradas vendidas" value={String(counters.sold)} />
        <Stat
          label="Ingresaron"
          value={String(counters.admitted)}
          {...(issued > 0 && {
            note: `${Math.round((counters.admitted / issued) * 100)} % de lo emitido`,
          })}
        />
        <Stat label="Cortesías" value={String(counters.courtesies)} />
        <Stat label="Ventas en puerta" value={String(counters.doorSales)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.8fr] [&>*]:min-w-0">
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
            Ventas por hora
          </CardTitle>
          <div
            className="mt-6 flex h-44 items-end gap-2 border-b border-line"
            role="img"
            aria-label={`Entradas vendidas por hora en las últimas 12 horas: ${counters.salesByHour.map((hour) => hour.tickets).join(", ")}`}
          >
            {counters.salesByHour.map((hour) => (
              <div
                key={hour.hour}
                title={`${hour.hour.slice(11, 16)}: ${hour.tickets}`}
                className="flex-1 rounded-t bg-brand/80"
                style={{
                  height: `${(hour.tickets / maxHour) * 100}%`,
                  minHeight: hour.tickets ? 4 : 0,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-600">
            <span>{counters.salesByHour[0]?.hour.slice(11, 16)}</span>
            <span>{counters.salesByHour.at(-1)?.hour.slice(11, 16)}</span>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Duplicados rechazados en la puerta: {counters.duplicates} · Incidentes:{" "}
            {counters.incidents}
          </p>
        </Card>
        <Card>
          <CardTitle>Aforo autorizado</CardTitle>
          <div className="mt-4">
            <CapacityGauge committed={counters.committed} capacity={counters.permittedCapacity} />
          </div>
          <p className="mt-4 text-center text-sm text-slate-600">
            Vendidas, reservas en pago, cortesías y venta en puerta cuentan contra el aforo.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle>Últimos cobros</CardTitle>
          {payments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">Todavía no hay cobros.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="font-mono text-xs">{payment.reference ?? "—"}</span>
                  <span className="text-slate-600">
                    {formatEventTime(new Date(payment.createdAt))}
                  </span>
                  <span className="font-semibold">{formatColones(payment.amountCrc)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Dispositivos de puerta</CardTitle>
          {devices.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Ningún teléfono se ha unido al evento. Cree códigos de personal en "Staff y
              dispositivos".
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {devices.map((device, index) => {
                const stale =
                  running &&
                  device.revokedAt === null &&
                  (device.lastSyncAt === null ||
                    refreshedAt - Date.parse(device.lastSyncAt) > STALE_SYNC_MS);
                return (
                  <li
                    key={device.deviceId}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <span>
                      <span className="block font-semibold">
                        {ROLE_LABELS[device.role]} {index + 1}
                        {device.zone && ` · ${device.zone}`}
                      </span>
                      <span className="text-slate-600">
                        {device.lastSyncAt
                          ? `Sincronizó ${sinceText(device.lastSyncAt, refreshedAt).toLowerCase()}`
                          : "Todavía no ha enviado nada"}
                        {` · ${device.admitted} ${device.admitted === 1 ? "ingreso" : "ingresos"}`}
                      </span>
                    </span>
                    {device.revokedAt ? (
                      <Badge>Revocado</Badge>
                    ) : stale ? (
                      <Badge tone="verify">Sin señal reciente</Badge>
                    ) : (
                      <Badge tone="valid">Al día</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-600">
            Lo que un teléfono validó sin señal aparece cuando vuelve a tener conexión.
          </p>
        </Card>
      </div>
    </>
  );
}
