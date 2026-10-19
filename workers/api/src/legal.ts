// The legal documents a buyer accepts at checkout (design 14.3, 14.4): the latest published
// versions of the terms and the privacy policy, read from privacy.legal_documents.

import type { Tx } from "./db.ts";
import { ApiError } from "./errors.ts";

export interface LegalVersions {
  readonly termsVersion: string;
  readonly privacyVersion: string;
}

export async function currentLegalVersions(tx: Tx): Promise<LegalVersions> {
  const rows = await tx<{ kind: "terms" | "privacy"; version: string }[]>`
    SELECT DISTINCT ON (kind) kind, version FROM privacy.legal_documents
     WHERE kind IN ('terms', 'privacy')
     ORDER BY kind, published_at DESC, version DESC`;
  const terms = rows.find((row) => row.kind === "terms");
  const privacy = rows.find((row) => row.kind === "privacy");
  if (!terms || !privacy) {
    // Nobody can accept documents that were never published.
    throw new ApiError(
      503,
      "not_configured",
      "Sales are not available right now. Try again later.",
    );
  }
  return { termsVersion: terms.version, privacyVersion: privacy.version };
}
