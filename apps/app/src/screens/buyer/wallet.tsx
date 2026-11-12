import type {
  AttendeeDocType,
  BuyerExport,
  TransferPreview,
  WalletTicket,
  WalletView,
} from "@passripple/contracts";
import {
  ChevronRight,
  Download,
  Link2,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserRoundPen,
  WalletCards,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiFailure, serverNow } from "../../lib/api.ts";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { keepOrder, type StoredOrder, storedOrders } from "../../lib/orders.ts";
import {
  assignAttendee,
  bindHeld,
  cancelTransfer,
  claimTransfer,
  type HeldTicket,
  heldTickets,
  offerTransfer,
  previewTransfer,
  readHeld,
  transferLink,
} from "../../lib/transfers.ts";
import {
  bindWallet,
  heldHere,
  presentTicket,
  readPreferences,
  readWallet,
  requestExportCode,
  requestRecoveryCode,
  saveExport,
  savePreferences,
  verifyExportCode,
  verifyRecoveryCode,
} from "../../lib/wallet.ts";
import { Link, navigate } from "../../router.tsx";
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

/** What the wallet shows for an order, or for one ticket received by transfer (6.6). */
interface WalletEntry {
  /** The query that opens it: `orden=…` or `recibida=…`. */
  readonly query: string;
  /** The order's or the receiver's token. */
  readonly token: string;
  readonly label: string;
  readonly eventName: string;
  readonly order: StoredOrder | null;
  readonly view: Pick<WalletView, "event" | "serverKeys" | "tickets"> & {
    readonly order: WalletView["order"] | null;
  };
  /** Ticket ids bound to this device. */
  readonly here: ReadonlySet<string>;
}

async function boundHere(tickets: readonly WalletTicket[]): Promise<Set<string>> {
  const here = new Set<string>();
  for (const ticket of tickets) {
    if (ticket.status === "bound" && (await heldHere(ticket.holderKey))) here.add(ticket.id);
  }
  return here;
}

async function loadEntry(order: StoredOrder): Promise<WalletEntry> {
  let view = await readWallet(order.token);
  // A paid order with tickets not yet on this device: bind them, no tap needed (ADR 0032).
  if (view.order.status === "paid" && view.tickets.some((ticket) => ticket.status === "issued")) {
    view = await bindWallet(order.token);
  }
  return {
    query: `orden=${encodeURIComponent(order.orderCode)}`,
    token: order.token,
    label: `Orden ${order.orderCode}`,
    eventName: order.eventName,
    order,
    view,
    here: await boundHere(view.tickets),
  };
}

async function loadHeldEntry(held: HeldTicket): Promise<WalletEntry> {
  const { event, serverKeys, ticket } = await readHeld(held.token);
  return {
    query: `recibida=${encodeURIComponent(held.code)}`,
    token: held.token,
    label: "Recibida por transferencia",
    eventName: held.eventName,
    order: null,
    view: { order: null, event, serverKeys, tickets: [ticket] },
    here: await boundHere([ticket]),
  };
}

