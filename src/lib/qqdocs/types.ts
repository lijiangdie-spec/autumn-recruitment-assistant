export type QqDocsExtractionMethod = "structured" | "clipboard";

export type QqDocsErrorCode =
  | "AUTH_REQUIRED"
  | "WRONG_DOCUMENT"
  | "HEADER_CHANGED"
  | "PRIMARY_EXTRACTOR_FAILED"
  | "RANGE_INCOMPLETE"
  | "UNSTABLE_SNAPSHOT"
  | "BOUNDARY_MISMATCH"
  | "DUPLICATE_SOURCE_IDENTITY"
  | "IMPORT_FAILED";

export interface RawSheetCell {
  columnIndex: number;
  text: string;
  href?: string;
}

export interface RawSheetRow {
  rowNumber: number;
  providerRowId?: string;
  cells: RawSheetCell[];
}

export interface RawSheetSnapshot {
  sourceKey: string;
  method: QqDocsExtractionMethod;
  headers: Array<{ columnIndex: number; text: string }>;
  rows: RawSheetRow[];
  reachedSheetEnd: boolean;
  capturedAt: string;
}

export interface NormalizedSheetRow {
  sourceDate: string;
  company: string;
  companyType: string;
  industry: string;
  roles: string;
  cities: string;
  aiDetail: string;
  deadline: string;
  cohort: string;
  degree: string;
  category: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  sourceIdentity: string;
  contentHash: string;
  diagnosticRowNumber: number;
}

export interface DateWindowResult {
  rows: NormalizedSheetRow[];
  dateCounts: Record<string, number>;
}

export interface BoundaryDiff {
  added: string[];
  updated: string[];
  unchanged: string[];
}

const SENSITIVE_CONTEXT_KEYS = /cookie|authorization|token|credential|storage|response|body|har|qr/i;

export class QqDocsImportError extends Error {
  readonly code: QqDocsErrorCode;
  readonly safeContext: Record<string, string | number | boolean | null>;

  constructor(
    code: QqDocsErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "QqDocsImportError";
    this.code = code;
    this.safeContext = Object.fromEntries(
      Object.entries(context)
        .filter(([key, value]) => !SENSITIVE_CONTEXT_KEYS.test(key) && (["string", "number", "boolean"].includes(typeof value) || value === null))
        .map(([key, value]) => [key, value as string | number | boolean | null]),
    );
  }

  toJSON(): { code: QqDocsErrorCode; message: string; context: Record<string, string | number | boolean | null> } {
    return { code: this.code, message: this.message, context: this.safeContext };
  }
}
