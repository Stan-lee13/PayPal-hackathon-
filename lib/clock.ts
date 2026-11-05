/**
 * Time source. In DEMO_MODE a merchant may advance a *simulated* clock so a
 * 48-hour shipping promise can be demonstrated in minutes. The offset is
 * always labelled in the UI and is ignored entirely when DEMO_MODE is off.
 */
export function demoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function effectiveNow(offsetMs = 0, real: Date = new Date()): Date {
  return new Date(real.getTime() + (demoModeEnabled() ? offsetMs : 0));
}