/** The entry a ticket screen's query names, or null. */
function findEntry(params: URLSearchParams): Promise<WalletEntry> | null {
  const orderCode = params.get("orden");
  const order = orderCode ? storedOrders().find((o) => o.orderCode === orderCode) : undefined;
  if (order) return loadEntry(order);
  const heldCode = params.get("recibida");
  const held = heldCode ? heldTickets().find((h) => h.code === heldCode) : undefined;
  return held ? loadHeldEntry(held) : null;
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
        const loaded = await Promise.all([
          ...storedOrders().map(loadEntry),
          ...heldTickets().map(loadHeldEntry),
        ]);
        if (stopped) return;
        setEntries(loaded);
        setError(null);
        const waiting = loaded.some(
          (entry) => entry.view.order?.status === "paid" && entry.view.tickets.length === 0,
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
  if (!here && ticket.transferred) return <Badge tone="verify">Transferida</Badge>;
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
    entry.view.tickets.some(
      (ticket) => ticket.status === "bound" && !ticket.transferred && !entry.here.has(ticket.id),
    ),
  );
  return (
    <div className="space-y-4">
      {entries.map(({ query, label, eventName, order, view, here }) => (
        <div key={query} className="space-y-3">
          <div className="rounded-2xl bg-ink p-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-300">Su billetera · {label}</p>
                <h1 className="mt-1 text-xl font-black">{view.event?.name ?? eventName}</h1>
                {view.event && (
                  <p className="mt-1 text-sm text-slate-300">
                    {formatEventDate(new Date(view.event.startsAt))}
                  </p>
                )}
              </div>
              <WalletCards className="text-wave" aria-hidden />
            </div>
          </div>
          {order && view.order?.status === "pending" && (
            <ButtonLink
              to={`/pagar?orden=${encodeURIComponent(order.orderCode)}`}
              variant="secondary"
              className="w-full"
            >
              Esperando el pago · ver datos para pagar
            </ButtonLink>
          )}
          {view.order?.status === "paid" && view.tickets.length === 0 && (
            <Notice icon={ShieldCheck} title="Pago confirmado" tone="valid">
              Estamos emitiendo sus entradas. Aparecen aquí en un momento.
            </Notice>
          )}
          {view.tickets.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/entradas/abierta?${query}&entrada=${ticket.id}`}
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
            <ButtonLink to={`/entradas/abierta?${query}`} variant="secondary" className="w-full">
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
  const search = window.location.search;
  const ticketId = new URLSearchParams(search).get("entrada");
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const seconds = useTick(1000);
  const burst = useTick(BURST_MS);

  useEffect(() => {
    const loading = findEntry(new URLSearchParams(search));
    if (!loading) {
      setFailed(true);
      return;
    }
    loading.then(setEntry).catch(() => setFailed(true));
  }, [search]);

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
                  : ticket.transferred
                    ? "Esta entrada se transfirió a otra persona."
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
      {ticket.named && shown.length === 1 && (
        <Card>
          <Row
            label="Asistente"
            value={
              ticket.attendee
                ? `${ticket.attendee.fullName} · …${ticket.attendee.docLast4}`
                : "Sin asignar"
            }
          />
          {here && canAssign(entry, ticket) && (
            <ButtonLink
              to={`/asignar?${entry.query}&entrada=${ticket.id}`}
              variant="secondary"
              className="mt-3 w-full"
            >
              <UserRoundPen size={17} aria-hidden />{" "}
              {ticket.attendee ? "Cambiar asistente" : "Asignar asistente"}
            </ButtonLink>
          )}
        </Card>
      )}
      {here && shown.length === 1 && canTransfer(entry, ticket) && (
        <ButtonLink
          to={`/transferir?${entry.query}&entrada=${ticket.id}`}
          variant="secondary"
          className="w-full"
        >
          <Link2 size={17} aria-hidden /> Transferir a otra persona
        </ButtonLink>
      )}
    </div>
  );
}

/** The attendee of a ticket held here may be named until its event starts (7.3). */
function canAssign(entry: WalletEntry, ticket: WalletTicket): boolean {
  const startsAt = entry.view.event ? Date.parse(entry.view.event.startsAt) : 0;
  return ticket.named && ticket.status === "bound" && startsAt > serverNow();
}

/** A ticket held here may be given away before its event, while it has rebindings left. */
function canTransfer(entry: WalletEntry, ticket: WalletTicket): boolean {
  const startsAt = entry.view.event ? Date.parse(entry.view.event.startsAt) : 0;
  return ticket.status === "bound" && ticket.keyVersion < 6 && startsAt > serverNow();
}

/**
 * Free transfer through a private link (6.6). The phone holding the ticket signs the offer;
 * whoever opens the link receives the ticket on their own phone, and it stops working here.
 */
export function Transfer() {
  const search = window.location.search;
  const ticketId = new URLSearchParams(search).get("entrada");
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState<{ link: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loading = findEntry(new URLSearchParams(search));
    if (!loading) {
      setFailed(true);
      return;
    }
    loading.then(setEntry).catch(() => setFailed(true));
  }, [search]);

  const ticket = entry?.view.tickets.find((t) => t.id === ticketId);
  if (failed || (entry && (!ticket || !entry.here.has(ticket.id)))) {
    return (
      <Notice icon={TriangleAlert} title="Esta entrada no está en este teléfono" tone="verify">
        Solo el teléfono que tiene la entrada puede transferirla.
      </Notice>
    );
  }
  if (!entry || !ticket) return <p className="text-slate-600">Cargando…</p>;

  const eventName = entry.view.event?.name ?? entry.eventName;
  const failure = (caught: unknown) =>
    caught instanceof ApiFailure ? caught.message : "No pudimos crear el enlace. Intente de nuevo.";
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const offered = await offerTransfer(entry.token, ticket.id, ticket.keyVersion);
      setOffer({ link: transferLink(offered.offerToken), expiresAt: offered.expiresAt });
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelTransfer(entry.token, ticket.id, ticket.keyVersion);
      setOffer(null);
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  };
  const message = encodeURIComponent(
    `Le paso una entrada para ${eventName}. Ábrala en su teléfono: ${offer?.link ?? ""}`,
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Transferir entrada</h1>
      <Card>
        <Row label="Evento" value={eventName} />
        <Row label="Entrada" value={`${ticket.typeName} · ${ticket.humanCode}`} />
        <Row label="Costo" value="Sin cobro" />
        <p className="mt-3 text-sm text-slate-600">
          Al recibirla, la entrada queda en el teléfono de la otra persona y deja de funcionar en el
          suyo. No se puede recuperar después.
        </p>
        {error && <p className="mt-3 text-sm font-bold text-red-700">{error}</p>}
        {offer ? (
          <div className="mt-4 space-y-3">
            <p className="break-all rounded-xl bg-slate-50 p-4 font-mono text-sm">{offer.link}</p>
            <p className="text-sm text-slate-600">
              Envíelo solo a quien va a recibir la entrada. Sirve una sola vez, hasta el{" "}
              {formatEventDate(new Date(offer.expiresAt))}
            </p>
            <a
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-valid px-5 font-bold text-white"
              href={`https://wa.me/?text=${message}`}
              target="_blank"
              rel="noreferrer"
            >
              Enviar por WhatsApp
            </a>
            <Button variant="secondary" className="w-full" disabled={busy} onClick={cancel}>
              Anular el enlace
            </Button>
          </div>
        ) : (
          <Button className="mt-4 w-full" disabled={busy} onClick={create}>
            <Link2 size={17} aria-hidden /> {busy ? "Creando…" : "Crear enlace privado"}
          </Button>
        )}
      </Card>
    </div>
  );
}

/** The receiver's side of a transfer: what the link offers, then the ticket on this phone. */
export function Receive() {
  const [offerToken] = useState(() => window.location.hash.slice(1));
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!offerToken) {
      setError("Este enlace está incompleto. Pida a quien se lo envió que lo copie de nuevo.");
      return;
    }
    previewTransfer(offerToken)
      .then(setPreview)
      .catch((caught) =>
        setError(
          caught instanceof ApiFailure && caught.status === 404
            ? "Este enlace no existe. Pida a quien se lo envió uno nuevo."
            : "No pudimos abrir el enlace. Revise su señal e intente de nuevo.",
        ),
      );
  }, [offerToken]);

  const receive = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await claimTransfer(offerToken, preview.eventName, email.trim() || undefined);
      // The secret is spent: keep it out of the history.
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/entradas");
    } catch (caught) {
      setError(
        caught instanceof ApiFailure && caught.status === 409
          ? "Este enlace ya no sirve: se usó, se anuló o venció."
          : caught instanceof ApiFailure && caught.status === 400 && email.trim()
            ? "Revise el correo: no parece una dirección válida."
            : caught instanceof ApiFailure
              ? caught.message
              : "No pudimos recibir la entrada. Intente de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return error ? (
      <Notice icon={TriangleAlert} title="No se puede recibir" tone="verify">
        {error}
      </Notice>
    ) : (
      <p className="text-slate-600">Abriendo el enlace…</p>
    );
  }
  const closed = {
    claimed: "Esta entrada ya se recibió en otro teléfono.",
    cancelled: "Quien le envió el enlace lo anuló.",
    expired: "Este enlace venció. Pida uno nuevo.",
    open: null,
  }[preview.state];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Recibir entrada</h1>
      <Card>
        <p className="text-sm text-slate-600">Le pasaron una entrada para</p>
        <h2 className="mt-1 text-xl font-black">{preview.eventName}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {preview.venueName} · {formatEventDate(new Date(preview.startsAt))}
        </p>
        <div className="mt-3">
          <Row label="Entrada" value={preview.typeName} />
          <Row label="Costo" value="Sin cobro" />
        </div>
        {error && <p className="mt-3 text-sm font-bold text-red-700">{error}</p>}
        {closed ? (
          <Notice icon={TriangleAlert} title="Este enlace ya no sirve" tone="verify">
            {closed}
          </Notice>
        ) : (
          <div className="mt-4 space-y-4">
            <Field
              label="Su correo (opcional)"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hint="Con él puede recuperar la entrada si cambia de teléfono. Sin correo, solo vive en este teléfono."
            />
            <Button variant="brand" className="w-full" disabled={busy} onClick={receive}>
              {busy ? "Recibiendo…" : "Recibir en este teléfono"}
            </Button>
          </div>
        )}
      </Card>
      <Notice icon={ShieldCheck} title="Queda solo en este teléfono">
        La entrada se liga a este teléfono. Instale PassRipple en la pantalla de inicio para no
        perderla.
      </Notice>
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
      const { orders, held } = await verifyRecoveryCode(contact.trim(), code.trim());
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
      for (const received of held) {
        const view = await bindHeld(received.token, received.eventName);
        if (view.ticket.status === "bound") count += 1;
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
              hint="Si el correo tiene compras o entradas recibidas, le llegó un código. Vence en 10 minutos."
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
                : "No encontramos entradas con ese correo"}
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

