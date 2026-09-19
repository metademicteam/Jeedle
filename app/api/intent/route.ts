import { NextRequest, NextResponse } from "next/server";
import { parseFixtureIntent } from "@/lib/needle/intent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Turns a free-text request ("derbies in the Champions League") into structured
// filters using the local Needle 3 wasm model. Fully offline: the engine and
// needle3.cact are both in the repo, so this works with no API key set.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<{
      query: string;
    }>;
    const query = (body.query ?? "").trim();

    if (!query) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 },
      );
    }

    const intent = await parseFixtureIntent(query);
    return NextResponse.json(intent);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      {
        error: "Needle 3 inference failed",
        detail: message,
        hint: "The engine needs lib/needle/needle.wasm and needle3.cact in the project root.",
      },
      { status: 500 },
    );
  }
}
