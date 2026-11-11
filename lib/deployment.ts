/** True when this deployment has no server database, so pages run the gateway in the visitor's browser instead. */
export const gatewayRunsInBrowser = (): boolean => !process.env.DATABASE_URL;
