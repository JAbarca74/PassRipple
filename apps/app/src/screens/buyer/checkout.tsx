import type { PlacedOrder, PublicEvent } from "@passripple/contracts";
import { Check, Clock, Copy, Minus, Plus, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiFailure, api, randomKey, serverNow } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { devicePublicKey, UnsupportedBrowser } from "../../lib/device-key.ts";
import { formatColones, formatCountdown, formatEventDate } from "../../lib/format.ts";
import { findOrder, keepOrder, storedFromPlaced } from "../../lib/orders.ts";
import { bindWallet } from "../../lib/wallet.ts";
import { navigate } from "../../router.tsx";
import { Badge, Button, ButtonLink, Card, Checkbox, Field, Notice, Row } from "../../ui/ui.tsx";

const SITE_URL = import.meta.env.VITE_SITE_URL ?? "http://localhost:5173";

/** A convenience bound of the stepper, not the per-order limit of 9.3 (Phase 6). */
const MAX_PER_ORDER_UI = 10;
/** How often the payment screen asks whether the bank's notice arrived. */
const POLL_MS = 5000;

const AVAILABILITY_LABEL = {
  available: "Disponible",
  few: "Quedan pocas",
  sold_out: "Agotado",
} as const;

/** Messages for the API's error codes, in the buyer's words. */
function checkoutError(error: unknown): string {
  if (error instanceof UnsupportedBrowser) {
    return "Su navegador no puede guardar entradas de forma segura. Actualícelo e intente de nuevo.";
  }
  if (!(error instanceof ApiFailure)) return "Algo salió mal. Intente de nuevo.";
  switch (error.code) {
    case "sold_out":
      return "No quedan suficientes entradas de este tipo.";
    case "terms_changed":
      return "Los términos cambiaron. Revíselos y vuelva a tocar el botón.";
    case "invalid_request":
      return "Revise el correo o teléfono: no parece válido.";
    case "not_found":
      return "Este evento ya no está a la venta.";
    case "not_configured":
      return "La venta no está disponible en este momento. Intente más tarde.";
    default:
      return error.message;
  }
}

function eventSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("evento");
}

/**
 * Three taps (design 10.1): the type and quantity are on this screen with 1 selected (tap 1
 * was "Comprar" on the event's page), the contact field (tap 2), and "Aceptar y pagar con
 * SINPE" (tap 3), which accepts the terms shown right above it.
 */
export function Purchase() {
  const slug = eventSlugFromUrl();
  const [data, setData] = useState<PublicEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [contact, setContact] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a retry after a lost answer reuses it and gets the same order.
  const attempt = useRef<{ key: string; signature: string } | null>(null);

  const load = () => {
    if (!slug) {
      setLoadError("Este enlace no indica un evento.");
      return;
    }
    api<PublicEvent>(`/events/${encodeURIComponent(slug)}`)
      .then((event) => {
        setData(event);
        setTypeId(
          (current) =>
            current ??
            event.ticketTypes.find((type) => type.availability !== "sold_out")?.id ??
            null,
        );
      })
      .catch((failure: unknown) => setLoadError(checkoutError(failure)));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per page.
  useEffect(() => {
    load();
    // The device key is created now, so binding needs no tap after paying (ADR 0032).
    devicePublicKey().catch((failure: unknown) => setError(checkoutError(failure)));
  }, []);

  if (loadError) {
    return (
      <Notice icon={TriangleAlert} title="No pudimos abrir la venta" tone="verify">
        {loadError}
      </Notice>
    );
  }
  if (!data) return <p className="text-slate-600">Cargando…</p>;

  const selected = data.ticketTypes.find((type) => type.id === typeId) ?? null;
  const tickets = (selected?.priceCrc ?? 0) * quantity;
  const serviceCharge = (selected?.serviceChargeCrc ?? 0) * quantity;

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || submitting) return;
    const signature = JSON.stringify([selected.id, quantity, contact.trim(), marketing]);
    if (attempt.current?.signature !== signature) attempt.current = { key: randomKey(), signature };
    const key = attempt.current.key;
    setSubmitting(true);
    setError(null);
    try {
      await devicePublicKey();
      const placed = await api<PlacedOrder>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: {
          eventId: data.event.id,
          ticketTypeId: selected.id,
          quantity,
          contact: contact.trim(),
          termsVersion: data.legal.termsVersion,
          privacyVersion: data.legal.privacyVersion,
          marketing,
        },
      });
      keepOrder(storedFromPlaced(placed, data.event.name));
      navigate(`/pagar?orden=${encodeURIComponent(placed.orderCode)}`);
    } catch (failure) {
      setError(checkoutError(failure));
      if (failure instanceof ApiFailure && failure.code === "terms_changed") load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={pay} className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          {data.event.name} · {formatEventDate(new Date(data.event.startsAt))}
        </p>
        <h1 className="mt-1 text-2xl font-black">Sus entradas</h1>
      </div>

      <Card>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-bold">Tipo de entrada</legend>
          {data.ticketTypes.map((type) => {
            const soldOut = type.availability === "sold_out";
            const active = type.id === selected?.id;
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
                    <span className="text-sm text-slate-600">{formatColones(type.priceCrc)}</span>
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs font-bold",
                    type.availability === "few" ? "text-amber-700" : "text-slate-600",
                  )}
                >
                  {AVAILABILITY_LABEL[type.availability]}
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
              disabled={quantity >= MAX_PER_ORDER_UI}
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
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          hint="Lo usamos solo para entregarle sus entradas y para que pueda recuperarlas."
        />
        <Checkbox
          name="promotions"
          checked={marketing}
          onChange={(event) => setMarketing(event.target.checked)}
          label="Quiero recibir novedades de PassRipple"
        />
      </Card>

      <Card>
        <Row
          label={`${quantity} × ${selected?.name ?? "entrada"}`}
          value={formatColones(tickets)}
        />
        <Row label="Cargo por servicio" value={formatColones(serviceCharge)} />
        <div className="mt-2 border-t border-line pt-2">
          <Row strong label="Total" value={formatColones(tickets + serviceCharge)} />
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
        {error && <p className="mt-3 text-sm font-bold text-red-700">{error}</p>}
        <Button submit className="mt-4 w-full" disabled={!selected || submitting}>
          {submitting ? "Reservando…" : "Aceptar y pagar con SINPE"}
        </Button>
      </Card>
    </form>
  );
}

