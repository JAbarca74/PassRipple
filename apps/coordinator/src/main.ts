// Runs the coordinator on a laptop: node src/main.ts
//   COORDINATOR_TOKEN  shared secret of the zone, at least 16 characters (required)
//   COORDINATOR_DB     SQLite file, ./claims.db by default
//   COORDINATOR_PORT   8800 by default
// One coordinator per zone (design 8.2 and 15): a home Wi-Fi access point does not carry
// dozens of devices well, so the gates of one zone share one, and the zones never talk.

import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createCoordinatorApp } from "./app.ts";
import { SqliteClaimStore } from "./claims.ts";

const token = process.env.COORDINATOR_TOKEN;
if (!token) throw new Error("COORDINATOR_TOKEN is required");

const app = createCoordinatorApp(
  new SqliteClaimStore(new DatabaseSync(process.env.COORDINATOR_DB ?? "claims.db")),
  token,
);

const port = Number(process.env.COORDINATOR_PORT ?? 8800);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await app.fetch(
    new Request(`http://localhost${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      body: hasBody ? Buffer.concat(chunks) : null,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`coordinator listening on ${port}`));
