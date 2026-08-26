import { z } from "zod";

export const materialKindSchema = z.enum(["project", "internship"]);
export const materialStatusSchema = z.enum(["draft", "confirmed"]);

export const materialSourceSchema = z.object({
  type: z.enum(["interview", "resume-import", "repository", "manual"]),
  label: z.string().trim().max(240).default(""),
  path: z.string().trim().max(2048).default(""),
  importedAt: z.string().datetime(),
});

export const materialSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().uuid(),
  kind: materialKindSchema,
  title: z.string().trim().min(1).max(160),
  organization: z.string().trim().max(160).default(""),
  role: z.string().trim().max(160).default(""),
  dateRange: z.string().trim().max(100).default(""),
  background: z.string().trim().max(10_000).default(""),
  contribution: z.string().trim().max(20_000).default(""),
  approach: z.string().trim().max(20_000).default(""),
  outcomes: z.string().trim().max(20_000).default(""),
  challenges: z.string().trim().max(20_000).default(""),
  resumeBullets: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  status: materialStatusSchema.default("draft"),
  sources: z.array(materialSourceSchema).max(20).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const materialDraftSchema = materialSchema.omit({
  schemaVersion: true,
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  organization: true,
  role: true,
  dateRange: true,
  background: true,
  contribution: true,
  approach: true,
  outcomes: true,
  challenges: true,
  resumeBullets: true,
  keywords: true,
  status: true,
  sources: true,
});

export const extractedMaterialSchema = z.object({
  materials: z.array(z.object({
    kind: materialKindSchema,
    title: z.string().trim().min(1).max(160),
    organization: z.string().trim().max(160).default(""),
    role: z.string().trim().max(160).default(""),
    dateRange: z.string().trim().max(100).default(""),
    background: z.string().trim().max(10_000).default(""),
    contribution: z.string().trim().max(20_000).default(""),
    approach: z.string().trim().max(20_000).default(""),
    outcomes: z.string().trim().max(20_000).default(""),
    challenges: z.string().trim().max(20_000).default(""),
    resumeBullets: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
    keywords: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  })).max(100),
  warnings: z.array(z.string().trim().max(500)).max(50).default([]),
});

export type Material = z.infer<typeof materialSchema>;
export type MaterialDraft = z.infer<typeof materialDraftSchema>;
export type ExtractedMaterials = z.infer<typeof extractedMaterialSchema>;

export const extractedMaterialJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["materials", "warnings"],
  properties: {
    materials: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "organization", "role", "dateRange", "background", "contribution", "approach", "outcomes", "challenges", "resumeBullets", "keywords"],
        properties: {
          kind: { type: "string", enum: ["project", "internship"] },
          title: { type: "string" },
          organization: { type: "string" },
          role: { type: "string" },
          dateRange: { type: "string" },
          background: { type: "string" },
          contribution: { type: "string" },
          approach: { type: "string" },
          outcomes: { type: "string" },
          challenges: { type: "string" },
          resumeBullets: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;
