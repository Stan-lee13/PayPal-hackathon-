import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="eyebrow">404</p>
      <h1 className="quote mt-2 text-3xl">Nothing here.</h1>
      <p className="mt-2 text-sm text-ink-soft">Receipt links are private and unguessable; check you copied the whole link.</p>
      <Link className="btn mt-6" href="/">Home</Link>
    </main>
  );
}
