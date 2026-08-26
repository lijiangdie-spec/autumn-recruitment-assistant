import { z } from "zod";

export const publicJobSchema = z.object({
  id: z.string().min(1).max(128),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(240),
  cities: z.array(z.string().trim().max(80)).max(50),
  cohort: z.string().trim().max(80).nullable(),
  employmentType: z.enum(["campus", "internship", "unknown"]),
  publishedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  jdText: z.string().max(200_000),
  sourceUrl: z.string().url(),
  officialUrl: z.string().url().nullable(),
  applyUrl: z.string().url().nullable(),
  applicationAvailable: z.boolean().nullable(),
  sourceName: z.string().trim().max(240),
  sourceTrust: z.enum(["official", "university", "aggregator", "manual"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.string(),
});

export const publicFeedSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  jobCount: z.number().int().min(0),
  jobsHash: z.string().regex(/^[a-f0-9]{64}$/),
  jobs: z.array(publicJobSchema),
});

export type PublicJob = z.infer<typeof publicJobSchema>;
export type PublicFeed = z.infer<typeof publicFeedSchema>;
