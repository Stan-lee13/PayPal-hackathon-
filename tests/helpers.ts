import { loadEnv } from "../scripts/env";

/** Point the app at the TEST database and the local PayPal emulator before any app module loads. */
export function useTestEnv() {
  loadEnv();
  if (!process.env.TEST_DATABASE_URL) return false;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.PAYPAL_MODE = "simulated";
  process.env.DEMO_MODE = "true";
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
  delete process.env.ANTHROPIC_API_KEY; // deterministic paths in tests
  return true;
}
