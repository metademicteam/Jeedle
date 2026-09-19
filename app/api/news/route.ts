import { NextResponse } from "next/server";
import {
  getNeedle3News,
  loadNeedle3,
  searchNewsWithTypeSafe,
} from "../../../lib/typesafe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/news?q=<terms>&limit=<n>
//
// When `q` is set, the route delegates headline selection to TypeSafe Jev,
// which judges each candidate headline against the user's query as a
// semantic relevance check. The headline corpus and the user query are
// shipped to Jev as a structured `state`, Jev answers a yes/no question
// per headline, and we keep the ones whose confidence clears a threshold
// (>= 0.5), ordered by confidence.
//
// If TYPESAFE_API_KEY is missing or the upstream errors, the search
// silently falls back to the local Needle 3 substring matcher so the
// page never sits empty.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.max(
      1,
      Math.min(12, parseInt(url.searchParams.get("limit") ?? "6", 10) || 6),
    );

    const needle = loadNeedle3();

    if (q) {
      const result = await searchNewsWithTypeSafe(q, limit);
      return NextResponse.json(
        {
          query: q,
          items: result.hits.map((h) => h.item),
          confidences: result.hits.map((h) => Number(h.confidence.toFixed(2))),
          source: result.backend, // "typesafe" or "needle3"
          error: result.error,
          needle3: {
            byteLength: needle.byteLength,
            sha256: needle.sha256,
          },
        },
        {
          headers: {
            // Search results depend on user input — never serve stale hits.
            "Cache-Control": "public, max-age=60",
          },
        },
      );
    }

    const items = getNeedle3News(q, limit);
    return NextResponse.json(
      {
        query: q,
        items,
        source: needle.news ? "needle3" : "needle3-fallback",
        needle3: {
          byteLength: needle.byteLength,
          sha256: needle.sha256,
        },
      },
      {
        headers: {
          // News headlines can be cached for a short window so the navbar
          // refresh button doesn't hammer the corpus on every tap.
          "Cache-Control": "public, max-age=60",
        },
      },
    );
  } catch (err) {
    // Surface a JSON error so the UI can show it instead of a blank page.
    return NextResponse.json(
      {
        error: "news route failed",
        hint:
          err instanceof Error ? err.message : "unknown error in /api/news",
      },
      { status: 500 },
    );
  }
}
