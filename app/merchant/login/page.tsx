import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Merchant sign-in" };

export default function LoginPage() {
  return (
    <main id="main" className="mx-auto max-w-sm px-4 py-16">
      <p className="eyebrow">Kept · merchant console</p>
      <h1 className="quote mt-2 text-3xl">Adaeze Studio</h1>
      <p className="mt-2 text-sm text-ink-soft">Demo access uses one shared passcode. This is not production authentication.</p>
      <LoginForm />
    </main>
  );
}
