import type { APIRoute } from "astro";
import { glossary, plain } from "../lib/glossary";

/**
 * The glossary as plain text, loaded on demand when you tap a box in a diagram (src/client/diagrams.ts):
 * [{ t: term, d: [meanings], l: [lesson ids] }]
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(glossary().map((e) => ({ t: plain(e.term), d: e.meanings.map((m) => plain(m.md)), l: [...new Set(e.meanings.flatMap((m) => m.lessons))] }))), {
    headers: { "Content-Type": "application/json" },
  });
