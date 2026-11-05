import type { ChatMessage } from "../db/schema";

/**
 * Serialise a chat into an immutable transcript source.
 *
 * Every message is forced onto ONE line that starts with a role tag Kept
 * controls. Customer text cannot forge an "ASSISTANT" line because newlines are
 * flattened and the prefix is always written by us. The validator relies on
 * this to reject promises that were only *claimed* by the customer.
 */
export const ASSISTANT_TAG = "ASSISTANT";
export const CUSTOMER_TAG = "CUSTOMER";
/** The shopper's own AI agent, negotiating on their behalf (agent mode). */
export const BUYER_AGENT_TAG = "BUYER_AGENT";

export function serializeTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const tag = m.role === "assistant" ? ASSISTANT_TAG : m.role === "agent" ? BUYER_AGENT_TAG : CUSTOMER_TAG;
      const text = m.text.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
      return `${tag} [${m.at}]: ${text}`;
    })
    .join("\n");
}

/** Returns the role of the transcript line that contains [start, end), or null if it spans lines. */
export function speakerAt(transcript: string, start: number, end: number): "assistant" | "customer" | "agent" | null {
  const lineStart = transcript.lastIndexOf("\n", start - 1) + 1;
  const nl = transcript.indexOf("\n", start);
  const lineEnd = nl === -1 ? transcript.length : nl;
  if (end > lineEnd) return null;
  const line = transcript.slice(lineStart, lineEnd);
  const header = line.match(/^(ASSISTANT|CUSTOMER|BUYER_AGENT) \[[^\]]*\]: /);
  if (!header) return null;
  // the quote must lie in the message body, not inside the tag itself
  if (start < lineStart + header[0].length) return null;
  return header[1] === ASSISTANT_TAG ? "assistant" : header[1] === BUYER_AGENT_TAG ? "agent" : "customer";
}
