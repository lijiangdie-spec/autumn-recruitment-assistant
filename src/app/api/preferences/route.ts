import { NextResponse } from "next/server";

import { readPreferences, writePreferences } from "@/lib/config/store";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ preferences: await readPreferences() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try {
    const preferences = await writePreferences(await request.json());
    const [{ sqlite }, { rescoreAllPersonalScores }, repository, scoring] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/personal-score-backfill"), import("@/lib/db/repository"), import("@/lib/scoring")]);
    for (const posting of repository.getPostings({ disposition: "all" })) {
      if (posting.status === "closed" || (posting.deadlineAt && Date.parse(posting.deadlineAt) < Date.now())) continue;
      repository.upsertPosting(scoring.evaluatePosting({ sourceJobId: posting.sourceJobId, company: posting.company, title: posting.title, cities: posting.cities, cohort: posting.cohort, employmentType: posting.employmentType, publishedAt: posting.publishedAt, deadlineAt: posting.deadlineAt, jdText: posting.jdText, jdParseStatus: posting.jdParseStatus, jdSourceUrl: posting.jdSourceUrl, jdParsedAt: posting.jdParsedAt, sourceUrl: posting.sourceUrl, officialUrl: posting.officialUrl, applyUrl: posting.applyUrl, applicationAvailable: posting.applicationAvailable, sourceName: posting.sourceName, sourceTrust: posting.sourceTrust }));
    }
    rescoreAllPersonalScores(sqlite);
    return NextResponse.json({ preferences });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "岗位或简历偏好无效" }, { status: 400 });
  }
}
