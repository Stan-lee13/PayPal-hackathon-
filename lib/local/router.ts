/**
 * The gateway, running in this browser tab. Used only when the site has no server database: the
 * same handlers the server routes call, against Postgres-in-WebAssembly and the PayPal simulator.
 */
import { match, run } from "../api/handlers";
import { bootDriver, databaseMoves } from "../db/driver.browser";

type Answer = { status: number; body: unknown };

export async function dispatch(method: string, path: string, body: unknown): Promise<Answer> {
  await bootDriver();
  const m = match(method, path);
  if (!m) return { status: 404, body: { error: "No such endpoint." } };
  for (let attempt = 0; ; attempt++) {
    const before = databaseMoves();
    const out = await run(m.handler, { params: m.params, body });
    // The tab that held the shared database closed or reloaded while this ran, and the statement in flight was lost with it.
    if (out.status !== 500 || databaseMoves() === before) return out;
    // A read is simply asked again. A change is not repeated blindly: the step in flight was rolled back, and the person decides.
    if (method === "GET" && attempt < 2) continue;
    return { status: 503, body: { error: "Another tab of this site closed while this was running, and the in-browser database moved to this tab. The step that was in flight was rolled back. Check the page, and try again if it did not go through." } };
  }
}
