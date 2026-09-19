// Minimal types for football-data.org v4 /matches response.
export type Team = {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
};

export type Score = {
  fullTime?: { home: number | null; away: number | null };
  halfTime?: { home: number | null; away: number | null };
};

export type Match = {
  id: number;
  utcDate: string;
  status:
    | "SCHEDULED"
    | "LIVE"
    | "IN_PLAY"
    | "PAUSED"
    | "FINISHED"
    | "POSTPONED"
    | "CANCELLED"
    | "TIMED";
  matchday?: number;
  stage?: string;
  competition?: { id: number; name: string; code?: string; emblem?: string };
  homeTeam: Team;
  awayTeam: Team;
  score?: Score;
  venue?: string | null;
};

export type MatchesResponse = {
  matches: Match[];
  resultSet?: { count: number };
};

const FOOTBALL_BASE = "https://api.football-data.org/v4";

export class FootballDataError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = "FootballDataError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchMatches(opts?: {
  dateFrom?: string;
  dateTo?: string;
  competitions?: string; // comma-separated codes: PL,PD,SA,BL1,CL
  status?: string; // SCHEDULED,LIVE,IN_PLAY
}): Promise<Match[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    throw new FootballDataError(
      401,
      "FOOTBALL_DATA_API_KEY is not set. Add it to .env.local (see .env.example).",
      "",
    );
  }

  const url = new URL(`${FOOTBALL_BASE}/matches`);
  if (opts?.dateFrom) url.searchParams.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) url.searchParams.set("dateTo", opts.dateTo);
  if (opts?.competitions) url.searchParams.set("competitions", opts.competitions);
  if (opts?.status) url.searchParams.set("status", opts.status);

  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": apiKey },
    // Cache lightly. football-data caches per minute server-side; revalidate every 60s.
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FootballDataError(
      res.status,
      `football-data error ${res.status}: ${body.slice(0, 200)}`,
      body,
    );
  }
  const data = (await res.json()) as MatchesResponse;
  return data.matches ?? [];
}
