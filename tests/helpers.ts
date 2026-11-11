import { loadEnv } from "../scripts/env";

/** Point the app at the TEST database and the built-in PayPal simulator before any app module loads. */
export function useTestEnv() {
  loadEnv();
  if (!process.env.TEST_DATABASE_URL) return false;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.PAYPAL_MODE = "simulated";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ENVELOPE_SIM_PERSIST;
  return true;
}
