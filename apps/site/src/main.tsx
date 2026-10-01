import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { type EventStatus, findEvent } from "./data.ts";
import { EventPage, OrganizerPage } from "./pages/event.tsx";
import { Home } from "./pages/home.tsx";
import { DeleteDataPage, LegalPage, privacyPolicy, termsOfService } from "./pages/legal.tsx";
import { SiteLayout } from "./ui/layout.tsx";
import "./styles.css";

const PREVIEW_STATUSES: readonly EventStatus[] = ["on-sale", "sold-out", "cancelled"];

/** Picks the page for a path. Plain links reload the page, as the pre-rendered site will. */
function pageFor(pathname: string, search: URLSearchParams) {
  if (pathname === "/") return <Home />;
  if (pathname === "/privacidad") return <LegalPage document={privacyPolicy} />;
  if (pathname === "/terminos") return <LegalPage document={termsOfService} />;
  if (pathname === "/eliminar-datos") return <DeleteDataPage />;
  if (pathname.startsWith("/organizadores/")) return <OrganizerPage />;

  const event = pathname.startsWith("/eventos/")
    ? findEvent(pathname.slice("/eventos/".length))
    : undefined;
  if (event) {
    // ?estado=sold-out or ?estado=cancelled previews the other variants of the page.
    const status = PREVIEW_STATUSES.find((value) => value === search.get("estado"));
    return status ? <EventPage event={event} status={status} /> : <EventPage event={event} />;
  }

  return (
    <SiteLayout>
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-3xl font-black">No encontramos esta página</h1>
        <a href="/" className="mt-6 inline-flex min-h-12 items-center font-bold text-brand">
          Volver al inicio
        </a>
      </main>
    </SiteLayout>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {pageFor(window.location.pathname, new URLSearchParams(window.location.search))}
  </StrictMode>,
);