const DOC_TYPE_LABEL: Record<AttendeeDocType, string> = {
  cedula: "Cédula",
  dimex: "DIMEX",
  pasaporte: "Pasaporte",
  tim: "TIM (menores)",
};

/** Messages for the attendee route's errors, in the buyer's words. */
function attendeeError(caught: unknown): string {
  if (!(caught instanceof ApiFailure)) return "No pudimos guardar el asistente. Intente de nuevo.";
  switch (caught.code) {
    case "invalid_document":
      return "Revise el número: no parece un documento de ese tipo.";
    case "not_open":
      return "El evento ya empezó: el asistente se registra en la puerta.";
    case "not_holder":
      return "Solo el teléfono que tiene la entrada puede asignar el asistente.";
    default:
      return caught.message;
  }
}

/**
 * Named attendee (design 7.3): who will use a ticket of a 12+ or 18+ event. The gate shows
 * this name and the document's last digits, and checks them against the document itself.
 */
export function AssignAttendee() {
  const search = window.location.search;
  const ticketId = new URLSearchParams(search).get("entrada");
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [docType, setDocType] = useState<AttendeeDocType>("cedula");
  const [docNumber, setDocNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loading = findEntry(new URLSearchParams(search));
    if (!loading) {
      setFailed(true);
      return;
    }
    loading
      .then((found) => {
        setEntry(found);
        const current = found.view.tickets.find((t) => t.id === ticketId)?.attendee;
        if (current) {
          setFullName(current.fullName);
          setDocType(current.docType);
        }
      })
      .catch(() => setFailed(true));
  }, [search, ticketId]);

  const ticket = entry?.view.tickets.find((t) => t.id === ticketId);
  if (failed || (entry && (!ticket?.named || !entry.here.has(ticket.id)))) {
    return (
      <Notice icon={TriangleAlert} title="No se puede asignar aquí" tone="verify">
        Solo el teléfono que tiene una entrada nominativa puede asignar su asistente.
      </Notice>
    );
  }
  if (!entry || !ticket) return <p className="text-slate-600">Cargando…</p>;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await assignAttendee(entry.token, ticket.id, ticket.keyVersion, {
        fullName,
        docType,
        docNumber,
      });
      navigate(`/entradas/abierta?${entry.query}&entrada=${ticket.id}`);
    } catch (caught) {
      setError(attendeeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={save}>
      <h1 className="text-2xl font-black">Asignar asistente</h1>
      <p className="text-slate-600">
        {entry.view.event?.name ?? entry.eventName}: en la puerta se revisa el documento de quien
        entra contra este nombre.
      </p>
      <Card className="space-y-4">
        <Row label="Entrada" value={`${ticket.typeName} · ${ticket.humanCode}`} />
        <Field
          label="Nombre completo"
          required
          autoComplete="name"
          minLength={2}
          maxLength={120}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <div>
          <label htmlFor="document-type" className="block text-sm font-bold">
            Tipo de documento
          </label>
          <select
            id="document-type"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4"
            value={docType}
            onChange={(event) => setDocType(event.target.value as AttendeeDocType)}
          >
            {Object.entries(DOC_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Número de documento"
          required
          inputMode={docType === "pasaporte" ? "text" : "numeric"}
          autoComplete="off"
          maxLength={40}
          value={docNumber}
          onChange={(event) => setDocNumber(event.target.value)}
          {...(ticket.attendee && {
            hint: `Hoy: ${ticket.attendee.fullName}, documento terminado en ${ticket.attendee.docLast4}. Escriba el número de nuevo para cambiarlo.`,
          })}
        />
        <p className="text-xs leading-5 text-slate-600">
          Usamos estos datos solo para el control de edad de este evento. Guardamos el número
          cifrado y lo borramos cuando termina el plazo de conservación; la puerta solo ve los
          últimos dígitos.
        </p>
        {error && <p className="text-sm font-bold text-red-700">{error}</p>}
        <Button submit className="w-full" disabled={busy}>
          {busy ? "Guardando…" : "Guardar asistente"}
        </Button>
      </Card>
    </form>
  );
}

/**
 * The news choice (14.4), with the newest order this phone holds: it applies to every order
 * of the same contact. Hidden when the phone holds no order or the link no longer works.
 */
function NewsPreference() {
  const [token] = useState(() => storedOrders()[0]?.token ?? null);
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "hidden">(
    token ? "loading" : "hidden",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    readPreferences(token)
      .then((read) => {
        setMarketing(read.marketing);
        setState("ready");
      })
      .catch(() => setState("hidden"));
  }, [token]);

  if (!token || state === "hidden") return null;

  const change = async (next: boolean) => {
    setState("saving");
    setError(null);
    try {
      setMarketing((await savePreferences(token, next)).marketing);
      setState("saved");
    } catch {
      setError("No pudimos guardar su preferencia. Intente de nuevo.");
      setState("ready");
    }
  };

  return (
    <Card>
      <h2 className="font-bold">Preferencias</h2>
      <Checkbox
        label="Recibir novedades de PassRipple"
        checked={marketing === true}
        disabled={state === "loading" || state === "saving"}
        onChange={(event) => change(event.target.checked)}
      />
      <p className="text-xs text-slate-600">
        {state === "saved"
          ? "Guardado. Vale para todas sus compras con el mismo contacto."
          : "Vale para todas sus compras con el mismo contacto. Puede cambiarlo cuando quiera."}
      </p>
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
    </Card>
  );
}

/**
 * The buyer's own data (14.7): the order's email proves it with a code, as in recovery, and
 * the answer is everything kept about that address, shown in short and saved as a file.
 * Erasure is the public /eliminar-datos page.
 */
export function MyData() {
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BuyerExport | null>(null);

  const message = (failure: unknown) => {
    if (failure instanceof ApiFailure) {
      if (failure.code === "contact_channel_unavailable") {
        return "Todavía no podemos enviar códigos a un teléfono. Escríbanos para pedir sus datos.";
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
      await requestExportCode(contact.trim());
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
      setData(await verifyExportCode(contact.trim(), code.trim()));
      setStep(2);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const tickets = data?.orders.reduce((sum, order) => sum + order.tickets.length, 0) ?? 0;
  const marketing = data?.orders
    .flatMap((order) => order.consents)
    .filter((consent) => consent.purpose === "marketing")
    .at(-1);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Mis datos</h1>
      <Card>
        <h2 className="font-bold">Descargar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Un archivo con todo lo que guardamos sobre usted. Le enviamos un código al correo con que
          compró para confirmar que es usted.
        </p>
        <div className="mt-4">
          <Steps steps={["Correo", "Código", "Listo"]} current={step} />
        </div>
        {step === 0 && (
          <form onSubmit={ask} className="mt-4 space-y-4">
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
          <form onSubmit={verify} className="mt-4 space-y-4">
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
              Ver mis datos
            </Button>
          </form>
        )}
        {step === 2 && data && (
          <div className="mt-4">
            <Row label="Correo" value={data.contact.email} />
            <Row label="Órdenes" value={String(data.orders.length)} />
            <Row label="Entradas" value={String(tickets)} />
            <Row
              label="Novedades de PassRipple"
              value={
                marketing ? (marketing.granted ? "Aceptadas" : "No aceptadas") : "Sin registro"
              }
            />
            {data.orders.map((order) => (
              <p key={order.orderCode} className="mt-2 text-sm text-slate-600">
                {order.event.name} · {formatColones(order.amountCrc)} · orden {order.orderCode}
              </p>
            ))}
            <Button variant="secondary" className="mt-4 w-full" onClick={() => saveExport(data)}>
              <Download size={17} aria-hidden /> Descargar archivo
            </Button>
          </div>
        )}
      </Card>
      <NewsPreference />
      <Card>
        <h2 className="font-bold">Eliminar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Si tiene entradas para un evento que todavía no ocurre, puede transferirlas antes, o
          eliminar sus datos cuando el evento termine.
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
