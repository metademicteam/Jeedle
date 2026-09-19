// Pure (browser-safe) helpers used by the team logo resolver. Keeping these
// out of any module that imports `node:*` lets webpack ship them to the
// client without UnhandledSchemeError.

import type { Team } from "./football";

export type LogoManifest = {
  byFolder: Record<string, Record<string, string>>;
  flat: Record<string, { folder: string; basename: string }>;
};

/** football-data.org competition code -> repo folder name. */
export const COMPETITION_FOLDER: Record<string, string> = {
  PL: "England - Premier League",
  EL1: "England - Premier League",
  BL1: "Germany - Bundesliga",
  PD: "Spain - LaLiga",
  SA: "Italy - Serie A",
  FL1: "France - Ligue 1",
  ERED: "Netherlands - Eredivisie",
  PPL: "Portugal - Liga Portugal",
  BSL: "Belgium - Jupiler Pro League",
  SCL: "Switzerland - Super League",
  AUT: "Austria - Bundesliga",
  TSL: "Türkiye - Süper Lig",
  DK1: "Denmark - Superliga",
  SE1: "Sweden - Allsvenskan",
  NO1: "Norway - Eliteserien",
  GS1: "Greece - Super League 1",
  SCO: "Scotland - Scottish Premiership",
  POL: "Poland - PKO BP Ekstraklasa",
  RPL: "Russia - Premier Liga",
  UKR: "Ukraine - Premier Liga",
  CZ1: "Czech Republic - Chance Liga",
  CRO: "Croatia - SuperSport HNL",
  SRB: "Serbia - Super liga Srbije",
  BUL: "Bulgaria - efbet Liga",
  ROU: "Romania - SuperLiga",
  ISR: "Israel - Ligat ha'Al",
};

/** Manual aliases for top-flight name mismatches. */
export const NAME_ALIASES: Record<string, string> = {
  // England
  "Wolverhampton Wanderers FC": "Wolverhampton Wanderers",
  "Brighton & Hove Albion FC": "Brighton & Hove Albion",
  "Tottenham Hotspur FC": "Tottenham Hotspur",
  "Newcastle United FC": "Newcastle United",
  "Manchester United FC": "Manchester United",
  "Manchester City FC": "Manchester City",
  "Nottingham Forest FC": "Nottingham Forest",
  "West Ham United FC": "West Ham United",
  "Leeds United FC": "Leeds United",
  "Leicester City FC": "Leicester City",
  // Germany
  "Bayern München": "Bayern Munich",
  "1. FC Köln": "1.FC Köln",
  "1. FC Union Berlin": "1.FC Union Berlin",
  "1. FSV Mainz 05": "1.FSV Mainz 05",
  "TSG 1899 Hoffenheim": "TSG 1899 Hoffenheim",
  "SC Freiburg": "SC Freiburg",
  "VfB Stuttgart": "VfB Stuttgart",
  "VfL Wolfsburg": "VfL Wolfsburg",
  // Spain
  "Real Madrid CF": "Real Madrid",
  "Athletic Club": "Athletic Bilbao",
  "Rayo Vallecano de Madrid": "Rayo Vallecano",
  // Italy
  "FC Internazionale Milano": "Inter Milan",
  // France
  "Paris Saint-Germain FC": "Paris Saint-Germain",
  "Olympique de Marseille": "Olympique Marseille",
  "Olympique Lyonnais": "Olympique Lyon",
  "AS Monaco FC": "AS Monaco",
  "OGC Nice": "OGC Nice",
  "LOSC Lille": "LOSC Lille",
  "Stade Rennais FC 1901": "Stade Rennais FC",
  // Netherlands
  "AFC Ajax": "Ajax Amsterdam",
  "PSV": "PSV Eindhoven",
  "Feyenoord Rotterdam": "Feyenoord Rotterdam",
  "AZ Alkmaar": "AZ Alkmaar",
  "FC Twente": "FC Twente Enschede",
  "sc Heerenveen": "SC Heerenveen",
  "NEC Nijmegen": "NEC Nijmegen",
  "Sparta Rotterdam": "Sparta Rotterdam",
  // Portugal
  "Sport Lisboa e Benfica": "SL Benfica",
  "FC Porto": "FC Porto",
  "Sporting Clube de Portugal": "Sporting CP",
  "SC Braga": "SC Braga",
  "Vitória Sport Clube (Guimarães)": "Vitória Guimarães SC",
  "CS Marítimo": "CS Marítimo",
  "CD Nacional": "CD Nacional",
  // Turkey
  "Beşiktaş JK": "Besiktas JK",
  "Fenerbahçe SK": "Fenerbahce",
  "Galatasaray SK": "Galatasaray",
  "İstanbul Başakşehir FK": "Basaksehir FK",
};

