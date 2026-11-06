/** An error whose message is safe and useful to show to the person (or agent) who caused it. */
export class UserFacingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}
