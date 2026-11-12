// The door of one event, for its organizer (design 8.5, 10.6, I3): the enrolled devices,
// door-sale blocks (assign before the doors open, close when they close) and complimentary
// tickets (declare the quota, grant, send each link). Everything comes from the API; Row
// Level Security keeps it to the organizer's own events.

import type {
  AssignedBlock,
  ClosedBlock,
  EventDashboard,
  EventOperations,
  GrantedCourtesy,
  SettlementEvent,
} from "@passripple/contracts";
import { Check, Copy, Gift, Lock, Smartphone, Store, TriangleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { failureText, PanelGate, usePanel } from "../../lib/panel.tsx";
import { transferLink } from "../../lib/transfers.ts";
import { Badge, Button, Card, CardTitle, Field, Notice, Row } from "../../ui/ui.tsx";
import { OrganizerEventScreen } from "./event-screen.tsx";
import { OrganizerLayout } from "./organizer.tsx";

const ROLE_LABELS = {
  gate: "Puerta",
  door_sales: "Venta en puerta",
  supervisor: "Supervisión",
  inspector: "Fiscalización",
} as const;

const selectClass = "h-12 w-full rounded-xl border border-slate-300 bg-white px-3";

export function Staff() {
  return (
    <PanelGate kind="organizer">
      <OrganizerLayout>
        <OrganizerEventScreen
          title="Staff, puerta y cortesías"
          pick={(events) => {
            const now = Date.now();
            return events
              .filter((event) => Date.parse(event.endsAt) > now)
              .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
          }}
        >
          {(event) => <EventDoor key={event.eventId} event={event} />}
        </OrganizerEventScreen>
      </OrganizerLayout>
    </PanelGate>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function EventDoor({ event }: { event: SettlementEvent }) {
  const panel = usePanel();
  const [operations, setOperations] = useState<EventOperations | null>(null);
  const [dashboard, setDashboard] = useState<EventDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ops, dash] = await Promise.all([
        panel.call<EventOperations>(`/staff/events/${event.eventId}/operations`),
        panel.call<EventDashboard>(`/reporting/events/${event.eventId}/dashboard`),
      ]);
      setOperations(ops);
      setDashboard(dash);
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel, event.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Notice icon={TriangleAlert} title="No pudimos cargar la puerta" tone="verify">
        {error}
      </Notice>
    );
  }
  if (!operations || !dashboard) return <p className="text-slate-600">Cargando…</p>;

  const typeName = (id: string) =>
    operations.ticketTypes.find((type) => type.id === id)?.name ?? "Entrada";

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        {event.name} · {formatEventDate(new Date(event.startsAt))}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Devices dashboard={dashboard} operations={operations} onChanged={load} />
        <Blocks operations={operations} typeName={typeName} onChanged={load} />
      </div>
      <Courtesies event={event} operations={operations} onChanged={load} />
    </div>
  );
}

