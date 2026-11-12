import {
  CalendarPlus,
  Check,
  FileText,
  LayoutDashboard,
  Lock,
  Receipt,
  Smartphone,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { demoEvent, ticketTypes } from "../../demo.ts";
import { cn } from "../../lib/cn.ts";
import { formatEventDate } from "../../lib/format.ts";
import { PanelLayout, type PanelNavItem } from "../../ui/layouts.tsx";
import { Button, Card, Field, Notice, PageHeader, Steps } from "../../ui/ui.tsx";

export const organizerNav: readonly PanelNavItem[] = [
  { to: "/organizador", label: "Dashboard", icon: LayoutDashboard },
  { to: "/organizador/crear", label: "Crear evento", icon: CalendarPlus },
  { to: "/organizador/staff", label: "Staff y dispositivos", icon: Smartphone },
  { to: "/organizador/liquidacion", label: "Liquidación", icon: Receipt },
];

export function OrganizerLayout({ children }: { children: ReactNode }) {
  return (
    <PanelLayout area="Organizador" nav={organizerNav}>
      {children}
    </PanelLayout>
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
