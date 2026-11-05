/**
 * Simulated-mode helpers (PAYPAL_MODE=simulated only). Delivers events queued by
 * the local emulator through Kept's normal ingest → process path, minus the
 * signature check (simulated events are labelled SIMULATED everywhere).
 */
import { paypalMode } from "../paypal/client";
import { ingestSimulatedEvent, processEvent } from "./webhooks";

export async function deliverSimulatedEvents(opts: { duplicateFirst?: boolean } = {}) {
  if (paypalMode() !== "simulated") return { delivered: 0, duplicates: 0 };
  const { drainEmulatorEvents } = await import("../paypal/emulator");
  const events = drainEmulatorEvents();
  let delivered = 0;
  let duplicates = 0;
  for (const ev of events) {
    const copies = opts.duplicateFirst ? 2 : 1; // demonstrate PayPal's at-least-once delivery
    for (let i = 0; i < copies; i++) {
      const res = await ingestSimulatedEvent(ev);
      if (res.body.duplicate) duplicates++;
      if (res.internalId) {
        delivered++;
        await processEvent(res.internalId);
      }
    }
  }
  return { delivered, duplicates };
}
