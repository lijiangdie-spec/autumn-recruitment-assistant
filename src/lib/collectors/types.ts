import type { ParsedPostingInput, SourceTrust } from "@/lib/types";

export interface CollectorSource {
  name: string;
  type: "aggregator" | "university" | "official" | "manual";
  url: string;
  trust: SourceTrust;
  employmentType?: ParsedPostingInput["employmentType"];
}

export interface CollectorResult {
  source: CollectorSource;
  postings: ParsedPostingInput[];
  discovered: number;
  warnings: string[];
}

export class CollectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "CollectionError";
  }
}
