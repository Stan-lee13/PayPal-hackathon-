/**
 * The legacy principal → organization map, and its validation.
 *
 * Existing financial deployments have Ed25519 principals (`roots.principal`, `accounts.owner`, …) and no
 * organizations. The migration must never invent the relationship: an operator writes this file, the
 * migration validates it, and unmapped principals stop the migration instead of being folded into a default
 * organization.
 *
 * The file contains public keys only. Provider secrets and private keys are refused by shape, and none are
 * read by the migration.
 */

export const LEGACY_MAP_VERSION = 1 as const;

export type LegacyOrganizationEntry = {
  /** The organization's immutable id, e.g. `org_ada`. */
  organization_id: string;
  name: string;
  /** Every public key assigned to it. A key may appear once in the whole file. */
  legacy_principals: string[];
  /** Free text for the operator. Never read for authorization. */
  note?: string;
};

export type LegacyOrganizationMap = {
  version: typeof LEGACY_MAP_VERSION;
  organizations: LegacyOrganizationEntry[];
};

export type LegacyMapParse = { ok: true; map: LegacyOrganizationMap } | { ok: false; problems: string[] };

/** A public key in this system is base64url of 32 bytes: 43 characters, no padding. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const ORG_ID = /^org_[A-Za-z0-9][A-Za-z0-9_-]{2,60}$/;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Validate the file as a whole. Every problem is reported, not just the first, so an operator can fix the file
 * in one pass. A duplicate organization id, a duplicate principal, or a principal that looks like private key
 * material is refused — the migration must not guess which assignment was meant.
 */
export function parseLegacyOrganizationMap(input: unknown): LegacyMapParse {
  const problems: string[] = [];
  if (!isObject(input)) return { ok: false, problems: ["The map must be a JSON object."] };
  if (input.version !== LEGACY_MAP_VERSION) problems.push(`version must be ${LEGACY_MAP_VERSION}.`);
  const orgs = input.organizations;
  if (!Array.isArray(orgs) || orgs.length === 0) {
    return { ok: false, problems: [...problems, "organizations must be a non-empty array."] };
  }
  const seenOrg = new Set<string>();
  const seenKey = new Map<string, string>();
  const out: LegacyOrganizationEntry[] = [];
  const isPrivate = (s: string) => /private/i.test(s) || /^[A-Za-z0-9_-]*d=[A-Za-z0-9_-]+/i.test(s) || s.includes("PRIVATE KEY");

  for (const [i, raw] of orgs.entries()) {
    const at = `organizations[${i}]`;
    if (!isObject(raw)) { problems.push(`${at} must be an object.`); continue; }
    const id = typeof raw.organization_id === "string" ? raw.organization_id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!ORG_ID.test(id)) problems.push(`${at}.organization_id must look like org_example (letters, digits, - and _).`);
    if (!name) problems.push(`${at}.name must be a non-empty display name.`);
    if (id && seenOrg.has(id)) problems.push(`${at}.organization_id ${id} is used by more than one organization.`);
    seenOrg.add(id);
    if (!Array.isArray(raw.legacy_principals) || raw.legacy_principals.length === 0) {
      problems.push(`${at}.legacy_principals must list at least one public key.`);
      continue;
    }
    const keys: string[] = [];
    for (const [j, k] of raw.legacy_principals.entries()) {
      const key = typeof k === "string" ? k.trim() : "";
      if (typeof k !== "string") { problems.push(`${at}.legacy_principals[${j}] must be a string.`); continue; }
      if (isPrivate(key)) { problems.push(`${at}.legacy_principals[${j}] looks like private key material; only public keys belong in this file.`); continue; }
      if (!PUBLIC_KEY.test(key)) { problems.push(`${at}.legacy_principals[${j}] is not a public key (43 base64url characters).`); continue; }
      const other = seenKey.get(key);
      if (other) problems.push(`Principal ${key.slice(0, 8)}… is assigned to both ${other} and ${id}; a principal may belong to exactly one organization.`);
      else seenKey.set(key, id);
      keys.push(key);
    }
    out.push({ organization_id: id, name, legacy_principals: keys, ...(typeof raw.note === "string" ? { note: raw.note } : {}) });
  }
  return problems.length ? { ok: false, problems } : { ok: true, map: { version: LEGACY_MAP_VERSION, organizations: out } };
}

/** The organization a principal is mapped to, or null. */
export function organizationForPrincipal(map: LegacyOrganizationMap, publicKey: string): string | null {
  for (const o of map.organizations) if (o.legacy_principals.includes(publicKey)) return o.organization_id;
  return null;
}

/**
 * Every legacy principal the file does not map. The migration refuses to run while this is non-empty (unless
 * the operator explicitly allows unmapped records to stay unmapped, in which case they are only reported).
 */
export function unmappedLegacyPrincipals(map: LegacyOrganizationMap, legacy: Iterable<string>): string[] {
  const mapped = new Set(map.organizations.flatMap((o) => o.legacy_principals));
  return [...new Set([...legacy])].filter((k) => !mapped.has(k)).sort();
}

/** The whole map as (principal → organization), for a deterministic report. */
export function principalAssignments(map: LegacyOrganizationMap): Map<string, string> {
  return new Map(map.organizations.flatMap((o) => o.legacy_principals.map((k) => [k, o.organization_id] as const)));
}
