import { loadEnv } from "../scripts/env";

/** Point the app at the TEST database and the built-in simulators before any app module loads. */
export function useTestEnv() {
  loadEnv();
  if (!process.env.TEST_DATABASE_URL) return false;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.PAYPAL_MODE = "simulated";
  process.env.GITHUB_MODE = "simulated";
  process.env.DEMO_MODE = "true";
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
  process.env.MERGEPAY_MCP_TOKEN = "test-token-0123456789abcdef";
  delete process.env.ANTHROPIC_API_KEY; // deterministic paths in tests
  delete process.env.GITHUB_TOKEN;
  delete process.env.DEMO_REPO;
  delete process.env.MERGEPAY_SIM_PERSIST;
  delete process.env.KEPT_EMULATOR_PERSIST;
  return true;
}
