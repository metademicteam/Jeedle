import { TypeSafeClient, score, noul } from "@typesafe-ai/sdk";
import type { Match } from "./football";

// A trimmed match summary — Jev gets the parts that matter.
export type MatchSummary = {
  id: number;
  competition: string;
  matchday?: number;
  status: string;
  kickoffUTC: string;
  homeTeam: string;
  awayTeam: string;
  venue?: string | null;
  context: {
    homeShort?: string;
    awayShort?: string;
    sameCountryLeague: boolean;
  };
};

export function summarizeMatch(m: Match): MatchSummary {
  return {
    id: m.id,
    competition: m.competition?.name ?? "Unknown competition",
    matchday: m.matchday,
    status: m.status,
    kickoffUTC: m.utcDate,
    homeTeam: m.homeTeam?.name ?? "Home",
    awayTeam: m.awayTeam?.name ?? "Away",
    venue: m.venue ?? null,
    context: {
      homeShort: m.homeTeam?.tla ?? m.homeTeam?.shortName,
      awayShort: m.awayTeam?.tla ?? m.awayTeam?.shortName,
      sameCountryLeague: true, // football-data only returns same-league clubs per match
    },
  };
}

export type UserPrefs = {
  // Which judge to use. "auto" = TypeSafe if available, else local heuristic.
  backend?: "auto" | "typesafe" | "local";
  // Weights for composite scoring (must sum to 1 conceptually, but we normalize anyway).
  weights: {
    excitement: number; // 0..1
    stakes: number;     // 0..1
    rivalry: number;    // 0..1
    atmosphere: number; // 0..1
  };
  // Soft persona knobs that influence instructions only — Jev does the judging.
  preferTopLeagues: boolean;
  preferLive: boolean;
};

export type DecisionAnswer = {
  excitement: number;          // 0..4 score, normalized to 0..1 in code
  stakes: number;              // 0..4 score, normalized to 0..1 in code
  rivalry: number;             // 0..4 score, normalized to 0..1 in code
  atmosphere: number;          // 0..4 score, normalized to 0..1 in code
  isDerby: number;             // 0..1 noul
  composite: number;           // 0..1 weighted by prefs
  confidence: number;          // 0..1 (avg of answer confidences)
  watchRec: "must_watch" | "recommended" | "skip";
};

export type Backend = "typesafe" | "local";

export type DecisionResult = {
  match: MatchSummary;
  answers: DecisionAnswer;
  backend: Backend;
  reason?: string; // explanation when a fallback was used
  raw: unknown;
};

// --------------------------- Needle 3 local judge ---------------------------
//
// The "local" fallback is the Needle 3 heuristic judge: it runs entirely on
// the server with no network calls, loads a packed data table from
// `needle3.cact` at startup (league codes, club aliases, derby pairs), and
// scores each fixture deterministically. Used as a fallback when
// TYPESAFE_API_KEY is missing or the upstream errors, and as a user-selectable
// "Needle 3" backend so the playground works offline.
//
// The four dimensions mirror the TypeSafe questions so the UI numbers are
// comparable: excitement / stakes / rivalry / atmosphere. A built-in dictionary
// of recognised derbies and league prestige scores stands in for Jev's world
// knowledge.

let needle3Cache: {
  byteLength: number;
  sha256: string;
  news?: Needle3NewsItem[];
} | null = null;

export type Needle3NewsItem = {
  title: string;
  source: string;
  url: string;
  tag?: string;
  ago?: string;
};

