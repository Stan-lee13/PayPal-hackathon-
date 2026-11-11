/**
 * The gateway, running in this browser tab. Used only when the site has no server database: the
 * same handlers the server routes call, against Postgres-in-WebAssembly and the PayPal simulator.
 */
import { match, run } from "../api/handlers";
import { bootDriver } from "../db/driver.browser";

export async function dispatch(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  await bootDriver();
  const m = match(method, path);
  if (!m) return { status: 404, body: { error: "No such endpoint." } };
  return run(m.handler, { params: m.params, body });
}
