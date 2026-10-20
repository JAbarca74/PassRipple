// How a buyer proves the order's contact is theirs (design 6.6, 14.7, ADR 0036): a one-time
// code sent to it. Email goes through the MailSender port (Gmail, ADR 0028). A phone channel
// is an open decision (Anexo D): SMS one-time codes were discarded (Anexo C), and asking
// for an email or another channel such as WhatsApp is not decided. A buyer who gave only a
// phone gets 422 until a channel is added here.

import type { BuyerContact } from "@passripple/contracts";
import { ApiError } from "../errors.ts";
import type { MailSender } from "./mail.ts";

export type ContactPurpose = "recovery" | "erasure";

export interface ContactChannel {
  /** Sends a code to the address. */
  send(to: string, code: string, purpose: ContactPurpose): Promise<void>;
}

const SUBJECTS: Record<ContactPurpose, string> = {
  recovery: "Su código para recuperar sus entradas",
  erasure: "Su código para eliminar sus datos",
};

const ACTIONS: Record<ContactPurpose, string> = {
  recovery: "pasar sus entradas a este teléfono",
  erasure: "eliminar sus datos de PassRipple",
};

export function emailChannel(mailer: MailSender): ContactChannel {
  return {
    async send(to, code, purpose) {
      await mailer.send({
        to,
        subject: SUBJECTS[purpose],
        text: [
          `Su código para ${ACTIONS[purpose]} es ${code}.`,
          "Vence en 10 minutos. No lo comparta con nadie.",
          "Si usted no lo pidió, ignore este correo.",
        ].join("\n\n"),
      });
    },
  };
}

/** The email of a contact, or 422 for a phone, whose channel is not decided yet. */
export function emailOf(contact: BuyerContact): string {
  if ("email" in contact) return contact.email;
  throw new ApiError(
    422,
    "contact_channel_unavailable",
    "We cannot send codes to a phone yet. Write to support to recover your tickets.",
  );
}
