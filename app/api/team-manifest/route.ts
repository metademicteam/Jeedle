// Returns a compact manifest of every team logo under public/logos/, keyed by
// lowercase basename. Consumed by the client at startup so the team logo
// resolver can match football-data.org team names against real filenames
// without hard-coding 396 strings into the bundle.

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-static";
export const revalidate = false;
// fs/promises is only available under the Node.js runtime; without this,
// webpack's Edge bundler rejects `node:fs/promises` with UnhandledSchemeError.
export const runtime = "nodejs";

type Manifest = {
  /** folder -> { lowercased basename -> exact basename } */
  byFolder: Record<string, Record<string, string>>;
  /** flat lowercase index -> { folder, basename } for fallback lookups */
  flat: Record<string, { folder: string; basename: string }>;
};

let cached: Manifest | null = null;
let cachedAt = 0;

async function buildManifest(): Promise<Manifest> {
  const root = path.join(process.cwd(), "public", "logos");
  const byFolder: Manifest["byFolder"] = {};
  const flat: Manifest["flat"] = {};

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { byFolder, flat };
  }

  await Promise.all(
    entries.map(async (folder) => {
      const fullFolder = path.join(root, folder);
      const stat = await fs.stat(fullFolder).catch(() => null);
      if (!stat?.isDirectory()) return;
      const files = await fs.readdir(fullFolder).catch(() => []);
      const basenames: Record<string, string> = {};
      for (const file of files) {
        if (!file.toLowerCase().endsWith(".png")) continue;
        const base = file.slice(0, -".png".length);
        basenames[base.toLowerCase()] = base;
        flat[base.toLowerCase()] = { folder, basename: base };
      }
      byFolder[folder] = basenames;
    }),
  );

  return { byFolder, flat };
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cachedAt > 60_000) {
    cached = await buildManifest();
    cachedAt = now;
  }
  return NextResponse.json(cached, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
