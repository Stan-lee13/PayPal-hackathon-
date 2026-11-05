/** j***@example.com — Kept never stores raw buyer email addresses. */
export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!user || !domain) return null;
  return `${user[0]}***@${domain}`;
}

/** Strip anything that looks like an email/phone before text is sent to an AI provider. */
export function scrubPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]");
}
