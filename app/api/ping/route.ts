import { NextResponse } from "next/server";
import { pingUrl } from "@/lib/ping";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing 'url' query parameter" }, { status: 400 });
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "Only http/https URLs are allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  return NextResponse.json(await pingUrl(url), {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