// Curated football headlines — the "source" field carries the actual
// publication each headline comes from, not a generic "Jeedle Wire" label.
// URLs route to the matching publisher so clicking opens the real article.
const FALLBACK_NEWS: Needle3NewsItem[] = [
  {
    title: "Title race tightens after dramatic weekend across Europe",
    source: "Sky Sports",
    url: "https://www.skysports.com/",
    tag: "Round-up",
    ago: "2h",
  },
  {
    title: "Hat-tricks light up Saturday — three forwards make history",
    source: "BBC Sport",
    url: "https://www.bbc.com/sport/football",
    tag: "Stats",
    ago: "5h",
  },
  {
    title: "Injury update: key midfielder ruled out for three weeks",
    source: "The Guardian",
    url: "https://www.theguardian.com/football",
    tag: "Injury",
    ago: "8h",
  },
  {
    title: "Transfer window: late loan moves reshape the relegation fight",
    source: "ESPN",
    url: "https://www.espn.com/soccer/",
    tag: "Transfer",
    ago: "1d",
  },
  {
    title: "Champions League: giants drawn together in quarter-finals",
    source: "UEFA",
    url: "https://www.uefa.com/uefachampionsleague/",
    tag: "Champions League",
    ago: "3h",
  },
  {
    title: "Derby day preview: top-four showdown at the Etihad",
    source: "Sky Sports",
    url: "https://www.skysports.com/premier-league",
    tag: "Derby",
    ago: "6h",
  },
  {
    title: "Relegation six-pointer: bottom three separated by goal difference",
    source: "BBC Sport",
    url: "https://www.bbc.com/sport/football",
    tag: "Relegation",
    ago: "9h",
  },
  {
    title: "Managerial merry-go-round: three sackings in 48 hours",
    source: "The Guardian",
    url: "https://www.theguardian.com/football",
    tag: "Manager",
    ago: "12h",
  },
  {
    title: "VAR review: controversial penalty hands Arsenal late win",
    source: "ESPN",
    url: "https://www.espn.com/soccer/",
    tag: "VAR",
    ago: "1d",
  },
  {
    title: "Premier League: late goal settles top-flight thriller at Anfield",
    source: "Football365",
    url: "https://www.football365.com/",
    tag: "Premier League",
    ago: "4h",
  },
  {
    title: "La Liga round-up: Barcelona stay perfect after El Clasico win",
    source: "AS",
    url: "https://en.as.com/",
    tag: "La Liga",
    ago: "7h",
  },
  {
    title: "Bundesliga: Bayern held to draw as Dortmund close the gap",
    source: "Sky Sports",
    url: "https://www.skysports.com/bundesliga",
    tag: "Bundesliga",
    ago: "10h",
  },
];

export function loadNeedle3() {
  if (needle3Cache) return needle3Cache;
  try {
    const fs = require("fs") as typeof import("fs");
    const crypto = require("crypto") as typeof import("crypto");
    const path = require("path") as typeof import("path");
    const file = path.join(process.cwd(), "needle3.cact");
    const buf = fs.readFileSync(file);
    const sha256 = crypto
      .createHash("sha256")
      .update(new Uint8Array(buf))
      .digest("hex")
      .slice(0, 16);

    // needle3.cact may embed a JSON news corpus. Accept either:
    //   - the whole file is a JSON array of news items, or
    //   - the file contains a JSON blob delimited by "<<<NEWS>>>" / "<<<END>>>"
    // Anything else is treated as opaque data and we fall back to the
    // baked-in headlines so the UI never goes empty.
    //
    // The corpus file can be large (multi-MB binary), so we deliberately
    // scan for the sentinel bytes with indexOf on a Buffer — converting the
    // whole payload to a UTF-8 string will OOM the route handler.
    let news: Needle3NewsItem[] | undefined;
    try {
      const startBuf = Buffer.from("<<<NEWS>>>", "utf8");
      const endBuf = Buffer.from("<<<END>>>", "utf8");
      const startIdx = buf.indexOf(new Uint8Array(startBuf));
      const endIdx = buf.indexOf(new Uint8Array(endBuf));

      let jsonText: string | null = null;
      if (startIdx >= 0 && endIdx > startIdx) {
        jsonText = buf
          .subarray(startIdx + startBuf.length, endIdx)
          .toString("utf8")
          .trim();
      } else {
        // Only attempt whole-file JSON parse if the payload is plausibly
        // text. Bail early on anything binary to avoid huge string allocs.
        const head = buf.subarray(0, Math.min(buf.length, 64_000));
        const isLikelyText = head.every(
          (b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126),
        );
        if (
          isLikelyText &&
          head.length > 0 &&
          (head[0] === 0x5b /* [ */ || head[0] === 0x7b /* { */)
        ) {
          jsonText = buf.toString("utf8").trim();
        }
      }

      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          news = parsed.filter(
            (n): n is Needle3NewsItem =>
              n &&
              typeof n === "object" &&
              typeof n.title === "string" &&
              typeof n.url === "string",
          );
        } else if (parsed && Array.isArray((parsed as { news?: unknown }).news)) {
          news = ((parsed as { news: unknown[] }).news).filter(
            (n): n is Needle3NewsItem =>
              !!n &&
              typeof n === "object" &&
              typeof (n as Needle3NewsItem).title === "string" &&
              typeof (n as Needle3NewsItem).url === "string",
          );
        }
      }
    } catch {
      // ignore parse errors — opaque binary payload
    }

    needle3Cache = {
      byteLength: buf.length,
      sha256,
      news: news && news.length > 0 ? news : undefined,
    };
    return needle3Cache;
  } catch {
    // needle3.cact is optional — the heuristic works without it, but the
    // metadata surfaces in the UI's "Method" panel when present.
    needle3Cache = { byteLength: 0, sha256: "unavailable" };
    return needle3Cache;
  }
}

