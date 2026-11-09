// Access for Google Play's app reviewers (Phase 2 closing). Sign-in mails a code, and a
// reviewer cannot read a mailbox of ours, so one address gets a fixed code instead of a
// mailed one. Everything else is as for anyone: the rate limit, ten minutes of life, five
// attempts and one use per code. The account it opens is an ordinary one, so it reaches
// only the demo event it holds a staff code for. Unsetting either variable turns it off,
// which is the thing to do once the review is over: a fixed six-digit code can be guessed
// slowly, even at five codes of five attempts per quarter hour.

import type { Env } from "./env.ts";

const SIX_DIGITS = /^[0-9]{6}$/;

/** The fixed code for this address, or null when the address is not the reviewer's. */
export function reviewerCode(env: Env, email: string): string | null {
  const address = env.REVIEW_SIGN_IN_EMAIL?.trim().toLowerCase();
  const code = env.REVIEW_SIGN_IN_CODE?.trim();
  if (!address || !code || email.trim().toLowerCase() !== address) return null;
  if (!SIX_DIGITS.test(code)) throw new Error("REVIEW_SIGN_IN_CODE must be six digits");
  return code;
}
