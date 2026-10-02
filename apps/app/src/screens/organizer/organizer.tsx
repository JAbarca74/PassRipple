import {
  CalendarPlus,
  Check,
  Copy,
  FileText,
  LayoutDashboard,
  Lock,
  Receipt,
  Share2,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { demoEvent, ticketTypes } from "../../demo.ts";
import { cn } from "../../lib/cn.ts";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { PanelLayout, type PanelNavItem } from "../../ui/layouts.tsx";
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
  Steps,
  type Tone,
} from "../../ui/ui.tsx";

export const organizerNav: readonly PanelNavItem[] = [
  { to: "/organizador", label: "Dashboard", icon: LayoutDashboard },
  { to: "/organizador/crear", label: "Crear evento", icon: CalendarPlus },
  { to: "/organizador/staff", label: "Staff y dispositivos", icon: Smartphone },
  { to: "/organizador/liquidacion", label: "Liquidación", icon: Receipt },
];

function OrganizerLayout({ children }: { children: ReactNode }) {
  return (
    <PanelLayout area="Organizador" nav={organizerNav}>
      {children}
    </PanelLayout>
  );
}

const hourlySales = [35, 52, 42, 68, 55, 80, 72, 92, 84, 100];

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

export function OrganizerDashboard() {
  const payments = [
    { ref: "••••4821", amount: 10600, status: "Confirmado", tone: "valid" },
    { ref: "••••1377", amount: 5300, status: "Confirmado", tone: "valid" },
    { ref: "••••9054", amount: 14600, status: "En revisión", tone: "verify" },
  ] as const;
  const devices = [
    { name: "Puerta principal · 1", sync: "Hace 1 min", pending: 0 },
    { name: "Puerta principal · 2", sync: "Hace 3 min", pending: 4 },
    { name: "Zona VIP", sync: "Hace 12 min", pending: 18 },
  ];
  return (
    <OrganizerLayout>
      <PageHeader
        eyebrow="En vivo"
        title={demoEvent.name}
        description={`${formatEventDate(demoEvent.startsAt)} · ${demoEvent.venue}`}
        action={
          <Button variant="secondary">
            <Share2 size={17} aria-hidden /> Compartir enlace del evento
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Entradas vendidas" value="384" note="+12 en la última hora" />
        <Stat label="Ingresaron" value="241" note="63 % de lo vendido" />
        <Stat label="Cortesías" value="18 de 30" />
        <Stat label="Venta en puerta" value={formatColones(420000)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardTitle action={<Badge tone="valid">Actualizado ahora</Badge>}>
            Ventas por hora
          </CardTitle>
          <div className="mt-6 flex h-44 items-end gap-2 border-b border-line">
            {hourlySales.map((height, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: static demo series
                key={index}
                className="flex-1 rounded-t bg-brand/80"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-600">
            <span>10 a. m.</span>
            <span>12 p. m.</span>
            <span>2 p. m.</span>
            <span>4 p. m.</span>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
            {[
              ["WhatsApp", "61 %"],
              ["Instagram", "24 %"],
              ["Facebook", "15 %"],
            ].map(([channel, share]) => (
              <div key={channel} className="rounded-xl bg-slate-50 p-3">
                <p className="text-slate-600">{channel}</p>
                <p className="font-black">{share}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Aforo autorizado</CardTitle>
          <div className="mt-4">
            <CapacityGauge committed={402} capacity={demoEvent.capacity} />
          </div>
          <p className="mt-4 text-center text-sm text-slate-600">
            Vendidas, cortesías y venta en puerta cuentan contra el aforo.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Cobros en vivo</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {payments.map((payment) => (
              <li key={payment.ref} className="flex items-center justify-between py-3 text-sm">
                <span className="font-mono">{payment.ref}</span>
                <span className="font-semibold">{formatColones(payment.amount)}</span>
                <Badge tone={payment.tone}>{payment.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Dispositivos de puerta</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {devices.map((device) => (
              <li key={device.name} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <span className="block font-semibold">{device.name}</span>
                  <span className="text-slate-600">Sincronizó {device.sync.toLowerCase()}</span>
                </span>
                <Badge tone={device.pending > 10 ? "verify" : "valid"}>
                  {device.pending} por enviar
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            Para 500 personas en dos horas se recomiendan 3 validadores.
          </p>
        </Card>
      </div>
    </OrganizerLayout>
  );
}

const createSteps = ["Datos", "Aforo", "Entradas", "Cortesías", "Permiso", "Publicar"] as const;

export function CreateEvent() {
  const [step, setStep] = useState(0);
  const [capacity, setCapacity] = useState(500);
  const [quotas, setQuotas] = useState<Record<string, number>>({
    general: 300,
    sombra: 120,
    vip: 50,
  });
  const totalQuota = Object.values(quotas).reduce((sum, value) => sum + value, 0);
  const overCapacity = totalQuota > capacity;
  const checklist = [
    { label: "Datos del evento completos", done: true },
    { label: "Entradas dentro del aforo", done: !overCapacity },
    { label: "Organización verificada", done: true },
    { label: "Permiso municipal autorizado", done: false },
  ];
  const canPublish = checklist.every((item) => item.done);

  return (
    <OrganizerLayout>
      <PageHeader eyebrow="Nuevo evento" title="Crear evento" />
      <Steps steps={createSteps} current={step} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="space-y-4">
          {step === 0 && (
            <>
              <Field label="Nombre del evento" defaultValue={demoEvent.name} />
              <Field label="Lugar" defaultValue={demoEvent.venue} />
              <Field label="Cantón" defaultValue={demoEvent.canton} />
              <Field label="Fecha y hora" type="datetime-local" defaultValue="2026-11-14T13:00" />
            </>
          )}
          {step === 1 && (
            <>
              <Field
                label="Aforo autorizado"
                type="number"
                min={1}
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
                hint="El total de entradas, cortesías y venta en puerta nunca puede superarlo."
              />
              <fieldset>
                <legend className="text-sm font-bold">Clasificación</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {["Todo público", "Mayores de 12", "Mayores de 18"].map((rating) => (
                    <label
                      key={rating}
                      className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 text-sm"
                    >
                      <input
                        type="radio"
                        name="rating"
                        defaultChecked={rating === "Todo público"}
                        className="accent-brand"
                      />
                      {rating}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {step === 2 && (
            <>
              {ticketTypes.map((type) => (
                <div key={type.id} className="grid grid-cols-3 items-end gap-3">
                  <Field label="Tipo" defaultValue={type.name} />
                  <Field label="Precio (₡)" type="number" defaultValue={type.price} />
                  <Field
                    label="Cantidad"
                    type="number"
                    min={0}
                    value={quotas[type.id] ?? 0}
                    onChange={(event) =>
                      setQuotas({ ...quotas, [type.id]: Number(event.target.value) })
                    }
                  />
                </div>
              ))}
              <p
                className={cn(
                  "text-sm font-bold",
                  overCapacity ? "text-red-700" : "text-slate-600",
                )}
              >
                {totalQuota} de {capacity} lugares asignados
                {overCapacity && ": supera el aforo autorizado"}
              </p>
            </>
          )}
          {step === 3 && (
            <Field
              label="Cupo de cortesías"
              type="number"
              min={0}
              defaultValue={30}
              hint="Las cortesías también cuentan contra el aforo, y no se puede emitir más de este cupo."
            />
          )}
          {step === 4 && (
            <>
              <Notice icon={FileText} title="Permiso municipal en revisión" tone="verify">
                La municipalidad de {demoEvent.canton} revisa la solicitud. Puede seguir preparando
                el evento mientras tanto.
              </Notice>
              <Button variant="secondary">Subir permiso</Button>
            </>
          )}
          {step === 5 && (
            <>
              <ul className="space-y-2">
                {checklist.map((item) => (
                  <li key={item.label} className="flex items-center gap-3 text-sm">
                    {item.done ? (
                      <Check size={18} className="text-valid" aria-label="Listo" />
                    ) : (
                      <Lock size={18} className="text-verify" aria-label="Pendiente" />
                    )}
                    {item.label}
                  </li>
                ))}
              </ul>
              <Button variant="brand" disabled={!canPublish} className="w-full">
                Publicar evento
              </Button>
              {!canPublish && (
                <p className="text-sm text-slate-600">Complete la lista para poder publicar.</p>
              )}
            </>
          )}
          <div className="flex justify-between border-t border-line pt-4">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Atrás
            </Button>
            {step < createSteps.length - 1 && (
              <Button onClick={() => setStep(step + 1)}>Siguiente</Button>
            )}
          </div>
        </Card>
        <Card className="h-fit">
          <p className="text-xs font-black uppercase tracking-wider text-brand">Vista previa</p>
          <div className="mt-3 aspect-[1.9/1] rounded-xl bg-gradient-to-br from-brand to-ink" />
          <p className="mt-3 text-lg font-black">{demoEvent.name}</p>
          <p className="text-sm text-slate-600">{formatEventDate(demoEvent.startsAt)}</p>
          <p className="text-sm text-slate-600">{demoEvent.venue}</p>
        </Card>
      </div>
    </OrganizerLayout>
  );
}

export function Staff() {
  const codes = [
    { role: "Validador", zone: "Puerta principal", code: "VAL-7K2Q" },
    { role: "Validador", zone: "Zona VIP", code: "VAL-3M9X" },
    { role: "Venta en puerta", zone: "Puerta principal", code: "VEN-5R1C" },
    { role: "Supervisor", zone: "Todas", code: "SUP-8D4W" },
  ];
  const devices = [
    { name: "Teléfono de puerta 1", role: "Validador", block: "—", courtesy: "—" },
    { name: "Teléfono de puerta 2", role: "Venta en puerta", block: "50 entradas", courtesy: "10" },
    { name: "Teléfono de supervisor", role: "Supervisor", block: "—", courtesy: "20" },
  ];
  return (
    <OrganizerLayout>
      <PageHeader
        eyebrow={demoEvent.name}
        title="Staff y dispositivos"
        description="Cada persona entra con un código de su rol y zona."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Códigos por rol y zona</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {codes.map((entry) => (
              <li
                key={entry.code}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <span className="text-sm">
                  <span className="block font-semibold">{entry.role}</span>
                  <span className="text-slate-600">{entry.zone}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold">{entry.code}</span>
                  <button
                    type="button"
                    aria-label={`Copiar código ${entry.code}`}
                    className="grid size-11 place-items-center rounded-lg hover:bg-slate-100"
                  >
                    <Copy size={16} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Dispositivos enrolados</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {devices.map((device) => (
              <li key={device.name} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{device.name}</span>
                  <Button variant="danger" className="min-h-10 px-3 text-sm">
                    Revocar
                  </Button>
                </div>
                <p className="mt-1 text-slate-600">
                  {device.role} · Bloque de venta: {device.block} · Cortesías: {device.courtesy}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </OrganizerLayout>
  );
}

const settlementSteps: readonly { label: string; tone: Tone }[] = [
  { label: "Evento terminado", tone: "valid" },
  { label: "Cobros conciliados", tone: "valid" },
  { label: "Periodo de reclamos", tone: "verify" },
  { label: "Transferencia registrada", tone: "neutral" },
  { label: "Recibido por usted", tone: "neutral" },
];

export function Settlement() {
  const ledger = [
    { date: "14 nov", concept: "Cobros por SINPE (384 entradas)", amount: 2035200 },
    { date: "14 nov", concept: "Cargos por servicio", amount: -115200 },
    { date: "15 nov", concept: "Devolución orden A2F8Q1", amount: -10600 },
  ];
  const payout = ledger.reduce((sum, entry) => sum + entry.amount, 0);
  return (
    <OrganizerLayout>
      <PageHeader eyebrow={demoEvent.name} title="Liquidación" />
      <Card>
        <ol className="grid gap-3 sm:grid-cols-5">
          {settlementSteps.map((step, index) => (
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
      <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardTitle>Estado de liquidación</CardTitle>
          <div className="mt-3 divide-y divide-line">
            {ledger.map((entry) => (
              <Row key={entry.concept} label={entry.concept} value={formatColones(entry.amount)} />
            ))}
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <Row strong label="Monto a transferir" value={formatColones(payout)} />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            El impuesto municipal se calcula con las reglas del cantón y se muestra solo como
            información: lo paga el organizador.
          </p>
          <Button className="mt-4 w-full" disabled>
            Confirmar que la recibí
          </Button>
        </Card>
        <Card>
          <CardTitle action={<Badge>Solo lectura</Badge>}>Libro del evento</CardTitle>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-600">
              <tr>
                <th className="py-2 font-bold">Fecha</th>
                <th className="py-2 font-bold">Concepto</th>
                <th className="py-2 text-right font-bold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ledger.map((entry) => (
                <tr key={entry.concept}>
                  <td className="py-3">{entry.date}</td>
                  <td className="py-3">{entry.concept}</td>
                  <td className="py-3 text-right font-semibold">{formatColones(entry.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-600">
            <TriangleAlert size={14} aria-hidden /> Los asientos no se editan: un error se corrige
            con un ajuste.
          </p>
        </Card>
      </div>
    </OrganizerLayout>
  );
}
