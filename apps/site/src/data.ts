// Static demonstration data. Every name and amount here is invented.
// The seo module will render these templates with real event data when an event is published.

export const APP_URL = import.meta.env.VITE_APP_URL ?? "http://localhost:5174";

export type EventStatus = "on-sale" | "sold-out" | "cancelled";

export type PublicEvent = {
  slug: string;
  name: string;
  startsAt: Date;
  venue: string;
  canton: string;
  organizer: { slug: string; name: string; verified: boolean };
  adultsOnly: boolean;
  capacity: number;
  status: EventStatus;
  ticketTypes: readonly {
    name: string;
    price: number;
    availability: "Disponible" | "Quedan pocas" | "Agotado";
  }[];
};

const organizer = {
  slug: "asociacion-deportiva-pejibaye",
  name: "Asociación Deportiva Pejibaye",
  verified: true,
};

export const events: readonly PublicEvent[] = [
  {
    slug: "motocross-pejibaye",
    name: "Motocross Pejibaye",
    startsAt: new Date("2026-11-14T19:00:00Z"),
    venue: "Finca El Llano, Pejibaye",
    canton: "Pérez Zeledón",
    organizer,
    adultsOnly: false,
    capacity: 500,
    status: "on-sale",
    ticketTypes: [
      { name: "General", price: 5000, availability: "Quedan pocas" },
      { name: "Sombra", price: 7000, availability: "Disponible" },
      { name: "VIP", price: 12000, availability: "Disponible" },
    ],
  },
  {
    slug: "baile-fin-de-ano",
    name: "Baile de Fin de Año",
    startsAt: new Date("2027-01-01T02:00:00Z"),
    venue: "Salón comunal, San Isidro",
    canton: "Pérez Zeledón",
    organizer,
    adultsOnly: true,
    capacity: 300,
    status: "on-sale",
    ticketTypes: [{ name: "General", price: 6000, availability: "Disponible" }],
  },
];

export function findEvent(slug: string): PublicEvent | undefined {
  return events.find((event) => event.slug === slug);
}