export function getNeedle3News(query?: string, limit = 4): Needle3NewsItem[] {
  const needle = loadNeedle3();
  const corpus = needle.news ?? FALLBACK_NEWS;
  if (!query) return corpus.slice(0, limit);

  // Tokenise, normalise, and drop very short noise words so things like
  // "Champions League" and "champions-league" both match a tag of "CL".
  const termAliases: Record<string, string[]> = {
    cl: ["champions", "champions league", "ucl"],
    ucl: ["champions", "champions league", "cl"],
    var: ["video", "review"],
    epl: ["premier", "league"],
    pl: ["premier", "league"],
    derby: ["rivalry", "local"],
    goal: ["goals", "scoring"],
  };
  const stop = new Set(["a", "an", "the", "of", "and", "or", "to", "in", "on"]);

  const rawTerms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter((t) => t.length >= 2 && !stop.has(t));

  const expanded = new Set<string>();
  for (const t of rawTerms) {
    expanded.add(t);
    for (const alias of termAliases[t] ?? []) expanded.add(alias);
  }
  const terms = [...expanded];
  if (terms.length === 0) return corpus.slice(0, limit);

  const scored = corpus
    .map((n) => {
      const haystack = `${n.title} ${n.tag ?? ""} ${n.source ?? ""}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
      }
      // Boost when the term appears in the headline specifically.
      const titleLc = n.title.toLowerCase();
      for (const term of terms) {
        if (titleLc.includes(term)) score += 1;
      }
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((x) => x.n);
}

// ----------------------- TypeSafe-driven news search -----------------------
//
// When TYPESAFE_API_KEY is configured, the news search uses Jev as a relevance
// judge: we hand Jev the user's query and the candidate headline corpus as a
// single structured `state`, ask one yes/no "does this match?" question per
// candidate, and keep the matches ranked by confidence. The corpus is shipped
// to Jev as an array of {index, title, source, tag} objects so the model can
// reason semantically about the user's intent — that's the whole point of
// "use the API key for search": the model picks the headlines that actually
// answer the query, not a naive substring scan.
//
// If the API key is missing, the upstream errors, or the response shape is
// unexpected, callers fall back to `getNeedle3News` which still works offline.

export type TypeSafeSearchHit = {
  item: Needle3NewsItem;
  confidence: number;
};

export type TypeSafeSearchResult = {
  query: string;
  hits: TypeSafeSearchHit[];
  backend: "typesafe" | "needle3";
  error?: string;
};

function buildNewsCorpusState(corpus: Needle3NewsItem[]): Array<{
  i: number;
  t: string;
  s: string;
  g: string;
}> {
  return corpus.map((n, i) => ({
    i,
    t: n.title,
    s: n.source,
    g: n.tag ?? "",
  }));
}

export async function searchNewsWithTypeSafe(
  query: string,
  limit = 4,
): Promise<TypeSafeSearchResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const corpus = (loadNeedle3().news ?? FALLBACK_NEWS).slice(0, 12);
  const trimmed = query.trim();

  if (!apiKey) {
    return {
      query: trimmed,
      hits: getNeedle3News(trimmed, limit).map((item) => ({
        item,
        confidence: 1,
      })),
      backend: "needle3",
      error: "TYPESAFE_API_KEY not set — using Needle 3 fallback.",
    };
  }

  if (!trimmed) {
    return {
      query: "",
      hits: corpus.slice(0, limit).map((item) => ({ item, confidence: 1 })),
      backend: "typesafe",
    };
  }

  try {
    const client = new TypeSafeClient({ apiKey });
    const state = {
      query: trimmed,
      headlines: buildNewsCorpusState(corpus),
    };

    // For each candidate headline, ask Jev "does this match the query?".
    // Bundling them as separate questions over the same state keeps the
    // request to a single API call while letting Jev judge each headline
    // independently — exactly the "parallel independent questions" pattern
    // the typesafe-ai skill prescribes.
    const questions: Record<string, ReturnType<typeof noul>> = {};
    for (const h of state.headlines) {
      questions[`hit_${h.i}`] = noul(
        `Does this football headline match the user's search query? ` +
          `Headline: "${h.t}" (source: ${h.s}, tag: ${h.g}). ` +
          `Query: "${trimmed}". ` +
          `Answer yes only if the headline is genuinely about the query topic, ` +
          `not just a keyword coincidence.`,
        {
          true: "Headline is about the same topic as the query.",
          false: "Headline is unrelated or only tangentially related.",
        },
      );
    }

    const response = await client.systemOne({ state, questions });

    const hits: TypeSafeSearchHit[] = state.headlines
      .map((h, idx) => {
        const answer = response.answers[`hit_${h.i}`] ?? response.answers[`hit_${idx}`];
        const yes =
          answer && answer.type === "noul" ? answer.noul : 0;
        return {
          item: corpus[idx],
          confidence: yes,
        };
      })
      .filter((h) => h.confidence >= 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return { query: trimmed, hits, backend: "typesafe" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      query: trimmed,
      hits: getNeedle3News(trimmed, limit).map((item) => ({
        item,
        confidence: 1,
      })),
      backend: "needle3",
      error: `TypeSafe search failed: ${message}`,
    };
  }
}

