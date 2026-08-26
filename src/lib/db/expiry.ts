import { sqlite } from "@/lib/db/client";
import { isExpiredDeadline } from "@/lib/deadline";

export { isExpiredDeadline } from "@/lib/deadline";

export interface ExpiredRecruitmentCleanup {
  postingsDeleted: number;
  companiesDeleted: number;
  linksDeleted: number;
}

type PostingIdentity = { id: number; company_id: number | null };

function deletePostingsAndEmptyCompanies(rows: PostingIdentity[]): ExpiredRecruitmentCleanup {
  if (rows.length === 0) return { postingsDeleted: 0, companiesDeleted: 0, linksDeleted: 0 };
  const deletePosting = sqlite.prepare("DELETE FROM postings WHERE id = ?");
  const hasPosting = sqlite.prepare("SELECT 1 FROM postings WHERE company_id = ? LIMIT 1");
  const hasApplication = sqlite.prepare("SELECT 1 FROM applications WHERE company_id = ? LIMIT 1");
  const deleteLinks = sqlite.prepare("DELETE FROM company_links WHERE company_id = ?");
  const deleteCompany = sqlite.prepare("DELETE FROM companies WHERE id = ?");

  return sqlite.transaction(() => {
    let postingsDeleted = 0;
    let companiesDeleted = 0;
    let linksDeleted = 0;
    const companyIds = new Set<number>();
    for (const row of rows) {
      postingsDeleted += deletePosting.run(row.id).changes;
      if (row.company_id) companyIds.add(row.company_id);
    }
    for (const companyId of companyIds) {
      if (hasPosting.get(companyId) || hasApplication.get(companyId)) continue;
      linksDeleted += deleteLinks.run(companyId).changes;
      companiesDeleted += deleteCompany.run(companyId).changes;
    }
    return { postingsDeleted, companiesDeleted, linksDeleted };
  })();
}

export function discardExpiredPostingByFingerprint(fingerprint: string): ExpiredRecruitmentCleanup {
  const row = sqlite.prepare("SELECT id, company_id FROM postings WHERE fingerprint = ?").get(fingerprint) as PostingIdentity | undefined;
  return deletePostingsAndEmptyCompanies(row ? [row] : []);
}

export function pruneExpiredRecruitmentData(now = Date.now()): ExpiredRecruitmentCleanup {
  const candidates = sqlite.prepare("SELECT id, company_id, deadline_at FROM postings WHERE deadline_at IS NOT NULL").all() as Array<
    PostingIdentity & { deadline_at: string }
  >;
  return deletePostingsAndEmptyCompanies(candidates.filter((row) => isExpiredDeadline(row.deadline_at, now)));
}
