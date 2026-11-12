// The frame of an organizer's per-event screen: the organization and event pickers, sign-out,
// the empty and error states. The event list comes from /settlement/events, which lists
// every event of the organization.

import type { SettlementEvent, SettlementEventsResponse } from "@passripple/contracts";
import { LogOut, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { failureText, usePanel } from "../../lib/panel.tsx";
import { Button, Notice, PageHeader } from "../../ui/ui.tsx";

const selectClass = "h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm";

export function OrganizerEventScreen({
  title,
  pick,
  children,
}: {
  title: string;
  /** Which event to open first. */
  pick: (events: readonly SettlementEvent[]) => SettlementEvent | undefined;
  children: (event: SettlementEvent) => ReactNode;
}) {
  const panel = usePanel();
  const [events, setEvents] = useState<readonly SettlementEvent[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pick is chosen once per screen
  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    panel
      .call<SettlementEventsResponse>("/settlement/events")
      .then((body) => {
        if (cancelled) return;
        setEvents(body.events);
        setEventId((pick(body.events) ?? body.events[0])?.eventId ?? null);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failureText(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  const organizations = panel.profile.organizations;
  const event = events?.find((candidate) => candidate.eventId === eventId) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={organizations.find((org) => org.id === panel.orgId)?.name ?? "Organizador"}
        title={title}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {organizations.length > 1 && (
              <select
                aria-label="Organización"
                className={selectClass}
                value={panel.orgId ?? ""}
                onChange={(change) => panel.setOrgId(change.target.value)}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}
            {events && events.length > 0 && (
              <select
                aria-label="Evento"
                className={selectClass}
                value={eventId ?? ""}
                onChange={(change) => setEventId(change.target.value)}
              >
                {events.map((candidate) => (
                  <option key={candidate.eventId} value={candidate.eventId}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={panel.signOut}>
              <LogOut size={16} aria-hidden /> Salir
            </Button>
          </div>
        }
      />
      {error && (
        <Notice icon={TriangleAlert} title="No pudimos cargar sus eventos" tone="verify">
          {error}
        </Notice>
      )}
      {events?.length === 0 && (
        <Notice icon={TriangleAlert} title="Todavía no tiene eventos">
          Cuando su organización cree un evento, aparece aquí.
        </Notice>
      )}
      {!events && !error && <p className="text-sm text-slate-600">Cargando…</p>}
      {event && <div key={event.eventId}>{children(event)}</div>}
    </>
  );
}