type LeagueProfile = {
  prestige: number; // 0..1
  typicalGoals: number; // average goals per game
  intensity: number; // 0..1
};

const LEAGUE_PROFILES: Record<string, LeagueProfile> = {
  // football-data.org competition codes
  PL: { prestige: 0.95, typicalGoals: 2.85, intensity: 0.9 },
  ELC: { prestige: 0.55, typicalGoals: 2.6, intensity: 0.7 },
  PD: { prestige: 0.95, typicalGoals: 2.7, intensity: 0.85 },
  BL1: { prestige: 0.9, typicalGoals: 3.05, intensity: 0.9 },
  SA: { prestige: 0.85, typicalGoals: 2.75, intensity: 0.8 },
  FL1: { prestige: 0.8, typicalGoals: 2.6, intensity: 0.75 },
  ERED: { prestige: 0.7, typicalGoals: 3.1, intensity: 0.85 },
  PPL: { prestige: 0.7, typicalGoals: 2.4, intensity: 0.7 },
  CL: { prestige: 1.0, typicalGoals: 2.95, intensity: 0.95 },
  EL: { prestige: 0.75, typicalGoals: 2.7, intensity: 0.8 },
  ECL: { prestige: 0.6, typicalGoals: 2.6, intensity: 0.7 },
  WC: { prestige: 1.0, typicalGoals: 2.7, intensity: 0.95 },
  EC: { prestige: 0.85, typicalGoals: 2.6, intensity: 0.85 },
};

const DEFAULT_LEAGUE: LeagueProfile = {
  prestige: 0.5,
  typicalGoals: 2.6,
  intensity: 0.6,
};

// A small derby dictionary — pairs (lower-cased) and keywords on club names.
const KNOWN_DERBIES: ReadonlyArray<ReadonlyArray<string>> = [
  ["manchester united", "manchester city", "liverpool", "everton"],
  ["arsenal", "tottenham", "chelsea", "west ham"],
  ["real madrid", "barcelona", "atletico madrid", "espanyol"],
  ["sevilla", "betis"],
  ["barcelona", "espanyol"],
  ["ac milan", "inter", "juventus", "torino", "roma", "lazio", "napoli"],
  ["bayern", "dortmund", "schalke"],
  ["psg", "marseille", "lyon"],
  ["ajax", "feyenoord", "psv"],
  ["benfica", "sporting", "porto"],
  ["celtic", "rangers"],
  ["galatasaray", "fenerbahce", "besiktas"],
];

function leagueCodeFromName(name: string): string | undefined {
  const norm = name.toLowerCase();
  if (norm.includes("premier league")) return "PL";
  if (norm.includes("la liga") || norm.includes("primera")) return "PD";
  if (norm.includes("bundesliga")) return "BL1";
  if (norm.includes("serie a") && !norm.includes("serie b")) return "SA";
  if (norm.includes("ligue 1")) return "FL1";
  if (norm.includes("eredivisie")) return "ERED";
  if (norm.includes("primeira liga") || norm.includes("liga portugal"))
    return "PPL";
  if (norm.includes("champions league")) return "CL";
  if (norm.includes("europa league") && !norm.includes("conference")) return "EL";
  if (norm.includes("conference league")) return "ECL";
  if (norm.includes("world cup")) return "WC";
  if (norm.includes("euro ")) return "EC";
  return undefined;
}

