import { z } from "zod";

const bullet = z.object({ lead: z.string().trim().max(60), text: z.string().trim().min(1).max(600) });
const entry = z.object({
  organization: z.string().trim().min(1).max(100),
  role: z.string().trim().max(100),
  date: z.string().trim().max(60),
  projects: z.array(z.object({ name: z.string().trim().max(100), bullets: z.array(bullet).max(8) })).max(8),
});

export const resumeDraftSchema = z.object({
  revision: z.number().int().min(1).max(10000),
  accentHex: z.string().regex(/^#[0-9a-f]{6}$/i),
  name: z.string().trim().min(1).max(30),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(100),
  intention: z.string().trim().max(100),
  technology: z.string().trim().max(500),
  education: z.array(z.object({ school: z.string().trim().min(1).max(100), detail: z.string().trim().max(300), date: z.string().trim().max(60) })).max(4),
  experiences: z.array(entry).max(8),
  projects: z.array(entry).max(8),
  skills: z.array(z.object({ label: z.string().trim().max(50), text: z.string().trim().max(500) })).max(12),
  covered: z.array(z.string().trim().max(300)).max(30),
  gaps: z.array(z.string().trim().max(300)).max(30),
});