function Devices({
  dashboard,
  operations,
  onChanged,
}: {
  dashboard: EventDashboard;
  operations: EventOperations;
  onChanged: () => Promise<void>;
}) {
  const panel = usePanel();
  const sellable = operations.ticketTypes.filter((type) => type.audience === "public");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(sellable[0]?.id ?? "");
  const [size, setSize] = useState("20");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const assign = async (submitted: FormEvent) => {
    submitted.preventDefault();
    if (!deviceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const block = await panel.call<AssignedBlock>(`/staff/devices/${deviceId}/blocks`, {
        method: "POST",
        body: { ticketTypeId: typeId, size: Number(size) },
      });
      setMessage(
        `Bloque de ${block.size} entradas asignado. El teléfono lo recibe al sincronizar.`,
      );
      setDeviceId(null);
      await onChanged();
    } catch (failure) {
      setMessage(failureText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-2">
          <Smartphone size={18} aria-hidden /> Dispositivos enrolados
        </span>
      </CardTitle>
      {dashboard.devices.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          Ningún teléfono se ha enrolado todavía. El staff entra con el código de su rol en la app
          de puerta.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {dashboard.devices.map((device) => (
            <li key={device.deviceId} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {ROLE_LABELS[device.role]} · {shortId(device.deviceId)}
                </span>
                {device.revokedAt ? (
                  <Badge tone="verify">Revocado</Badge>
                ) : device.role === "door_sales" ? (
                  <Button
                    variant="secondary"
                    className="min-h-10 px-3 text-sm"
                    onClick={() => setDeviceId(device.deviceId)}
                  >
                    <Store size={16} aria-hidden /> Asignar bloque
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-slate-600">
                {device.zone ?? "Todas las zonas"} · {device.admitted} ingresos ·{" "}
                {device.lastSyncAt
                  ? `sincronizó ${formatEventDate(new Date(device.lastSyncAt))}`
                  : "sin sincronizar"}
              </p>
              {deviceId === device.deviceId && (
                <form onSubmit={assign} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
                  <label className="block text-sm font-bold">
                    Tipo de entrada
                    <select
                      className={`mt-2 ${selectClass}`}
                      value={typeId}
                      onChange={(change) => setTypeId(change.target.value)}
                    >
                      {sellable.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name} · {formatColones(type.priceCrc)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Cuántas entradas"
                    type="number"
                    min={1}
                    max={1000}
                    value={size}
                    onChange={(change) => setSize(change.target.value)}
                    hint="Salen del aforo en línea desde ahora; las que no se vendan vuelven al cerrar el bloque."
                  />
                  <Button submit className="w-full" disabled={busy || !typeId}>
                    {busy ? "Asignando…" : "Asignar"}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <p className="mt-3 text-sm font-bold text-slate-700">{message}</p>}
    </Card>
  );
}

function Blocks({
  operations,
  typeName,
  onChanged,
}: {
  operations: EventOperations;
  typeName: (id: string) => string;
  onChanged: () => Promise<void>;
}) {
  const panel = usePanel();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const close = async (blockId: string) => {
    if (
      !window.confirm(
        "¿Cerrar el bloque? Las entradas sin vender se anulan y vuelven al aforo. Hágalo cuando el teléfono ya sincronizó todas sus ventas.",
      )
    ) {
      return;
    }
    setBusy(blockId);
    setMessage(null);
    try {
      const closed = await panel.call<ClosedBlock>(`/staff/blocks/${blockId}/close`, {
        method: "POST",
      });
      setMessage(`Bloque cerrado: ${closed.returned} entradas volvieron al aforo.`);
      await onChanged();
    } catch (failure) {
      setMessage(failureText(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-2">
          <Store size={18} aria-hidden /> Venta en puerta
        </span>
      </CardTitle>
      {operations.blocks.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          Sin bloques. Asigne uno a un teléfono con rol de venta en puerta.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {operations.blocks.map((block) => (
            <li key={block.blockId} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {typeName(block.ticketTypeId)} · {shortId(block.deviceId)}
                </span>
                {block.closedAt ? (
                  <Badge tone="neutral">
                    <Lock size={12} aria-hidden /> Cerrado
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    className="min-h-10 px-3 text-sm"
                    disabled={busy === block.blockId}
                    onClick={() => void close(block.blockId)}
                  >
                    Cerrar bloque
                  </Button>
                )}
              </div>
              <p className="mt-1 text-slate-600">
                Vendidas {block.sold} de {block.size} · cobrado por usted{" "}
                {formatColones(block.collectedCrc)}
                {block.closedAt ? ` · devueltas al aforo ${block.returned}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="mt-3 text-sm font-bold text-slate-700">{message}</p>}
      <p className="mt-3 text-xs leading-5 text-slate-600">
        El dinero de la puerta lo recibe usted. La comisión de cada venta se descuenta de su saldo
        en línea al liquidar.
      </p>
    </Card>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copiar enlace"
      className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-slate-100"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  );
}

function Courtesies({
  event,
  operations,
  onChanged,
}: {
  event: SettlementEvent;
  operations: EventOperations;
  onChanged: () => Promise<void>;
}) {
  const panel = usePanel();
  const [quota, setQuota] = useState(String(operations.courtesy.quota));
  const [typeId, setTypeId] = useState(operations.ticketTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const left = operations.courtesy.quota - operations.courtesy.granted;

  const saveQuota = async (submitted: FormEvent) => {
    submitted.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await panel.call(`/courtesies/quota`, {
        method: "POST",
        body: { eventId: event.eventId, quota: Number(quota) },
      });
      setMessage("Cupo guardado.");
      await onChanged();
    } catch (failure) {
      setMessage(failureText(failure));
    } finally {
      setBusy(false);
    }
  };

  const grant = async (submitted: FormEvent) => {
    submitted.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const granted = await panel.call<GrantedCourtesy>(`/courtesies`, {
        method: "POST",
        body: { eventId: event.eventId, ticketTypeId: typeId, quantity: Number(quantity) },
      });
      setLinks(granted.links.map((link) => transferLink(link.offerToken)));
      await onChanged();
    } catch (failure) {
      setMessage(failureText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-2">
          <Gift size={18} aria-hidden /> Cortesías
        </span>
      </CardTitle>
      <Row
        label="Otorgadas"
        value={`${operations.courtesy.granted} de ${operations.courtesy.quota}`}
      />
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveQuota} className="space-y-3">
          <Field
            label="Cupo de cortesías del evento"
            type="number"
            min={operations.courtesy.granted}
            value={quota}
            onChange={(change) => setQuota(change.target.value)}
            hint="Cada cortesía también ocupa un espacio del aforo. No puede bajar de las ya otorgadas."
          />
          <Button submit variant="secondary" disabled={busy}>
            Guardar cupo
          </Button>
        </form>
        <form onSubmit={grant} className="space-y-3">
          <label className="block text-sm font-bold">
            Tipo de entrada
            <select
              className={`mt-2 ${selectClass}`}
              value={typeId}
              onChange={(change) => setTypeId(change.target.value)}
            >
              {operations.ticketTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Cuántas"
            type="number"
            min={1}
            max={Math.min(20, Math.max(1, left))}
            value={quantity}
            onChange={(change) => setQuantity(change.target.value)}
            hint={`Quedan ${Math.max(0, left)} en el cupo.`}
          />
          <Button submit disabled={busy || left <= 0 || !typeId}>
            {busy ? "Otorgando…" : "Otorgar y crear enlaces"}
          </Button>
        </form>
      </div>
      {message && <p className="mt-3 text-sm font-bold text-slate-700">{message}</p>}
      {links.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-slate-700">
            Un enlace por entrada. Envíe cada uno a una persona: lo abre en su teléfono y la entrada
            queda ahí. Sirven una sola vez y hasta que empiece el evento.
          </p>
          <ul className="space-y-2">
            {links.map((link) => (
              <li key={link} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{link}</span>
                <CopyLink link={link} />
                <a
                  className="shrink-0 rounded-lg bg-valid px-3 py-2 text-sm font-bold text-white"
                  href={`https://wa.me/?text=${encodeURIComponent(`Le regalo una entrada para ${event.name}. Ábrala en su teléfono: ${link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