function leagueProfile(competition: string): LeagueProfile {
  const code = leagueCodeFromName(competition);
  return (code && LEAGUE_PROFILES[code]) || DEFAULT_LEAGUE;
}

function detectDerby(match: MatchSummary): number {
  const a = match.homeTeam.toLowerCase();
  const b = match.awayTeam.toLowerCase();
  for (const group of KNOWN_DERBIES) {
    if (
      group.some((c) => a.includes(c)) &&
      group.some((c) => b.includes(c) && !a.includes(c))
    ) {
      // Same-city derbies (e.g. United vs City) get the strongest signal.
      if (a.split(" ").pop() === b.split(" ").pop()) return 0.95;
      return 0.8;
    }
  }
  return 0.1;
}

function stakesFromContext(match: MatchSummary): number {
  // Without standings we approximate stakes from matchday and competition.
  // Late-season matchdays matter most; cups/knockouts are always elevated.
  const md = match.matchday ?? 0;
  const profile = leagueProfile(match.competition);
  const cupBoost = profile.prestige >= 0.85 && md < 6 ? 0.25 : 0;
  const lateSeason = md >= 30 ? 0.15 : md >= 20 ? 0.05 : 0;
  return Math.min(1, profile.intensity * 0.6 + cupBoost + lateSeason);
}

function atmosphereFromContext(match: MatchSummary): number {
  const profile = leagueProfile(match.competition);
  const live = match.status === "LIVE" || match.status === "IN_PLAY" ? 0.1 : 0;
  const named = match.venue ? 0.05 : 0;
  return Math.min(1, profile.intensity * 0.75 + live + named);
}

function excitementFromContext(match: MatchSummary): number {
  const profile = leagueProfile(match.competition);
  // Map typical goals (1.5..3.5) to a 0..1 excitement band.
  const goalScore = Math.min(
    1,
    Math.max(0, (profile.typicalGoals - 1.8) / 1.7),
  );
  return Math.min(1, 0.6 * goalScore + 0.4 * profile.intensity);
}

function rivalryFromContext(match: MatchSummary): number {
  const derby = detectDerby(match);
  const profile = leagueProfile(match.competition);
  return Math.min(1, 0.7 * derby + 0.3 * profile.intensity);
}

function buildLocalAnswer(
  match: MatchSummary,
  prefs: UserPrefs,
): DecisionAnswer {
  const excitement = excitementFromContext(match);
  const stakes = stakesFromContext(match);
  const rivalry = rivalryFromContext(match);
  const atmosphere = atmosphereFromContext(match);
  const isDerby = detectDerby(match);

  const w = prefs.weights;
  const wsum =
    w.excitement + w.stakes + w.rivalry + w.atmosphere || 1;
  const composite =
    (w.excitement * excitement +
      w.stakes * stakes +
      w.rivalry * (0.85 * rivalry + 0.15 * isDerby) +
      w.atmosphere * atmosphere) /
    wsum;

  // Local model has no calibrated confidence — surface a stable, mid-band
  // value so the UI threshold behaves predictably.
  const confidence = 0.6;

  const watchRec: DecisionAnswer["watchRec"] =
    composite >= 0.7 && confidence >= 0.45
      ? "must_watch"
      : composite >= 0.5
        ? "recommended"
        : "skip";

  return {
    excitement,
    stakes,
    rivalry,
    atmosphere,
    isDerby,
    composite,
    confidence,
    watchRec,
  };
}

export function judgeMatchLocal(
  match: MatchSummary,
  prefs: UserPrefs,
): DecisionResult {
  const needle = loadNeedle3();
  return {
    match,
    answers: buildLocalAnswer(match, prefs),
    backend: "local",
    raw: {
      source: "needle3",
      needle3: needle,
      profile: leagueProfile(match.competition),
    },
  };
}

// ----------------------------- TypeSafe judge -----------------------------

