/**
 * Where secrets come from, honestly.
 *
 * Two implementations exist and neither pretends to be a key-management service:
 *
 *   • `LocalEnvSecretStore` — development only. Reads `process.env`, and refuses to be constructed in
 *     production, so a deployment cannot quietly rely on it.
 *   • `EnvironmentSecretStore` — production-capable, and named for what it is: secrets held in the process
 *     environment. It is **not** a KMS, not a vault, and not hardware-backed. Whoever can read the environment
 *     (a crash dump, a misconfigured log, a host compromise) can read the secret.
 *
 * There is deliberately no `ManagedSecretStore` class that merely reads environment variables under another
 * name. A real KMS adapter would implement the same interface with a `kind` of `"kms"` and would be a separate
 * integration with its own audit story.
 */

export type SecretStoreKind = "environment" | "kms";

export interface SecretStore {
  readonly kind: SecretStoreKind;
  /** What this store actually is, in one sentence, for health pages and docs. */
  readonly description: string;
  /** The value, or an error. Never returns an empty string: a missing secret is an error, not a blank value. */
  get(name: string): Promise<string>;
  /** Replace the value. Only a store that can do this implements it; environment variables cannot. */
  rotate(name: string, value: string): Promise<{ version: string }>;
}

export const isProduction = (env: NodeJS.ProcessEnv = process.env) => env.NODE_ENV === "production";

export class EnvironmentSecretStore implements SecretStore {
  readonly kind = "environment" as const;
  readonly description: string = "Secrets are read from the process environment. This is not a KMS: anyone who can read the environment can read them.";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(name: string): Promise<string> {
    const v = this.env[name];
    if (typeof v !== "string" || v.length === 0) throw new Error(`Secret ${name} is not configured.`);
    return v;
  }

  async rotate(name: string, _value: string): Promise<{ version: string }> {
    throw new Error(`${name} is held in the process environment; it cannot be rotated at runtime. Restart the deployment with the new value.`);
  }
}

/** Development only: the same environment store, but it refuses to exist in production. */
export class LocalEnvSecretStore extends EnvironmentSecretStore {
  readonly description: string = "Development secrets from the local environment (.env). Not permitted in production.";

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (isProduction(env)) {
      throw new Error("LocalEnvSecretStore is for development; a production deployment must configure its secrets explicitly.");
    }
    super(env);
  }
}

/** The store for this process. Production gets the environment store, and the health page says so. */
export function secretStore(env: NodeJS.ProcessEnv = process.env): SecretStore {
  return isProduction(env) ? new EnvironmentSecretStore(env) : new LocalEnvSecretStore(env);
}

export function secretStoreKind(env: NodeJS.ProcessEnv = process.env): SecretStoreKind {
  return secretStore(env).kind;
}