export const SUFFIXES_TO_STRIP = [
  " FC",
  " CF",
  "AFC ",
  "AC ",
  " SSC",
  " US",
  " AS",
  " BC",
  " Calcio",
  " Balompié",
  " 1909",
  " 1907",
  " 1913",
  " Rotterdam",
  " Arnhem",
  " Almelo",
  " Piraeus",
  " Thessaloniki",
];

export function stripSuffixes(name: string): string[] {
  const out = new Set<string>();
  out.add(name);
  let prev = "";
  let cur = name;
  for (let i = 0; i < 4 && cur !== prev; i++) {
    prev = cur;
    for (const s of SUFFIXES_TO_STRIP) {
      if (cur.endsWith(s)) {
        cur = cur.slice(0, -s.length).trim();
        out.add(cur);
      }
    }
  }
  return [...out];
}

function lookupInFolder(
  manifest: LogoManifest,
  folder: string,
  candidate: string,
): string | null {
  const league = manifest.byFolder[folder];
  if (!league) return null;
  const key = candidate.trim().toLowerCase();
  return league[key] ?? null;
}

export function buildCandidates(
  team: Team | { name: string; shortName?: string; tla?: string },
): string[] {
  const out: string[] = [];
  const push = (v?: string | null) => {
    if (!v) return;
    if (NAME_ALIASES[v]) out.push(NAME_ALIASES[v]);
    out.push(v);
    for (const s of stripSuffixes(v)) out.push(s);
  };
  push(team.name);
  push(team.shortName);
  if (team.tla) out.push(team.tla);
  return Array.from(new Set(out));
}

/**
 * Pure resolver: given a manifest + team, return the public URL or null.
 * Stays sync so it can be unit-tested or reused from server code without
 * re-implementing the lookup.
 */
export function resolveTeamLogo(
  manifest: LogoManifest | null | undefined,
  team: Team | { name: string; shortName?: string; tla?: string },
  leagueCode?: string,
): string | null {
  if (!manifest || !manifest.byFolder) return null;
  const folder = leagueCode ? COMPETITION_FOLDER[leagueCode] : undefined;
  const foldersToTry = folder ? [folder] : Object.keys(manifest.byFolder);
  const candidates = buildCandidates(team);
  for (const f of foldersToTry) {
    for (const c of candidates) {
      const hit = lookupInFolder(manifest, f, c);
      if (hit) {
        return `/logos/${encodeURIComponent(f)}/${encodeURIComponent(hit)}.png`;
      }
    }
  }
  return null;
}

/** Initials shown while the async fetch resolves (or forever if no match). */
export function teamLogoInitials(
  team: Team | { name: string; shortName?: string; tla?: string },
): string {
  if (team.tla && team.tla.length >= 2) return team.tla.slice(0, 3).toUpperCase();
  const src = team.shortName ?? team.name;
  return src
    .replace(/ FC$| CF$|AFC | SSC | US | Calcio/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 3)
    .join("")
    .toUpperCase();
}
