# Post-quantum readiness for signed money

There is no quantum mechanics in this gateway, and there is not going to be one. No qubits, no quantum random
number service, no "quantum-secured ledger". Putting the word into a financial product would be decoration at
best and a false assurance at worst.

There is, however, a real quantum-era question about this codebase, and it is worth writing down: **every
authority record here is an Ed25519 signature, and some of those records are meant to be verifiable for years.**

## The exposure

An envelope's chain, a spend request, a receipt, a card's terms and the gateway's references are all signed with
Ed25519 (`lib/envelope/core.ts`). Shor's algorithm breaks that class of signature, and the threat against
signatures is not only "decrypt later": it is **harvest now, forge later** — someone who records a receipt today
and can forge a signature in ten years can produce an alternative history that verifies against a key everybody
still trusts. Receipts are used precisely as evidence about the past, which is the worst possible thing to have
retroactively forgeable.

Symmetry helps with the rest: SHA-256 and AES-256 lose half their nominal strength to Grover and remain out of
reach, so hashing and sealing are not the problem. The signatures are.

## Where the standards are

* **FIPS 204** — ML-DSA (Module-Lattice-Based Digital Signature Algorithm), final August 2024.
* **FIPS 205** — SLH-DSA (stateless hash-based signatures), final August 2024.
* **NIST IR 8547** — the transition plan: quantum-vulnerable algorithms deprecated and removed from NIST
  standards by 2035, with high-risk systems moving earlier, and hybrid schemes explicitly accommodated.

NIST's own guidance (October 2026) is that the transition takes a decade of engineering, which is why the
sensible time to make a signature format *extensible* is before there is pressure to change it in a hurry.

## What this codebase already has

Crypto agility is not a new dependency; it is a property of the format, and most of it is already here:

* **Versioned signing domains.** Receipts carry `v1`/`v2`, and spend requests and promises are signed under
  different domains, so a signature made for one purpose cannot be replayed as another.
* **Detached, verifiable records.** The browser re-verifies chains and receipts itself
  (`app/r/[id]/view.tsx`, `app/proof/view.tsx`), so a new suite can be introduced without asking anyone to trust
  the gateway's word about which algorithm was used.
* **No re-signing.** Historical receipts are never rewritten; the record is the signature that was made.
* **An honest health field.** `GET /api/health` now reports
  `signatures: { "algorithm": "Ed25519", "postQuantum": false }`. A deployment cannot quietly imply more.

## The plan, when it is worth doing

1. **A new receipt version, not a change to an old one.** `v3` carries `{ alg, sig }` (and, during the
   transition, both an Ed25519 and an ML-DSA signature). Verification dispatches on `alg`; an old receipt keeps
   verifying under the rule it was signed with, forever.
2. **Hybrid while both are trusted.** Sign with Ed25519 *and* ML-DSA-65, verify both when both are present. This
   is the conservative option NIST accommodates: a break in either scheme alone does not break the record.
3. **Test vectors before trust.** ML-DSA implementations differ on encoding details; the gate is the NIST ACVP
   vectors, not a round trip against ourselves.
4. **Size is a product decision.** An ML-DSA-65 public key is about 1.9 KB and a signature about 3.3 KB, against
   32 and 64 bytes today. Every envelope link, SDK payload and stored receipt grows, so this is a milestone with
   a migration, not a pull request.

None of that is done here, deliberately: a half-migrated signature format is worse than the current one, because
it would put records in the world that some verifiers accept and others do not. What is done is the part that
costs nothing and prevents self-deception: the seam is documented, the format is versioned, and the health
endpoint states the algorithm and its post-quantum status plainly.

## References

* NIST, *Transition to Post-Quantum Cryptography Standards* (IR 8547), October 2026 —
  <https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8547.pdf>
* NIST, *Module-Lattice-Based Digital Signature Standard* (FIPS 204), August 2024 —
  <https://csrc.nist.gov/pubs/fips/204/final>
* NIST, *Stateless Hash-Based Digital Signature Standard* (FIPS 205), August 2024 —
  <https://csrc.nist.gov/pubs/fips/205/final>
* NIST NCCoE, *Migration to Post-Quantum Cryptography* —
  <https://pages.nist.gov/nccoe-migration-post-quantum-cryptography>
