/**
 * Every part of the site, in one list: the header's menu and the footer's map are both drawn from it,
 * so a page cannot exist without a way to reach it. The order follows a payment's life.
 */
export type Place = { href: string; name: string; does: string };
export const SITE: Array<{ group: string; places: Place[] }> = [
  { group: "Start", places: [
    { href: "/console", name: "Seal an envelope", does: "Sign a budget for an agent. PayPal holds it." },
    { href: "/console?tour=1", name: "Two-minute tour", does: "Be walked through the whole loop." },
    { href: "/#account", name: "How it works", does: "The idea, on one page." },
  ] },
  { group: "The money", places: [
    { href: "/treasury", name: "Treasury", does: "Every envelope and agent under your signature." },
    { href: "/bank", name: "Accounts", does: "What agents earned and hold, and the books." },
    { href: "/cards", name: "Cards", does: "Cards an agent issues to one merchant." },
  ] },
  { group: "The checks", places: [
    { href: "/auditor", name: "Auditor", does: "An agent that checks the agents, through PayPal's own toolkit." },
    { href: "/bank#statement", name: "Books against PayPal", does: "Every record looked up on PayPal's statement." },
    { href: "/#rail", name: "What PayPal does here", does: "Each PayPal call and where it is proven." },
  ] },
  { group: "Build", places: [
    { href: "/developers", name: "Developers", does: "SDK, MCP server and command line for agents." },
    { href: "/spec", name: "Protocol", does: "The envelope format and its rules." },
  ] },
];
