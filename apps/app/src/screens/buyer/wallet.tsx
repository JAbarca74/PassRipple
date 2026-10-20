import type { WalletTicket, WalletView } from "@passripple/contracts";
import {
  ChevronRight,
  Download,
  Link2,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { demoEvent, demoTickets } from "../../demo.ts";
import { ApiFailure, serverNow } from "../../lib/api.ts";
import { formatEventDate } from "../../lib/format.ts";
import { keepOrder, type StoredOrder, storedOrders } from "../../lib/orders.ts";
import {
  bindWallet,
  heldHere,
  presentTicket,
  readWallet,
  requestRecoveryCode,
  verifyRecoveryCode,
} from "../../lib/wallet.ts";
import { Link } from "../../router.tsx";
import { QrCanvas } from "../../ui/QrCanvas.tsx";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Field,
  Notice,
  Row,
  Steps,
} from "../../ui/ui.tsx";

const SITE_URL = import.meta.env.VITE_SITE_URL ?? "http://localhost:5173";
const QR_WINDOW_MS = 30_000;
/** While a paid order has no tickets yet (the queue is issuing them), ask again this often. */
const ISSUING_POLL_MS = 5000;
/** Burst mode shows one ticket per second (6.5). */
const BURST_MS = 1000;

interface WalletEntry {
  readonly order: StoredOrder;
  readonly view: WalletView;
  /** Ticket ids bound to this device. */
  readonly here: ReadonlySet<string>;
}

async function loadEntry(order: StoredOrder): Promise<WalletEntry> {
  let view = await readWallet(order.token);
  // A paid order with tickets not yet on this device: bind them, no tap needed (ADR 0032).
  if (view.order.status === "paid" && view.tickets.some((ticket) => ticket.status === "issued")) {
    view = await bindWallet(order.token);
  }
  const here = new Set<string>();
  for (const ticket of view.tickets) {
    if (ticket.status === "bound" && (await heldHere(ticket.holderKey))) here.add(ticket.id);
  }
  return { order, view, here };
}

/** Every order this device holds, refreshed while some paid order still waits for tickets. */
function useWallet(): { entries: WalletEntry[] | null; error: string | null } {
  const [entries, setEntries] = useState<WalletEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const load = async () => {
      try {
        const loaded = await Promise.all(storedOrders().map(loadEntry));
        if (stopped) return;
        setEntries(loaded);
        setError(null);
        const waiting = loaded.some(
          (entry) => entry.view.order.status === "paid" && entry.view.tickets.length === 0,
        );
        if (waiting) timer = window.setTimeout(load, ISSUING_POLL_MS);
      } catch (failure) {
        if (stopped) return;
        setError(
          failure instanceof ApiFailure ? failure.message : "No pudimos cargar sus entradas.",
        );
        timer = window.setTimeout(load, ISSUING_POLL_MS);
      }
    };
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  return { entries, error };
}

function statusBadge(ticket: WalletTicket, here: boolean) {
  if (ticket.status === "void") return <Badge tone="rejected">Anulada</Badge>;
  if (ticket.status === "issued") return <Badge tone="verify">Preparando</Badge>;
  if (!here) return <Badge tone="verify">En otro teléfono</Badge>;
  return <Badge tone="valid">Activa</Badge>;
}

