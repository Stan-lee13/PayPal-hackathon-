import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-24 text-center">
      <p className="label">404</p>
      <h1 className="display mt-3 text-4xl">Nothing in this envelope.</h1>
      <p className="mt-3 text-sm text-ink-2">That page does not exist. Envelopes, agents and receipts are found from the console.</p>
      <Link className="btn btn-ink mt-7" href="/console">Go to the console</Link>
    </main>
  );
}
