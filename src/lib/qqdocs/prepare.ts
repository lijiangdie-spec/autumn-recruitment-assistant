import { evaluateQqDocsSourceRow, type SourceRowCompanyLink } from "@/lib/imports/source-row";
import { evaluatePosting } from "@/lib/scoring";
import { normalizeSheetSnapshot } from "@/lib/qqdocs/normalize";
import type { NormalizedSheetRow, RawSheetSnapshot } from "@/lib/qqdocs/types";
import { hashNormalizedRows, reconcileBoundary, selectStableSnapshot, validateDateWindow } from "@/lib/qqdocs/validate";

export interface PreparedQqDocsImport {
  rows: NormalizedSheetRow[];
  recognizedCandidates: Map<string, ReturnType<typeof evaluatePosting>>;
  candidates: Map<string, ReturnType<typeof evaluatePosting>>;
  policyExcludedCandidates: Map<string, ReturnType<typeof evaluatePosting>>;
  companyLinks: Map<string, SourceRowCompanyLink>;
  postingFingerprintsBySource: Map<string, string[]>;
  archiveResultsBySource: Map<string, SourceRowArchiveResult>;
  dateCounts: Record<string, number>;
  snapshotHash: string;
  ineligible: number;
  policyExcluded: number;
  unresolved: number;
}

export interface SourceRowArchiveResult {
  outcome: "postings" | "company_link" | "policy_excluded" | "unresolved";
  reason: string;
  companyLinkApplyUrl: string | null;
}

export type PreparedSourceRowEntities = Omit<PreparedQqDocsImport, "rows" | "dateCounts" | "snapshotHash">;

export function prepareNormalizedSourceRows(rows: NormalizedSheetRow[], sourceName: string): PreparedSourceRowEntities {
  const recognizedCandidates = new Map<string, ReturnType<typeof evaluatePosting>>();
  const candidates = new Map<string, ReturnType<typeof evaluatePosting>>();
  const policyExcludedCandidates = new Map<string, ReturnType<typeof evaluatePosting>>();
  const companyLinks = new Map<string, SourceRowCompanyLink>();
  const postingFingerprintsBySource = new Map<string, string[]>();
  const archiveResultsBySource = new Map<string, SourceRowArchiveResult>();
  let ineligible = 0;
  let policyExcluded = 0;
  let unresolved = 0;
  for (const row of rows) {
    const evaluated = evaluateQqDocsSourceRow(row, sourceName);
    if (evaluated.ineligible) ineligible += 1;
    for (const candidate of evaluated.policyExcludedCandidates) {
      policyExcludedCandidates.set(candidate.fingerprint, candidate);
    }
    if (evaluated.outcome === "policy_excluded") {
      policyExcluded += 1;
    }
    if (evaluated.outcome === "unresolved") unresolved += 1;
    for (const candidate of evaluated.recognizedCandidates) recognizedCandidates.set(candidate.fingerprint, candidate);
    const fingerprints: string[] = [];
    for (const candidate of evaluated.candidates) {
      candidates.set(candidate.fingerprint, candidate);
      fingerprints.push(candidate.fingerprint);
    }
    if (evaluated.companyLink) companyLinks.set(evaluated.companyLink.applyUrl, evaluated.companyLink);
    postingFingerprintsBySource.set(row.sourceIdentity, fingerprints);
    archiveResultsBySource.set(row.sourceIdentity, {
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      companyLinkApplyUrl: evaluated.companyLink?.applyUrl ?? null,
    });
  }
  return {
    recognizedCandidates,
    candidates,
    policyExcludedCandidates,
    companyLinks,
    postingFingerprintsBySource,
    archiveResultsBySource,
    ineligible,
    policyExcluded,
    unresolved,
  };
}

export function prepareQqDocsImport(input: {
  snapshots: RawSheetSnapshot[];
  defaultYear: number;
  boundaryDate: string;
  targetDate: string;
  sourceName: string;
  previousBoundaryRows: NormalizedSheetRow[] | null;
}): PreparedQqDocsImport {
  const normalizedAttempts = input.snapshots.map((snapshot) => normalizeSheetSnapshot(snapshot, input.defaultYear));
  const stableRows = selectStableSnapshot(normalizedAttempts);
  const latestSnapshot = input.snapshots[input.snapshots.length - 1];
  const window = validateDateWindow(stableRows, {
    boundaryDate: input.boundaryDate,
    targetDate: input.targetDate,
    reachedSheetEnd: latestSnapshot.reachedSheetEnd,
  });
  if (input.previousBoundaryRows) reconcileBoundary(input.previousBoundaryRows, window.rows, input.boundaryDate);

  const entities = prepareNormalizedSourceRows(window.rows, input.sourceName);
  return {
    rows: window.rows,
    ...entities,
    dateCounts: window.dateCounts,
    snapshotHash: hashNormalizedRows(window.rows),
  };
}
