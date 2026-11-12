/**
 * Runs the attack corpus (tests/attack-corpus.ts) with one test per attack: each must be refused and
 * must move no money beyond the legitimate moves the case itself makes.
 *
 * The corpus is one script, because many attacks build on the state the ones before them left behind
 * (a spent budget, a revoked envelope, a used request). So the tests do not each start a world of
 * their own: the corpus is listed first (set-up runs, no attack does) to learn the names, then it is
 * run once for real and held at the door of every attack until that attack's own test lets it in.
 * The body of a test is therefore the attack itself, and a failure names the attack that got through.
 */
import { afterAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import { runCorpus, type AttackRow } from "./attack-corpus";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("attack corpus (simulated PayPal)", async () => {
  if (!enabled) return;
  const { corpusDeps } = await import("./attack-deps");
  const deps = await corpusDeps();
  const listed = await runCorpus(deps, { listOnly: true });

  // ---- the corpus, run once, one attack at a time -------------------------------------------------
  const rows: AttackRow[] = [];
  let admit: (() => void) | null = null;             // lets the attack waiting at the door run
  let waiting: Promise<void> = Promise.resolve();    // resolves when an attack is at the door
  let arrived: () => void = () => {};
  let landed: (() => void) | null = null;            // resolves the test waiting for the next row
  let finished = false, failure: unknown = null;
  let leaving = false;                               // set when the tests are over: whatever is left runs through unattended
  let corpus: Promise<void> | null = null;
  const expectArrival = () => { waiting = new Promise<void>((r) => { arrived = r; }); };

  function start() {
    expectArrival();
    corpus = runCorpus(deps, {
      before: () => (leaving ? Promise.resolve() : new Promise<void>((go) => { admit = go; arrived(); })),
      after: (row) => { rows.push(row); landed?.(); },
    }).then(() => { finished = true; }, (e) => { failure = e ?? new Error("the corpus stopped"); finished = true; }).then(() => { arrived(); landed?.(); });
  }

  /** The row of attack `i`, running the corpus forward as far as needed (so one test can be run alone). */
  async function rowOf(i: number): Promise<AttackRow> {
    if (!corpus) start();
    while (rows.length <= i) {
      await waiting;
      if (failure) throw failure;
      if (finished) throw new Error(`the corpus ended after ${rows.length} attacks; attack ${i + 1} was never run`);
      const next = new Promise<void>((r) => { landed = r; });
      expectArrival();
      const go = admit!; admit = null; go();
      await next;
      if (failure) throw failure;
    }
    return rows[i]!;
  }

  for (const [i, l] of listed.entries()) {
    it(`${l.category} · ${l.attack}`, async () => {
      const row = await rowOf(i);
      expect({ category: row.category, attack: row.attack }).toEqual({ category: l.category, attack: l.attack });
      expect(row.refused, `not refused: ${row.how}`).toBe(true);
      expect(row.moneyMoved, `PayPal was asked to move money it should not have (${row.how})`).toBe(false);
    }, 60_000);
  }

  it("every listed attack was run exactly once, in order, and the corpus ran to its end", async () => {
    await rowOf(listed.length - 1);
    await waiting;                                    // the corpus has nothing further to run…
    expect(admit).toBeNull();                         // …so no unlisted attack is at the door
    expect(finished).toBe(true);
    expect(failure).toBeNull();
    expect(rows.map((r) => `${r.category} · ${r.attack}`)).toEqual(listed.map((r) => `${r.category} · ${r.attack}`));
    expect(new Set(rows.map((r) => `${r.category} · ${r.attack}`)).size).toBe(rows.length); // no attack counted twice
    expect(rows.length).toBeGreaterThanOrEqual(169);
    expect(new Set(rows.map((r) => r.category)).size).toBe(11);
    expect(rows.filter((r) => !r.refused || r.moneyMoved)).toEqual([]);
  }, 120_000);

  // When only some tests were asked for, let the rest of the corpus finish before the next file touches the database.
  afterAll(async () => { leaving = true; if (admit) { const go = admit; admit = null; go(); } await corpus; }, 120_000);
});