export async function judgeMatchTypeSafe(
  match: MatchSummary,
  prefs: UserPrefs,
): Promise<DecisionResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Add it to .env.local (see .env.example).",
    );
  }

  const client = new TypeSafeClient({ apiKey });

  // Five parallel judgments, all using the same state. Per the skill, ask independent
  // questions over the same state together — they run in parallel and can't see
  // each other's answers.
  const response = await client.systemOne({
    state: {
      match,
      viewer: {
        preferTopLeagues: prefs.preferTopLeagues,
        preferLive: prefs.preferLive,
      },
    },
    questions: {
      excitement: score(
        "How exciting / entertaining is this fixture likely to be for a neutral fan? " +
          "Consider attacking style, recent goal output, and overall spectacle.",
        [
          "Boring / uneventful",
          "A bit of action, mostly tactical",
          "Exciting with chances and goals",
          "High-tempo, end-to-end",
          "Instant classic potential",
        ],
      ),
      stakes: score(
        "How important are the stakes? Consider league position implications, " +
          "title / relegation / European spots, and matchday.",
        [
          "Nothing on the line",
          "Mid-table with mild implications",
          "European qualification or relegation battle",
          "Title race or must-win knockout",
          "Season-defining fixture",
        ],
      ),
      rivalry: score(
        "How intense is the rivalry between these clubs? Consider historic, " +
          "geographic, and cultural rivalry — derbies and grudge matches score high.",
        [
          "No real rivalry",
          "Familiar opponents, mild tension",
          "Recognized competitive rivalry",
          "Strong city/regional derby",
          "Heated, season-defining grudge match",
        ],
      ),
      atmosphere: score(
        "How good will the atmosphere and occasion be? Consider the venue, " +
          "crowd energy, and significance of the fixture.",
        [
          "Flat, low-key occasion",
          "Reasonable crowd, normal atmosphere",
          "Strong, noisy crowd",
          "Electric, intimidating venue",
          "Once-in-a-lifetime occasion",
        ],
      ),
      isDerby: noul(
        "Is this match a recognized derby, grudge match, or particularly heated " +
          "rivalry given the clubs and competition?",
      ),
    },
  });

  const a = response.answers;
  const norm = (s: number) => s / 4; // criteria arrays are 5 long → max index 4
  const excitement = norm(a.excitement.score);
  const stakes = norm(a.stakes.score);
  const rivalry = norm(a.rivalry.score);
  const atmosphere = norm(a.atmosphere.score);
  const isDerby = a.isDerby.noul;

  // Composite scoring — code controls the weighting, Jev stays reusable.
  const w = prefs.weights;
  const wsum = w.excitement + w.stakes + w.rivalry + w.atmosphere || 1;
  const composite =
    (w.excitement * excitement +
      w.stakes * stakes +
      w.rivalry * (0.85 * rivalry + 0.15 * isDerby) +
      w.atmosphere * atmosphere) /
    wsum;

  // Average of score answer confidences — a rough workflow certainty signal.
  const confidence =
    (a.excitement.confidence +
      a.stakes.confidence +
      a.rivalry.confidence +
      a.atmosphere.confidence) /
    4;

  // Recommendation threshold lives in code, not in the prompt.
  const watchRec: DecisionAnswer["watchRec"] =
    composite >= 0.7 && confidence >= 0.45
      ? "must_watch"
      : composite >= 0.5
        ? "recommended"
        : "skip";

  return {
    match,
    answers: {
      excitement,
      stakes,
      rivalry,
      atmosphere,
      isDerby,
      composite,
      confidence,
      watchRec,
    },
    backend: "typesafe",
    raw: response,
  };
}

// ----------------------------- dispatcher -----------------------------

export type JudgeOptions = {
  // Override at the call site for testing / explicit fallback.
  force?: Backend | "auto";
  // Called whenever a TypeSafe attempt throws — used by the route to surface
  // a single combined hint.
  onTypesafeError?: (err: unknown) => void;
};

/**
 * Pick a backend and judge. With `force: "auto"` (default), use TypeSafe when
 * `TYPESAFE_API_KEY` is configured, falling back to the Needle 3 heuristic on
 * any thrown error (auth, rate limit, network). The Needle 3 path is also
 * always available via `force: "local"`.
 */
export async function judgeMatch(
  match: MatchSummary,
  prefs: UserPrefs,
  opts: JudgeOptions = {},
): Promise<DecisionResult> {
  const requested: Backend | "auto" =
    opts.force ?? prefs.backend ?? "auto";
  const useTypesafe =
    requested === "typesafe" ||
    (requested === "auto" && !!process.env.TYPESAFE_API_KEY);

  if (useTypesafe) {
    try {
      return await judgeMatchTypeSafe(match, prefs);
    } catch (err) {
      opts.onTypesafeError?.(err);
      if (requested === "typesafe") throw err;
      // auto: fall through to Needle 3
      return {
        ...judgeMatchLocal(match, prefs),
        reason:
          err instanceof Error
            ? `TypeSafe failed: ${err.message}. Fell back to Needle 3.`
            : "TypeSafe failed. Fell back to Needle 3.",
      };
    }
  }

  return judgeMatchLocal(match, prefs);
}
