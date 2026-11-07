import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Login() {
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-sm px-4 py-16">
        <Link href="/" className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></Link>
        <h1 className="mt-6 text-2xl font-semibold">Freelancer dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Demo access: the passcode is in the project&rsquo;s testing instructions. The <Link className="link" href="/demo">live demo</Link> needs no sign-in.</p>
        <LoginForm />
      </main>
    </>
  );
}
