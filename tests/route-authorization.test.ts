/**
 * Every route has an explicit authorization classification.
 *
 * The test reads the real files rather than a copy of them: the registered handlers in lib/api/handlers.ts, the
 * route files under app/api, and the table in lib/api/route-policy.ts. A new route that is not classified fails
 * here, and a stale classification fails too.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_POLICY, SPECIAL_ROUTE_FILES, staleRoutePolicies, unclassifiedHandlers, demoEnabled } from "../lib/api/route-policy";

const ROOT = process.cwd();

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (name === "route.ts") out.push(relative(ROOT, full).split("\\").join("/"));
  }
  return out;
}

/** Handler keys registered in lib/api/handlers.ts: the object literal keys of `handlers`. */
function registeredHandlerKeys(): string[] {
  const src = readFileSync(join(ROOT, "lib/api/handlers.ts"), "utf8");
  return [...src.matchAll(/^\s{2}"((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^"]+)":/gm)].map((m) => m[1]!);
}

/** Handler keys each route file actually mounts. */
function mountedKeys(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  return [...src.matchAll(/route\(\s*"((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^"]+)"/g)].map((m) => m[1]!);
}

describe("route authorization classification", () => {
  const keys = registeredHandlerKeys();
  const files = routeFiles(join(ROOT, "app/api"));

  it("finds the handlers and the route files it is meant to check", () => {
    expect(keys.length).toBeGreaterThan(40);
    expect(files).toContain("app/api/gateway/spend/route.ts");
    expect(files).toContain("app/api/auth/[...auth]/route.ts");
  });

  it("classifies every registered handler, and has no stale entries", () => {
    expect(unclassifiedHandlers(keys)).toEqual([]);
    expect(staleRoutePolicies(keys)).toEqual([]);
  });

  it("mounts every registered handler from a real route file", () => {
    const mounted = new Set(files.flatMap(mountedKeys));
    expect([...keys].filter((k) => !mounted.has(k)).sort()).toEqual([]);
  });

  it("classifies every route file, including those that are not handler wrappers", () => {
    const unclassified = files.filter((f) => !SPECIAL_ROUTE_FILES[f] && mountedKeys(f).length === 0);
    expect(unclassified).toEqual([]);
  });

  it("every policy names a category and states its enforcement honestly", () => {
    for (const [key, p] of Object.entries(ROUTE_POLICY)) {
      expect(p.category, key).toBeTruthy();
      expect(["enforced", "documented-gap"], key).toContain(p.enforcement);
      expect(p.note.length, key).toBeGreaterThan(10);
    }
  });

  it("does not classify a money-moving demo route as production-capable", () => {
    // The demo/simulation categories are refused in production by the handlers themselves.
    const demos = Object.entries(ROUTE_POLICY).filter(([, p]) => p.category === "demo" || p.category === "simulation");
    expect(demos.length).toBeGreaterThan(5);
    expect(demoEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(demoEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("left no gap behind: every read that serves one organization requires a session", () => {
    const gaps = Object.values(ROUTE_POLICY).filter((p) => p.enforcement === "documented-gap");
    expect(gaps).toEqual([]);
    // The ten addressed reads that were gaps are now session-classified, and each names the permission the
    // wrapper enforces. A route that reads tenant data cannot be added as public-read any more.
    const tenantReads = Object.entries(ROUTE_POLICY).filter(([, p]) => p.category === "session");
    expect(tenantReads.length).toBeGreaterThanOrEqual(10);
    for (const [key, p] of tenantReads) {
      expect(p.session, key).toBe("required");
      expect(p.enforcement, key).toBe("enforced");
    }
  });

  it("never makes an organization's records readable without a session", () => {
    const publicReads = Object.entries(ROUTE_POLICY).filter(([, p]) => String(p.category) === "public-read");
    expect(publicReads).toEqual([]);
    const publicTenantData = Object.entries(ROUTE_POLICY).filter(([, p]) => p.category === "public" && p.permission !== null);
    expect(publicTenantData).toEqual([]);
  });
});
