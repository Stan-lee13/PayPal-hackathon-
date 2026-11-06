/** Public base URL: APP_BASE_URL, else the Vercel production domain, else localhost. */
export function appBaseUrl(): string {
  const v = process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return v.replace(/\/$/, "");
}
