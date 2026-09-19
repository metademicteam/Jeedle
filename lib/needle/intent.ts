import { getNeedleEngine, type NeedleStatus } from "./engine";

// --------------------------- Needle 3 intent layer ---------------------------
//
// Needle 3 is a tool-calling / structured-extraction model, not a judge. Asking
// it to rate a fixture produces extraction artifacts (it reads "matchday 12" as
// an excitement score of 12), because the model copies values grounded in the
// input rather than inventing scores. So the scorer stays in code and this layer
// does the job the model is actually trained for: turning a free-text request
// into a typed, grammar-constrained filter.
//
// Enum values are deliberately self-describing. With cryptic codes ("PL", "PD")
// the model mapped "Premier League" onto PD, which is La Liga; spelling the
// values out fixes it.

export type CompetitionCode = "PL" | "PD" | "BL1" | "SA" | "FL1" | "CL";

const COMPETITION_CODES: Record<string, CompetitionCode> = {
  premier_league: "PL",
  la_liga: "PD",
  bundesliga: "BL1",
  serie_a: "SA",
  ligue_1: "FL1",
  champions_league: "CL",
};

export const INTENT_TOOLS = [
  {
    name: "filter_fixtures",
    description:
      "Filter which football fixtures are shown to the user and narrow them down",
    parameters: {
      type: "object",
      properties: {
        competition: {
          type: "string",
          enum: Object.keys(COMPETITION_CODES),
          description: "restrict to a single competition",
        },
        derby_only: {
          type: "boolean",
          description:
            "only show derbies and heated local rivalries between nearby clubs",
        },
        min_stakes: {
          type: "integer",
          enum: [0, 1, 2, 3, 4],
          description:
            "minimum importance the user cares about: 0 nothing on the line, 4 season-defining",
        },
      },
    },
  },
];

export type FixtureIntent = {
  query: string;
  /** CSV of football-data.org competition codes, or null for "leave unchanged". */
  competitionCodes: CompetitionCode[] | null;
  derbyOnly: boolean;
  minStakes: number | null;
  /** Calibrated 0..1 confidence from the model. */
  confidence: number | null;
  reasoning: string | null;
  backend: "needle3";
  needle3: NeedleStatus;
};

function intentSystemPrompt(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const day = now.toLocaleDateString("en-GB", { weekday: "short" });
  const time = now.toISOString().slice(11, 16);
  return `date: ${iso} ${day} ${time} UTC; locale: en-GB; device: web`;
}

const EMPTY_INTENT = {
  competitionCodes: null as CompetitionCode[] | null,
  derbyOnly: false,
  minStakes: null as number | null,
};

/**
 * Parse a free-text request into structured filters using the local Needle 3
 * model. Runs entirely in-process: no API key, no network.
 *
 * A request no declared tool can serve (e.g. "what's the weather") comes back as
 * an empty `function_calls` array; we surface that as a no-op filter set rather
 * than guessing.
 */
export async function parseFixtureIntent(query: string): Promise<FixtureIntent> {
  const engine = await getNeedleEngine();
  const result = await engine.complete(query.trim(), {
    system: intentSystemPrompt(),
    tools: INTENT_TOOLS,
  });

  const call = result.function_calls?.[0];
  const args = (call?.arguments ?? {}) as {
    competition?: string;
    derby_only?: boolean;
    min_stakes?: number;
  };

  const code = args.competition
    ? COMPETITION_CODES[args.competition] ?? null
    : null;

  return {
    query,
    competitionCodes: code ? [code] : EMPTY_INTENT.competitionCodes,
    derbyOnly: args.derby_only === true,
    minStakes:
      typeof args.min_stakes === "number" ? args.min_stakes : null,
    confidence: result.confidence ?? null,
    reasoning: result.reasoning ?? null,
    backend: "needle3",
    needle3: engine.getStatus(),
  };
}
