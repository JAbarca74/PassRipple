// Entry point of the API Worker: the app with its real services.

import { createApp } from "./app.ts";
import { connect } from "./db.ts";

export default createApp({
  database: (env) => connect(env.HYPERDRIVE.connectionString),
});
