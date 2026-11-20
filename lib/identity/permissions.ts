/**
 * Roles and permissions, in one place.
 *
 * A role is only a named set of permissions, and every check is `permissions.has(...)`, never a comparison
 * against a role name. That is what keeps "read-only" from quietly gaining a write, and what lets the matrix be
 * audited as a table (docs/MILESTONE_4_PERMISSION_MATRIX.md).
 *
 * Nothing in this file touches the database, the request or the UI: it is pure data and pure functions, so the
 * matrix can be tested exhaustively without a server.
 */

export const PERMISSIONS = [
  "org.read",
  "org.manage",

  "member.read",
  "member.manage",

  "provider.read",
  "provider.manage",

  "envelope.read",
  "envelope.seal",
  "envelope.revoke",
  "budget.manage",

  "payment.read",
  "payment.initiate",
  "refund.issue",

  "payout.recover",
  "payout.recover.approve",

  "statement.read",

  "audit.read",
  "audit.export",

  "api_key.read",
  "api_key.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "admin", "finance", "approver", "auditor", "developer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The matrix. Read it with the security rules in mind:
 *
 *   • `payment.read` is granted to everyone; `payment.initiate` is not.
 *   • `provider.manage` (rotate credentials) is granted to owner/admin only, and it does not itself grant
 *     money movement: `payment.initiate` is a separate permission, and no role receives it *because* it can
 *     manage credentials.
 *   • `audit.read` never comes with a write permission; auditors and developers have no money permission.
 *   • `payout.recover` (propose a reconciliation) and `payout.recover.approve` (second signature) are held by
 *     different roles, so one person cannot do both. The route itself is not exposed in this milestone.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    "org.read", "org.manage",
    "member.read", "member.manage",
    "provider.read", "provider.manage",
    "envelope.read", "envelope.seal", "envelope.revoke", "budget.manage",
    "payment.read", "payment.initiate", "refund.issue",
    "payout.recover",
    "statement.read",
    "audit.read", "audit.export",
    "api_key.read", "api_key.manage",
  ],
  finance: [
    "org.read",
    "provider.read",
    "envelope.read", "envelope.seal", "envelope.revoke", "budget.manage",
    "payment.read", "payment.initiate", "refund.issue",
    "payout.recover",
    "statement.read", "audit.read",
  ],
  approver: [
    "org.read",
    "envelope.read",
    "payment.read",
    "payout.recover.approve",
    "statement.read", "audit.read",
  ],
  auditor: [
    "org.read",
    "member.read",
    "provider.read",
    "envelope.read",
    "payment.read",
    "statement.read",
    "audit.read", "audit.export",
  ],
  developer: [
    "org.read",
    "envelope.read",
    "payment.read",
    "api_key.read",
  ],
};

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze({
  owner: new Set<Permission>(GRANTS.owner),
  admin: new Set<Permission>(GRANTS.admin),
  finance: new Set<Permission>(GRANTS.finance),
  approver: new Set<Permission>(GRANTS.approver),
  auditor: new Set<Permission>(GRANTS.auditor),
  developer: new Set<Permission>(GRANTS.developer),
});

/** Permissions that can move money, or change the authority that moves it. A suspended org may not use them. */
export const MONEY_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "envelope.seal", "envelope.revoke", "budget.manage",
  "payment.initiate", "refund.issue",
  "payout.recover", "payout.recover.approve",
]);

export const isPermission = (x: unknown): x is Permission => typeof x === "string" && (PERMISSIONS as readonly string[]).includes(x);
export const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as readonly string[]).includes(x);

/** The permissions of a role. An unknown role gets nothing: fail closed, never a default role. */
export function permissionsFor(role: string): ReadonlySet<Permission> {
  return isRole(role) ? ROLE_PERMISSIONS[role] : new Set<Permission>();
}

export function roleHas(role: string, permission: Permission): boolean {
  return permissionsFor(role).has(permission);
}

/** True when this permission starts or changes money movement. */
export const isMoneyPermission = (p: Permission): boolean => MONEY_PERMISSIONS.has(p);
