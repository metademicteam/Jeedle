import { NextRequest, NextResponse } from "next/server";
import { fetchMatches } from "@/lib/football";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const competitions = url.searchParams.get("competitions") ?? "PL,PD,BL1,SA,FL1,CL";

    const matches = await fetchMatches({ dateFrom, dateTo, competitions });
    return NextResponse.json({ matches });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
