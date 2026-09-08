import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isSameOrigin } from "@/lib/origin";
export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({error:"Invalid origin"},{status:403});
  const data = await request.json().catch(()=>null);
  if (!data || typeof data.month !== "string" || !/^\d{4}-(0[1-9]|1[012])$/.test(data.month) || typeof data.body !== "string" || data.body.length>4000)
    return NextResponse.json({error:"Invalid note"},{status:400});
  await sql`INSERT INTO public.music_notes(period_key,body) VALUES (${data.month},${data.body})
    ON CONFLICT(period_key) DO UPDATE SET body=excluded.body,updated_at=now()`;
  return NextResponse.json({ok:true});
}
