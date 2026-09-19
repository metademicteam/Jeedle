// Client-side entry point for team logo resolution. The filesystem walk
// happens on the server (`/api/team-manifest`); here we just fetch that
// manifest once per session and delegate matching to the pure helpers in
// `teamLogosCore.ts`.

import type { Team } from "./football";
import {
  type LogoManifest,
  resolveTeamLogo,
  teamLogoInitials,
} from "./teamLogosCore";

export { resolveTeamLogo, teamLogoInitials };
export type { LogoManifest };

let manifestPromise: Promise<LogoManifest | null> | null = null;

function fetchManifest(): Promise<LogoManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch("/api/team-manifest")
      .then((r) => (r.ok ? (r.json() as Promise<LogoManifest>) : null))
      .catch(() => null);
  }
  return manifestPromise;
}

/**
 * Resolve a team logo URL from a football-data.org Team object.
 * Returns null while the manifest loads and no match is found.
 */
export async function teamLogoPath(
  team: Team | { name: string; shortName?: string; tla?: string },
  leagueCode?: string,
): Promise<string | null> {
  const manifest = await fetchManifest();
  if (!manifest) return null;
  return resolveTeamLogo(manifest, team, leagueCode);
}
