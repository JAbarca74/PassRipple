import { Check, Clock, Copy, Minus, Plus, ShieldCheck, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { DEMO_MAX_PER_ORDER, demoEvent, demoOrder, orderTotals, ticketTypes } from "../../demo.ts";
import { cn } from "../../lib/cn.ts";
import { formatColones, formatCountdown, formatEventDate } from "../../lib/format.ts";
import { navigate } from "../../router.tsx";
import { Badge, Button, ButtonLink, Card, Checkbox, Field, Notice, Row } from "../../ui/ui.tsx";

const SITE_URL = import.meta.env.VITE_SITE_URL ?? "http://localhost:5173";

/** Three taps: type and quantity, email or phone, accept and pay. */
export function Purchase() {
  const [typeId, setTypeId] = useState("general");
  const [quantity, setQuantity] = useState(1);
  const selected = ticketTypes.find((type) => type.id === typeId) ?? ticketTypes[0];
  if (!selected) return null;
  const totals = orderTotals(selected.price, quantity);

  const pay = (event: FormEvent) => {
    event.preventDefault();
    navigate("/pagar");
  };

  return (
    <form onSubmit={pay} className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          {demoEvent.name} · {formatEventDate(demoEvent.startsAt)}
        </p>
        <h1 className="mt-1 text-2xl font-black">Sus entradas</h1>
      </div>

      <Card>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-bold">Tipo de entrada</legend>
          {ticketTypes.map((type) => {
            const soldOut = type.availability === "Agotado";
            const active = type.id === selected.id;
            return (
              <label
                key={type.id}
                className={cn(
                  "flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border p-4",
                  active ? "border-brand bg-brand-soft" : "border-line",
                  soldOut && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="type"
                    className="size-5 accent-brand"
                    checked={active}
                    disabled={soldOut}
                    onChange={() => setTypeId(type.id)}
                  />
                  <span>
                    <span className="block font-bold">{type.name}</span>
                    <span className="text-sm text-slate-600">{formatColones(type.price)}</span>
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs font-bold",
                    type.availability === "Quedan pocas" ? "text-amber-700" : "text-slate-600",
                  )}
                >
                  {type.availability}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 flex items-center justify-between">
          <span className="font-bold">Cantidad</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Una entrada menos"
              disabled={quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
              className="grid size-12 place-items-center rounded-xl border border-line bg-white disabled:opacity-40"
            >
              <Minus size={18} aria-hidden />
            </button>
            <output aria-live="polite" className="w-6 text-center text-lg font-black">
              {quantity}
            </output>
            <button
              type="button"
              aria-label="Una entrada más"
              disabled={quantity >= DEMO_MAX_PER_ORDER}
              onClick={() => setQuantity(quantity + 1)}
              className="grid size-12 place-items-center rounded-xl bg-ink text-white disabled:opacity-40"
            >
              <Plus size={18} aria-hidden />
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <Field
          label="Correo o teléfono"
          name="contact"
          required
          autoComplete="email"
          placeholder="usted@correo.com"
          hint="Lo usamos solo para entregarle sus entradas y para que pueda recuperarlas."
        />
        <Checkbox name="promotions" label="Quiero recibir novedades de PassRipple" />
      </Card>

      <Card>
        <Row label={`${quantity} × ${selected.name}`} value={formatColones(totals.tickets)} />
        <Row label="Cargo por servicio" value={formatColones(totals.serviceCharge)} />
        <div className="mt-2 border-t border-line pt-2">
          <Row strong label="Total" value={formatColones(totals.total)} />
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          Al pagar acepta los{" "}
          <a className="font-bold text-brand underline" href={`${SITE_URL}/terminos`}>
            Términos
          </a>{" "}
          y la{" "}
          <a className="font-bold text-brand underline" href={`${SITE_URL}/privacidad`}>
            Política de privacidad
          </a>
          .
        </p>
        <Button submit className="mt-4 w-full">
          Aceptar y pagar con SINPE
        </Button>
      </Card>
    </form>
  );
}

function useCountdown(initialSeconds: number): number {
  const [deadline] = useState(() => Date.now() + initialSeconds * 1000);
  const [remaining, setRemaining] = useState(initialSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return remaining;
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
      <div>
        <p className="text-xs font-bold uppercase text-slate-600">{label}</p>
        <p className="mt-1 text-lg font-black">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="flex min-h-12 items-center gap-1 px-2 text-sm font-bold text-brand"
      >
        {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

/** SINPE payment: exact data to transfer, the hold countdown, and what happens next. */
export function Payment() {
  const remaining = useCountdown(demoOrder.holdSeconds);
  const { total } = orderTotals(demoOrder.unitPrice, demoOrder.quantity);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-600">Orden {demoOrder.code}</p>
          <h1 className="mt-1 text-2xl font-black">Pague con SINPE Móvil</h1>
        </div>
        <Badge tone="verify">
          <Clock size={14} aria-hidden /> {formatCountdown(remaining)}
        </Badge>
      </div>
      <Card className="space-y-3">
        <p className="text-sm text-slate-700">
          Transfiera desde la app de su banco con estos datos exactos.
        </p>
        <CopyValue label="Número SINPE" value={demoOrder.sinpeNumber} />
        <CopyValue label="Monto exacto" value={formatColones(total)} />
        <CopyValue label="Descripción" value={demoOrder.code} />
      </Card>
      <Notice icon={Check} title="Puede salir de esta pantalla" tone="valid">
        Le avisamos cuando el banco confirme el pago. Sus entradas aparecerán en su billetera.
      </Notice>
      <Card>
        <h2 className="font-bold">¿Ya pagó y no aparece?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Si pasan 10 minutos, suba el comprobante. Solo nos ayuda a buscar su pago: lo que confirma
          la compra es el aviso del banco.
        </p>
        <Button variant="secondary" className="mt-4 w-full">
          Subir comprobante
        </Button>
      </Card>
      <ButtonLink to="/entradas" variant="secondary" className="w-full">
        Ver mi billetera
      </ButtonLink>
    </div>
  );
}

/** Waiting room shown when demand is high. The position here is simulated. */
export function WaitingRoom() {
  const [position, setPosition] = useState(12);
  useEffect(() => {
    if (position === 0) return;
    const timer = window.setTimeout(() => setPosition(position - 1), 1500);
    return () => window.clearTimeout(timer);
  }, [position]);

  if (position === 0) {
    return (
      <Card className="text-center">
        <ShieldCheck size={40} className="mx-auto text-valid" aria-hidden />
        <h1 className="mt-4 text-2xl font-black">Es su turno</h1>
        <p className="mt-2 text-slate-600">Tiene 10 minutos para elegir sus entradas.</p>
        <ButtonLink to="/comprar" className="mt-6 w-full">
          Comprar entradas
        </ButtonLink>
      </Card>
    );
  }

  const progress = Math.round(((12 - position) / 12) * 100);
  return (
    <Card className="text-center">
      <Users size={40} className="mx-auto text-brand" aria-hidden />
      <h1 className="mt-4 text-2xl font-black">Hay mucha gente comprando</h1>
      <p className="mt-2 text-slate-600">Guardamos su lugar en la fila. No cierre esta página.</p>
      <p className="mt-6 text-sm text-slate-600">Personas antes que usted</p>
      <p aria-live="polite" className="text-5xl font-black">
        {position}
      </p>
      <div
        className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Avance en la fila"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-slate-600">Tiempo estimado: menos de 2 minutos</p>
    </Card>
  );
}
