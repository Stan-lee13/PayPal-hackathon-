import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, orders } from "../db/schema";
import { UserFacingError } from "./orders";

export async function assertCommitmentOwned(id: string, merchantId: string) {
  const c = await getDb().query.commitments.findFirst({ where: and(eq(commitments.id, id), eq(commitments.merchantId, merchantId)) });
  if (!c) throw new UserFacingError("Promise not found.", 404);
  return c;
}

export async function assertOrderOwned(id: string, merchantId: string) {
  const o = await getDb().query.orders.findFirst({ where: and(eq(orders.id, id), eq(orders.merchantId, merchantId)) });
  if (!o) throw new UserFacingError("Order not found.", 404);
  return o;
}
