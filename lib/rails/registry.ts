/**
 * Which rail this deployment moves money through.
 *
 * One place decides, and everything downstream asks for `rail()`. The default is PayPal so that the
 * existing protocol, receipts and tests keep their behaviour; a deployment can select another rail with
 * `ENVELOPE_RAIL_PROVIDER`, and tests can inject one with `setRailForTesting`. An unknown id is an error,
 * never a silent fallback: picking the wrong rail would move money through the wrong provider.
 */
import { mockRail, type MockRail } from "./mock-rail";
import { paypalRail } from "./paypal-rail";
import type { Rail, RailId } from "./types";

export type RailFactory = () => Rail;

const factories = new Map<RailId, RailFactory>();
// The only two rails this repository ships. PayPal is the reference adapter; the mock exists so the
// contracts can be tested without a provider. A partner adapter registers itself with registerRail.
factories.set("paypal", () => paypalRail());
factories.set("mock", () => mockRail());
const instances = new Map<RailId, Rail>();
let override: Rail | null = null;

/** Add a partner adapter without touching the engine. */
export function registerRail(id: RailId, factory: RailFactory): void {
  if (!id) throw new Error("A rail needs an id.");
  factories.set(id, factory);
  instances.delete(id);
}

export function railIds(): RailId[] {
  return [...factories.keys()];
}

export function configuredRailId(): RailId {
  return (process.env.ENVELOPE_RAIL_PROVIDER ?? "paypal").trim().toLowerCase() || "paypal";
}

/** The id of the rail this process would use right now: an injected one wins over configuration. */
export function activeRailId(): RailId {
  return override ? override.id : configuredRailId();
}

/** Resolve a rail by id, creating it once per process. An injected rail is returned for its own id. */
export function resolveRail(id: RailId = activeRailId()): Rail {
  if (override && override.id === id) return override;
  const cached = instances.get(id);
  if (cached) return cached;
  const factory = factories.get(id);
  if (!factory) throw new Error(`Unknown financial rail "${id}". Known rails: ${railIds().join(", ")}. Set ENVELOPE_RAIL_PROVIDER to one of them.`);
  const rail = factory();
  instances.set(id, rail);
  return rail;
}

/** Tests: use this rail instead of the configured one, or `null` to go back. */
export function setRailForTesting(rail: Rail | null): void {
  override = rail;
  instances.clear();
}

/** Tests: forget cached instances so a fresh environment is read again. */
export function forgetRails(): void {
  override = null;
  instances.clear();
}

/** The mock rail, for contract tests. Throws if the configured rail is not the mock one. */
export function mockRailOf(rail: Rail): MockRail {
  if (!(rail instanceof Object) || rail.id !== "mock") throw new Error("That rail is not the deterministic mock rail.");
  return rail as MockRail;
}