export function Wallet() {
  const { entries, error } = useWallet();
  if (entries === null) {
    return error ? (
      <Notice icon={TriangleAlert} title="Sin conexión" tone="verify">
        {error}
      </Notice>
    ) : (
      <p className="text-slate-600">Cargando sus entradas…</p>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black">Mis entradas</h1>
        <Card>
          <p className="text-slate-600">Este teléfono todavía no tiene entradas.</p>
          <Link to="/recuperar" className="mt-3 block min-h-11 py-3 text-sm font-bold text-brand">
            ¿Compró en otro teléfono? Recupere sus entradas
          </Link>
        </Card>
      </div>
    );
  }
  const elsewhere = entries.some((entry) =>
    entry.view.tickets.some((ticket) => ticket.status === "bound" && !entry.here.has(ticket.id)),
  );
  return (
    <div className="space-y-4">
      {entries.map(({ order, view, here }) => (
        <div key={order.orderCode} className="space-y-3">
          <div className="rounded-2xl bg-ink p-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-300">Su billetera · Orden {order.orderCode}</p>
                <h1 className="mt-1 text-xl font-black">{view.event?.name ?? order.eventName}</h1>
                {view.event && (
                  <p className="mt-1 text-sm text-slate-300">
                    {formatEventDate(new Date(view.event.startsAt))}
                  </p>
                )}
              </div>
              <WalletCards className="text-wave" aria-hidden />
            </div>
          </div>
          {view.order.status === "pending" && (
            <ButtonLink
              to={`/pagar?orden=${encodeURIComponent(order.orderCode)}`}
              variant="secondary"
              className="w-full"
            >
              Esperando el pago · ver datos para pagar
            </ButtonLink>
          )}
          {view.order.status === "paid" && view.tickets.length === 0 && (
            <Notice icon={ShieldCheck} title="Pago confirmado" tone="valid">
              Estamos emitiendo sus entradas. Aparecen aquí en un momento.
            </Notice>
          )}
          {view.tickets.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/entradas/abierta?orden=${encodeURIComponent(order.orderCode)}&entrada=${ticket.id}`}
              className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm hover:border-brand"
            >
              <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-slate-100">
                <QrCode size={30} aria-hidden />
              </span>
              <span className="flex-1">
                {statusBadge(ticket, here.has(ticket.id))}
                <span className="mt-1 block font-black">Entrada {ticket.typeName}</span>
                <span className="font-mono text-sm text-slate-600">{ticket.humanCode}</span>
              </span>
              <ChevronRight className="text-slate-400" aria-hidden />
            </Link>
          ))}
          {here.size > 1 && (
            <ButtonLink
              to={`/entradas/abierta?orden=${encodeURIComponent(order.orderCode)}`}
              variant="secondary"
              className="w-full"
            >
              Mostrar todas en la puerta ({here.size})
            </ButtonLink>
          )}
        </div>
      ))}

      {elsewhere && (
        <Notice icon={Smartphone} title="Hay entradas vinculadas a otro teléfono" tone="verify">
          Si cambió de teléfono,{" "}
          <Link to="/recuperar" className="font-bold underline">
            páselas a este
          </Link>
          .
        </Notice>
      )}

      <Notice icon={Smartphone} title="Instale PassRipple en su teléfono">
        En iPhone: Compartir → Agregar a inicio. En Android: menú → Instalar app. Sus entradas
        quedan a un toque, incluso sin señal.
      </Notice>

      <div className="flex flex-col gap-2 text-sm font-bold text-brand">
        <Link to="/recuperar" className="min-h-11 py-3">
          ¿Cambió de teléfono? Recupere sus entradas
        </Link>
        <Link to="/mis-datos" className="min-h-11 py-3">
          Mis datos y preferencias
        </Link>
      </div>
    </div>
  );
}

/** Milliseconds left in the current QR window, by the server's clock. */
function windowLeft(): number {
  return QR_WINDOW_MS - (serverNow() % QR_WINDOW_MS);
}

/** Re-renders at every QR window and every second, for the countdown ring. */
function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/**
 * An open ticket: the QR is signed again for every 30-second window with the device key;
 * the static code is the fallback. Without `entrada`, burst mode: every ticket of the order
 * held here, one per second (6.5).
 */
export function TicketView() {
  const params = new URLSearchParams(window.location.search);
  const orderCode = params.get("orden") ?? "";
  const ticketId = params.get("entrada");
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const seconds = useTick(1000);
  const burst = useTick(BURST_MS);

  useEffect(() => {
    const order = storedOrders().find((stored) => stored.orderCode === orderCode);
    if (!order) {
      setFailed(true);
      return;
    }
    loadEntry(order)
      .then(setEntry)
      .catch(() => setFailed(true));
  }, [orderCode]);

  const shown = entry
    ? entry.view.tickets.filter((ticket) =>
        ticketId ? ticket.id === ticketId : entry.here.has(ticket.id),
      )
    : [];
  const ticket = shown.length > 0 ? shown[burst % shown.length] : undefined;
  const windowIndex = Math.floor(serverNow() / QR_WINDOW_MS);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signs again on every window.
  useEffect(() => {
    if (!entry || !ticket?.certificate || !entry.here.has(ticket.id)) {
      setQr(null);
      return;
    }
    let current = true;
    presentTicket(entry.view, ticket.certificate).then((text) => {
      if (current) setQr(text);
    });
    return () => {
      current = false;
    };
  }, [entry, ticket?.id, windowIndex]);

  if (failed) {
    return (
      <Notice
        icon={TriangleAlert}
        title="No encontramos esta entrada en este teléfono"
        tone="verify"
      >
        <Link to="/recuperar" className="font-bold underline">
          Recupere sus entradas
        </Link>{" "}
        si compró en otro teléfono.
      </Notice>
    );
  }
  if (!entry || !ticket) return <p className="text-slate-600">Cargando…</p>;

  const here = entry.here.has(ticket.id);
  const remaining = Math.ceil(windowLeft() / 1000);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  void seconds;
  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-ink p-4 shadow-xl">
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between text-xs font-black">
            <span>{(entry.view.event?.name ?? "").toUpperCase()}</span>
            {statusBadge(ticket, here)}
          </div>
          <div className="my-6 grid min-h-72 place-items-center">
            {qr ? (
              <QrCanvas text={qr} label="Código QR de la entrada" />
            ) : (
              <p className="text-center text-sm text-slate-600">
                {here
                  ? "Preparando el código…"
                  : "Esta entrada está vinculada a otro teléfono. Recupérela para usarla aquí."}
              </p>
            )}
          </div>
          <p className="text-xs font-bold text-slate-600">
            ENTRADA {ticket.typeName.toUpperCase()}
            {shown.length > 1 && ` · ${(burst % shown.length) + 1} de ${shown.length}`}
          </p>
          {entry.view.event && (
            <p className="mt-1 text-sm text-slate-600">
              {formatEventDate(new Date(entry.view.event.startsAt))}
            </p>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <Row
              label="Código de respaldo"
              value={<span className="font-mono">{ticket.humanCode}</span>}
            />
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 py-4 text-sm text-slate-300">
          <svg viewBox="0 0 100 100" className="size-7 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#334155" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="var(--color-wave)"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - remaining / 30)}
              strokeLinecap="round"
            />
          </svg>
          <span aria-live="off">El código cambia en {remaining} s</span>
        </div>
      </div>
      <Notice icon={ShieldCheck} title="Una captura de pantalla no sirve">
        El código cambia cada 30 segundos y se usa una sola vez. Muestre esta pantalla en la puerta.
      </Notice>
    </div>
  );
}

/** Free transfer through a private link (6.6). Demonstration data: transfers arrive later. */
export function Transfer() {
  const ticket = demoTickets[1];
  const [link, setLink] = useState<string | null>(null);
  const message = encodeURIComponent(`Le paso una entrada para ${demoEvent.name}: ${link ?? ""}`);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Transferir entrada</h1>
      <Card>
        <Row label="Entrada" value={`${ticket.type} · ${ticket.holder}`} />
        <Row label="Costo" value="Sin cobro" />
        <p className="mt-3 text-sm text-slate-600">
          Al recibirla, la entrada queda en el teléfono de la otra persona y deja de funcionar en el
          suyo.
        </p>
        {link ? (
          <div className="mt-4 space-y-3">
            <p className="break-all rounded-xl bg-slate-50 p-4 font-mono text-sm">{link}</p>
            <a
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-valid px-5 font-bold text-white"
              href={`https://wa.me/?text=${message}`}
              target="_blank"
              rel="noreferrer"
            >
              Enviar por WhatsApp
            </a>
          </div>
        ) : (
          <Button
            className="mt-4 w-full"
            onClick={() => setLink("https://app.passripple.example/r/demo")}
          >
            <Link2 size={17} aria-hidden /> Crear enlace privado
          </Button>
        )}
      </Card>
      <Card>
        <h2 className="font-bold">Así lo ve quien la recibe</h2>
        <p className="mt-1 text-sm text-slate-600">
          {ticket.holder} le pasó una entrada General para {demoEvent.name}.
        </p>
        <Button variant="brand" className="mt-4 w-full" disabled>
          Recibir en este teléfono
        </Button>
      </Card>
    </div>
  );
}

/**
 * Recovery on a new phone (6.6, ADR 0036): the email of the order, a code sent to it, and
 * the tickets move to this device. The old phone can no longer show them.
 */
export function Recover() {
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(0);

  const message = (failure: unknown) => {
    if (failure instanceof ApiFailure) {
      if (failure.code === "contact_channel_unavailable") {
        return "Todavía no podemos enviar códigos a un teléfono. Escríbanos para recuperar sus entradas.";
      }
      if (failure.code === "invalid_code") return "El código no es correcto o ya venció.";
      if (failure.code === "rate_limited") return "Pidió demasiados códigos. Espere unos minutos.";
      return failure.message;
    }
    return "Algo salió mal. Intente de nuevo.";
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestRecoveryCode(contact.trim());
      setStep(1);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { orders } = await verifyRecoveryCode(contact.trim(), code.trim());
      let count = 0;
      for (const recovered of orders) {
        const view = await bindWallet(recovered.token);
        keepOrder({
          token: recovered.token,
          orderCode: recovered.orderCode,
          amountCrc: view.order.amountCrc,
          amountUnique: false,
          sinpeNumber: "",
          expiresAt: view.order.expiresAt,
          eventName: view.event?.name ?? "",
        });
        count += view.tickets.filter((ticket) => ticket.status === "bound").length;
      }
      setMoved(count);
      setStep(2);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Recuperar mis entradas</h1>
      <Notice icon={Smartphone} title="¿Cambió de teléfono?" tone="verify">
        Pasamos sus entradas a este teléfono. El anterior deja de poder usarlas.
      </Notice>
      <Steps steps={["Contacto", "Código", "Listo"]} current={step} />
      <Card>
        {step === 0 && (
          <form onSubmit={ask} className="space-y-4">
            <Field
              label="Correo con que compró"
              required
              autoComplete="email"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
            {error && <p className="text-sm font-bold text-red-700">{error}</p>}
            <Button submit className="w-full" disabled={busy}>
              Enviarme un código
            </Button>
          </form>
        )}
        {step === 1 && (
          <form onSubmit={verify} className="space-y-4">
            <Field
              label="Código de 6 dígitos"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              hint="Si el correo tiene compras, le llegó un código. Vence en 10 minutos."
            />
            {error && <p className="text-sm font-bold text-red-700">{error}</p>}
            <Button submit className="w-full" disabled={busy}>
              Recuperar
            </Button>
          </form>
        )}
        {step === 2 && (
          <div className="text-center">
            <ShieldCheck size={40} className="mx-auto text-valid" aria-hidden />
            <p className="mt-3 font-black">
              {moved > 0
                ? `${moved === 1 ? "Su entrada está" : `Sus ${moved} entradas están`} en este teléfono`
                : "No encontramos entradas pagadas con ese correo"}
            </p>
            <p className="mt-1 text-sm text-slate-600">El teléfono anterior ya no puede usarlas.</p>
            <ButtonLink to="/entradas" className="mt-5 w-full">
              Ver mis entradas
            </ButtonLink>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Named attendee for 18+ events: the gate checks the document against this name. */
export function AssignAttendee() {
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <h1 className="text-2xl font-black">Asignar asistente</h1>
      <p className="text-slate-600">
        Este evento es para mayores de 18. En la puerta se revisa el documento de quien entra.
      </p>
      <Card className="space-y-4">
        <Field label="Nombre completo" required autoComplete="name" />
        <div>
          <label htmlFor="document-type" className="block text-sm font-bold">
            Tipo de documento
          </label>
          <select
            id="document-type"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4"
          >
            <option>Cédula</option>
            <option>DIMEX</option>
            <option>Pasaporte</option>
            <option>TIM</option>
          </select>
        </div>
        <Field label="Número de documento" required />
        <p className="text-xs leading-5 text-slate-600">
          Usamos estos datos solo para el control de edad de este evento y los borramos cuando
          termina el plazo de conservación.
        </p>
        <Button submit className="w-full">
          Guardar asistente
        </Button>
      </Card>
    </form>
  );
}

/** The buyer's own data. Demonstration data except erasure, which is /eliminar-datos (14.7). */
export function MyData() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Mis datos</h1>
      <Card>
        <Row label="Contacto" value="a•••@correo.com" />
        <Row label="Órdenes" value="1" />
      </Card>
      <Card>
        <h2 className="font-bold">Descargar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Un archivo con todo lo que guardamos sobre usted.
        </p>
        <Button variant="secondary" className="mt-4 w-full">
          <Download size={17} aria-hidden /> Descargar
        </Button>
      </Card>
      <Card>
        <h2 className="font-bold">Preferencias</h2>
        <Checkbox label="Recibir novedades de PassRipple" />
      </Card>
      <Card>
        <h2 className="font-bold">Eliminar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tiene entradas para un evento que todavía no ocurre. Puede transferirlas antes, o eliminar
          sus datos cuando el evento termine.
        </p>
        <a
          href={`${SITE_URL}/eliminar-datos`}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-5 font-bold text-red-700 hover:bg-red-50"
        >
          <Trash2 size={17} aria-hidden /> Eliminar mis datos
        </a>
      </Card>
    </div>
  );
}
