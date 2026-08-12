import { NextResponse } from "next/server";
import { getDangerHits } from "@/lib/danger-hits";

export async function GET() {
  return NextResponse.json({ count: getDangerHits() });
}
