import { NextRequest, NextResponse } from "next/server";
import { fetchMatches, FootballDataError, type Match } from "@/lib/football";
import {
  judgeMatch,
  summarizeMatch,
  type DecisionResult,
  type UserPrefs,
} from "@/lib/typesafe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PREFS: UserPrefs = {
  backend: "auto",
  weights: { excitement: 0.4, stakes: 0.25, rivalry: 0.2, atmosphere: 0.15 },
  preferTopLeagues: true,
  preferLive: false,
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<{
      prefs: UserPrefs;
      dateFrom: string;
      dateTo: string;
      competitions: string;
      limit: number;
      matchId: number;
    }>;

    const prefs = body.prefs ?? DEFAULT_PREFS;
    const competitions = body.competitions ?? "PL,PD,BL1,SA,FL1,CL";
    const limit = Math.min(Math.max(body.limit ?? 6, 1), 12);

    let matches: Match[];
    if (body.matchId) {
      // Single-match mode is handled by re-running the same fetcher; for now
      // we just refetch the day window and filter. (Vercel cache keeps it cheap.)
      const all = await fetchMatches({ competitions });
      matches = all.filter((m) => m.id === body.matchId);
    } else {
      matches = await fetchMatches({
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        competitions,
      });
    }

    // Only judge non-finished matches — the decision playground is about future / live games.
    const candidates = matches
      .filter(
        (m) =>
          m.status === "SCHEDULED" ||
          m.status === "TIMED" ||
          m.status === "LIVE" ||
          m.status === "IN_PLAY",
      )
      .slice(0, limit);

    if (candidates.length === 0) {
      return NextResponse.json({
        results: [] as DecisionResult[],
        message:
          "No scheduled or live matches in the current window. Try widening competitions.",
      });
    }

    // Judge each match in parallel. With backend = "auto", every per-match
    // failure falls back to the local heuristic independently, so one bad
    // upstream call doesn't break the whole ranking.
    const fallbackNotes: string[] = [];
    const decisions = await Promise.all(
      candidates.map((m) =>
        judgeMatch(summarizeMatch(m), prefs, {
          onTypesafeError: (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (!fallbackNotes.includes(msg)) fallbackNotes.push(msg);
          },
        }),
      ),
    );
    const usedLocalOnly = decisions.every((d) => d.backend === "local");

    // Rank by composite score; ties broken by confidence.
    decisions.sort((a, b) => {
      if (b.answers.composite !== a.answers.composite) {
        return b.answers.composite - a.answers.composite;
      }
      return b.answers.confidence - a.answers.confidence;
    });

    return NextResponse.json({
      results: decisions,
      prefs,
      note: usedLocalOnly
        ? prefs.backend === "local"
          ? "Using Needle 3 judge (offline, powered by needle3.cact)."
          : "TypeSafe was unavailable — serving all results with the Needle 3 judge."
        : fallbackNotes.length > 0
          ? `Some matches used the Needle 3 fallback (${fallbackNotes[0]}).`
          : undefined,
    });
  } catch (e) {
    if (e instanceof FootballDataError) {
      // Surface a clear, actionable error instead of a generic 500.
      const status = e.status === 401 || e.status === 403 ? 503 : 502;
      return NextResponse.json(
        {
          error: "football-data upstream failure",
          upstream: { status: e.status, message: e.message },
          hint:
            e.status === 401 || e.status === 403
              ? "Set FOOTBALL_DATA_API_KEY in .env.local to a real X-Auth-Token from https://www.football-data.org/."
              : "football-data.org is having trouble. Try again in a minute.",
        },
        { status },
      );
    }
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