/** Seconds until a deadline, by the server's clock, ticking every second. */
function useSecondsUntil(deadline: string | null): number {
  const remainingNow = () =>
    deadline ? Math.max(0, Math.round((Date.parse(deadline) - serverNow()) / 1000)) : 0;
  const [remaining, setRemaining] = useState(remainingNow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: remainingNow reads the deadline.
  useEffect(() => {
    setRemaining(remainingNow());
    const timer = window.setInterval(() => setRemaining(remainingNow()), 1000);
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

/**
 * SINPE payment: the exact data to transfer, the hold's countdown, and polling until the
 * bank's notice arrives. When the order is paid the tickets are bound to this device and
 * the wallet opens, with no tap (design 10.1).
 */
export function Payment() {
  const orderCode = new URLSearchParams(window.location.search).get("orden") ?? "";
  const [order] = useState(() => findOrder(orderCode));
  const [status, setStatus] = useState<string>("pending");
  const [expiresAt, setExpiresAt] = useState<string | null>(order?.expiresAt ?? null);
  const remaining = useSecondsUntil(expiresAt);

  useEffect(() => {
    if (!order) return;
    let stopped = false;
    const poll = async () => {
      try {
        const state = await api<{ status: string; expiresAt: string }>("/orders/current", {
          token: order.token,
        });
        if (stopped) return;
        setStatus(state.status);
        setExpiresAt(state.expiresAt);
        if (state.status === "paid") {
          await bindWallet(order.token).catch(() => undefined);
          navigate("/entradas");
          return;
        }
        if (state.status !== "pending") return;
      } catch {
        // No signal: keep asking.
      }
      if (!stopped) window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [order]);

  if (!order) {
    return (
      <Notice icon={TriangleAlert} title="No encontramos esta orden en este teléfono" tone="verify">
        Si compró en otro teléfono, recupere sus entradas desde su billetera.
      </Notice>
    );
  }
  if (status === "expired" || status === "refund_due" || status === "refunded") {
    return (
      <Notice icon={TriangleAlert} title="La reserva venció" tone="verify">
        Pasaron los 30 minutos sin que llegara el pago y las entradas se liberaron. Si ya pagó, el
        dinero se le devuelve: escríbanos con el código {order.orderCode}.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-600">Orden {order.orderCode}</p>
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
        <CopyValue label="Número SINPE" value={order.sinpeNumber} />
        <CopyValue label="Monto exacto" value={formatColones(order.amountCrc)} />
        <CopyValue label="Descripción" value={order.orderCode} />
        {!order.amountUnique && (
          <p className="text-xs text-slate-600">
            Escriba el código en la descripción: es la única forma de reconocer su pago.
          </p>
        )}
      </Card>
      <Notice icon={Check} title="Puede salir de esta pantalla" tone="valid">
        Cuando el banco confirme el pago, sus entradas aparecen en su billetera, ya en este
        teléfono.
      </Notice>
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
