/**
 * Locks for the in-browser database, shared by every tab of this site.
 *
 * They are Web Locks, so the browser itself gives one back the moment the tab holding it closes,
 * reloads or crashes. A lock kept in a worker's memory cannot do that: a tab that went away while
 * waiting for it would be handed the lock later and never return it, and every other tab would wait
 * for good.
 */

/** One tab at a time may run a statement or a transaction against the shared database. */
export const TRANSACTION_LOCK = "envelope-gateway:transaction";

/** Take a Web Lock and keep it until the returned function is called, or until this context goes away. */
export function hold(name: string): Promise<() => void> {
  return new Promise((taken) => {
    void navigator.locks.request(name, () => new Promise<void>((release) => taken(release)));
  });
}

/** Run one thing at a time, in the order asked, whether or not the one before it failed. */
export function inTurn() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
}
