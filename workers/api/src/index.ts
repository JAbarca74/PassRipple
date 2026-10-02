// Entry point of the API Worker: the app with its real services.

import { createApp } from "./app.ts";
import { connect } from "./db.ts";
import { unverifiedIntegrity } from "./ports/integrity.ts";
import { createMailSender } from "./ports/mail.ts";

export default createApp({
  database: (env) => connect(env.HYPERDRIVE.connectionString),
  mailer: (env, requestUrl) => createMailSender(env, requestUrl),
  integrity: () => unverifiedIntegrity,
});
