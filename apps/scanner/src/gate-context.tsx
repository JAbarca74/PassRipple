// The app's state around one gate session: whether the phone is enrolled, whether it has
// the manifest, and the sync loop. The queue drains every two minutes, when the app comes
// back to the foreground and when the network returns; the manifest updates every minute
// while the device is active (design 8.3, 8.7). NetInfo is only a hint (8.8): a captive
// Wi-Fi reports "connected", and the outbox's timeout and breaker handle that.

import NetInfo from "@react-native-community/netinfo";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { Api } from "./lib/api.ts";
import { DeviceClock } from "./lib/clock.ts";
import { GateSession, type GateStatus } from "./lib/gate-session.ts";
import { getDeviceToken, getEnrollment } from "./lib/secure.ts";

export const DRAIN_INTERVAL_MS = 2 * 60_000;
export const MANIFEST_INTERVAL_MS = 60_000;
const STATUS_INTERVAL_MS = 5_000;

export type GatePhase =
  | { readonly kind: "loading" }
  | { readonly kind: "unenrolled"; readonly notice: string | null }
  | { readonly kind: "needs_manifest"; readonly session: GateSession }
  | { readonly kind: "ready"; readonly session: GateSession }
  | { readonly kind: "error"; readonly message: string };

interface GateContextValue {
  readonly api: Api;
  readonly phase: GatePhase;
  readonly status: GateStatus | null;
  /** Re-reads the enrollment from secure storage and reopens the session. */
  reload(notice?: string | null): Promise<void>;
  /** Drains and updates now, for "Sincronizar ahora" and after the manifest download. */
  syncNow(): Promise<void>;
  refreshStatus(): Promise<void>;
}

const GateContext = createContext<GateContextValue | null>(null);

function apiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) throw new Error("EXPO_PUBLIC_API_URL is not set (apps/scanner/.env)");
  return url;
}

export function GateProvider({ children }: { readonly children: ReactNode }) {
  const clock = useRef(new DeviceClock()).current;
  const api = useMemo(() => new Api(apiUrl(), clock), [clock]);
  const [phase, setPhase] = useState<GatePhase>({ kind: "loading" });
  const [status, setStatus] = useState<GateStatus | null>(null);
  const syncing = useRef(false);

  const reload = useCallback(
    async (notice: string | null = null) => {
      try {
        const [device, token] = await Promise.all([getEnrollment(), getDeviceToken()]);
        if (device === null || token === null) {
          setStatus(null);
          setPhase({ kind: "unenrolled", notice });
          return;
        }
        const session = await GateSession.open(device, token, api, clock);
        const stored = await GateSession.storedClock(session);
        if (stored !== null && !clock.isSynced()) clock.restore(stored);
        setPhase({ kind: (await session.hasManifest()) ? "ready" : "needs_manifest", session });
        setStatus(await session.status());
      } catch (error) {
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [api, clock],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const session = phase.kind === "ready" ? phase.session : null;

  const refreshStatus = useCallback(async () => {
    if (session !== null) setStatus(await session.status());
  }, [session]);

  const syncNow = useCallback(async () => {
    if (session === null || syncing.current) return;
    syncing.current = true;
    try {
      await session.drain();
      await session.checkSession();
      await session.refreshManifest();
      const current = await session.status();
      setStatus(current);
      // Over (expired or revoked) and nothing left to upload: the event leaves the phone.
      if (current.over && (await session.isQueueEmpty())) {
        await session.wipe();
        await reload(
          current.device.status === "revoked"
            ? "El acceso de este teléfono fue revocado. Se borraron los datos del evento."
            : "El evento terminó. Se borraron sus datos de este teléfono.",
        );
      }
    } finally {
      syncing.current = false;
    }
  }, [session, reload]);

  // The sync loop of a ready session.
  useEffect(() => {
    if (session === null) return;
    void syncNow();
    const drainTimer = setInterval(() => void syncNow(), DRAIN_INTERVAL_MS);
    const manifestTimer = setInterval(() => {
      void session.refreshManifest().then(refreshStatus);
    }, MANIFEST_INTERVAL_MS);
    const statusTimer = setInterval(() => void refreshStatus(), STATUS_INTERVAL_MS);
    // iOS does not promise background work: the gate syncs in the foreground (8.8).
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncNow();
    });
    let wasConnected: boolean | null = null;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true;
      if (connected && wasConnected === false) void syncNow();
      wasConnected = connected;
    });
    return () => {
      clearInterval(drainTimer);
      clearInterval(manifestTimer);
      clearInterval(statusTimer);
      appState.remove();
      unsubscribeNet();
    };
  }, [session, syncNow, refreshStatus]);

  const value = useMemo(
    () => ({ api, phase, status, reload, syncNow, refreshStatus }),
    [api, phase, status, reload, syncNow, refreshStatus],
  );
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

export function useGate(): GateContextValue {
  const value = useContext(GateContext);
  if (value === null) throw new Error("useGate outside GateProvider");
  return value;
}

/** The ready session, for screens that only render once the phone has its manifest. */
export function useReadySession(): GateSession | null {
  const { phase } = useGate();
  return phase.kind === "ready" ? phase.session : null;
}
