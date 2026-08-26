import { z } from "zod";

export const agentProviderSchema = z.enum(["codex", "claude"]);

export const profileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(80).default(""),
  email: z.string().trim().max(160).default(""),
  education: z.array(z.object({
    school: z.string().trim().max(160),
    detail: z.string().trim().max(240),
    date: z.string().trim().max(80),
  })).default([]),
  skills: z.array(z.string().trim().max(160)).default([]),
  certificates: z.array(z.string().trim().max(160)).default([]),
});

export const scoreDimensionSchema = z.object({
  id: z.string().trim().min(1).max(48),
  label: z.string().trim().min(1).max(80),
  weight: z.number().finite().min(0).max(100),
  keywords: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
});

export const jobPreferencesSchema = z.object({
  roleKeywords: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  excludedKeywords: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  cities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  cohorts: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  employmentTypes: z.array(z.enum(["campus", "internship", "unknown"])).default([]),
  requiredKeywords: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  dimensions: z.array(scoreDimensionSchema).max(20).default([]),
  recommendationThreshold: z.number().int().min(0).max(100).default(60),
});

export const resumePreferencesSchema = z.object({
  template: z.enum(["a", "b", "c"]).default("c"),
  outputFormat: z.enum(["pdf", "docx", "both"]).default("pdf"),
  accentHex: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2357D5"),
  includePhoto: z.boolean().default(false),
  outputDirectory: z.string().trim().max(1024).default(""),
});

export const preferencesSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  setupCompleted: z.boolean().default(false),
  agentProvider: agentProviderSchema.default("codex"),
  feedUrl: z.string().trim().url().or(z.literal("")).default(""),
  job: jobPreferencesSchema.default(() => jobPreferencesSchema.parse({})),
  resume: resumePreferencesSchema.default(() => resumePreferencesSchema.parse({})),
});

export type UserProfile = z.infer<typeof profileSchema>;
export type UserPreferences = z.infer<typeof preferencesSchema>;
export type JobPreferences = z.infer<typeof jobPreferencesSchema>;
export type ScoreDimension = z.infer<typeof scoreDimensionSchema>;

export const emptyProfile = (): UserProfile => profileSchema.parse({});
export const emptyPreferences = (): UserPreferences => preferencesSchema.parse({});
