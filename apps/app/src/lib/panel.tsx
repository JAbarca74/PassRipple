// The session of the organizer and administration panels: a sign-in code to the email,
// then a bearer token kept in sessionStorage, so closing the tab signs out. /account/me says
// whether the person is a platform administrator and which organizations they act for; an
// organizer's calls carry the chosen one in X-Org-Id, and the server checks membership.

import type { SessionProfile, SignInResponse, UserSession } from "@passripple/contracts";
import { LogIn, Mail } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button, Card, Field, Notice, PageHeader } from "../ui/ui.tsx";
import { ApiFailure, api } from "./api.ts";

const TOKEN_KEY = "passripple.panel.token";
const ORG_KEY = "passripple.panel.org";

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode without storage: the session lasts as long as the page.
  }
}

export type PanelRole = "organizer" | "admin" | "municipal";

interface Panel {
  readonly profile: SessionProfile;
  /** The organization an organizer acts for now; null for an administrator. */
  readonly orgId: string | null;
  readonly setOrgId: (orgId: string) => void;
  readonly signOut: () => void;
  /** Calls the API as this session (and organization, for an organizer). */
  readonly call: <T>(
    path: string,
    options?: { method?: "GET" | "POST"; body?: unknown },
  ) => Promise<T>;
}

const PanelContext = createContext<Panel | null>(null);

export function usePanel(): Panel {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error("usePanel outside PanelGate");
  return panel;
}

/** Spanish text for an API failure a panel can show. */
export function failureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === "conflict")
      return "No se puede: el saldo o el estado del evento no lo permite.";
    if (error.code === "not_open") return "Esto ya no se puede hacer en este momento.";
    if (error.code === "forbidden") return "Su cuenta no tiene permiso para esto.";
    if (error.code === "invalid_request") return "Revise los datos e intente de nuevo.";
    return error.message;
  }
  return "Algo salió mal.";
}

/**
 * Shows its children only to a signed-in person who may take the `kind` of panel; otherwise the sign-in
 * form, or a notice when the account cannot act as that kind.
 */
export function PanelGate({ kind, children }: { kind: PanelRole; children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStorage(TOKEN_KEY));
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [orgId, setOrgIdState] = useState<string | null>(() => readStorage(ORG_KEY));
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    const current = readStorage(TOKEN_KEY);
    writeStorage(TOKEN_KEY, null);
    writeStorage(ORG_KEY, null);
    setToken(null);
    setProfile(null);
    if (current) void api("/auth/sign-out", { method: "POST", token: current }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<SessionProfile>("/account/me", { token })
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiFailure && failure.status === 401) signOut();
        else setError(failureText(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

  const setOrgId = useCallback((next: string) => {
    writeStorage(ORG_KEY, next);
    setOrgIdState(next);
  }, []);

  // An organizer acts for a remembered organization only while still a member of it.
  const activeOrg =
    kind === "organizer" && profile
      ? (profile.organizations.find((org) => org.id === orgId) ?? profile.organizations[0] ?? null)
      : null;

  const panel = useMemo<Panel | null>(() => {
    if (!token || !profile) return null;
    const headers: Record<string, string> = activeOrg ? { "x-org-id": activeOrg.id } : {};
    return {
      profile,
      orgId: activeOrg?.id ?? null,
      setOrgId,
      signOut,
      call: (path, options = {}) => api(path, { ...options, token, headers }),
    };
  }, [token, profile, activeOrg, setOrgId, signOut]);

  if (!token) {
    return (
      <SignIn
        onSignedIn={(session) => {
          writeStorage(TOKEN_KEY, session.token);
          setToken(session.token);
        }}
      />
    );
  }
  if (error) {
    return (
      <PanelMessage title="No pudimos abrir el panel" onSignOut={signOut}>
        {error}
      </PanelMessage>
    );
  }
  if (!panel) return <p className="p-8 text-sm text-slate-600">Cargando…</p>;
  if (kind === "admin" && !panel.profile.isAdmin) {
    return (
      <PanelMessage title="Esta cuenta no administra la plataforma" onSignOut={signOut}>
        Entre con una cuenta de administración.
      </PanelMessage>
    );
  }
  if (kind === "municipal" && panel.profile.municipal.length === 0) {
    return (
      <PanelMessage title="Esta cuenta no tiene acceso municipal" onSignOut={signOut}>
        Pida a la administración de PassRipple que le dé acceso con este correo.
      </PanelMessage>
    );
  }
  if (kind === "organizer" && panel.orgId === null) {
    return (
      <PanelMessage title="Esta cuenta no pertenece a ninguna organización" onSignOut={signOut}>
        Pida a su organización que le dé acceso.
      </PanelMessage>
    );
  }
  return <PanelContext.Provider value={panel}>{children}</PanelContext.Provider>;
}

function PanelMessage({
  title,
  onSignOut,
  children,
}: {
  title: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Notice icon={LogIn} title={title} tone="verify">
        {children}
      </Notice>
      <Button variant="secondary" className="mt-4 w-full" onClick={onSignOut}>
        Salir
      </Button>
    </main>
  );
}

/** Email, then the six-digit code sent to it. */
function SignIn({ onSignedIn }: { onSignedIn: (session: UserSession) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        await api<SignInResponse>("/auth/sign-in", { method: "POST", body: { email } });
        setSent(true);
      } else {
        onSignedIn(
          await api<UserSession>("/auth/verify", { method: "POST", body: { email, code } }),
        );
      }
    } catch (failure) {
      setError(
        failure instanceof ApiFailure && failure.status === 401
          ? "El código no es correcto o ya venció."
          : failureText(failure),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <PageHeader eyebrow="PassRipple" title="Entrar al panel" />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Correo"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={sent}
            onChange={(event) => setEmail(event.target.value)}
          />
          {sent && (
            <Field
              label="Código"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              hint="Le enviamos un código de 6 dígitos a su correo. Vence en 10 minutos."
              onChange={(event) => setCode(event.target.value)}
            />
          )}
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <Button submit className="w-full" disabled={busy}>
            {sent ? "Entrar" : "Enviarme un código"}
          </Button>
          {sent && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-brand"
              onClick={() => {
                setSent(false);
                setCode("");
              }}
            >
              <Mail size={16} aria-hidden /> Usar otro correo
            </button>
          )}
        </form>
      </Card>
    </main>
  );
}
