import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  // TODO: verify GitHub signature, handle event
  return NextResponse.json({ received: true });
}
