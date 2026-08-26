import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assistantPath } from "@/lib/config/paths";
import { materialDraftSchema, materialSchema, type Material, type MaterialDraft } from "@/lib/materials/schema";

function materialDirectory(kind: Material["kind"]): string {
  return assistantPath("materials", kind === "project" ? "projects" : "internships");
}

function materialFile(kind: Material["kind"], id: string): string {
  return path.join(materialDirectory(kind), `${id}.json`);
}

async function writeAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

async function readMaterialFile(filePath: string): Promise<Material> {
  return materialSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

export async function listMaterials(): Promise<Material[]> {
  const result: Material[] = [];
  for (const kind of ["project", "internship"] as const) {
    const directory = materialDirectory(kind);
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      result.push(await readMaterialFile(path.join(directory, entry.name)));
    }
  }
  return result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findMaterial(id: string): Promise<Material | null> {
  for (const kind of ["project", "internship"] as const) {
    try {
      return await readMaterialFile(materialFile(kind, id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function createMaterial(input: unknown): Promise<Material> {
  const draft = materialDraftSchema.parse(input);
  const now = new Date().toISOString();
  const material = materialSchema.parse({ ...draft, id: randomUUID(), createdAt: now, updatedAt: now });
  await writeAtomic(materialFile(material.kind, material.id), material);
  return material;
}

export async function createMaterials(inputs: MaterialDraft[]): Promise<Material[]> {
  const created: Material[] = [];
  for (const input of inputs) created.push(await createMaterial(input));
  return created;
}

export async function updateMaterial(id: string, input: unknown): Promise<Material> {
  const existing = await findMaterial(id);
  if (!existing) throw new Error("素材不存在");
  const patch = materialDraftSchema.partial().parse(input);
  const material = materialSchema.parse({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
  if (material.kind !== existing.kind) await rm(materialFile(existing.kind, id), { force: true });
  await writeAtomic(materialFile(material.kind, id), material);
  return material;
}

export async function deleteMaterial(id: string): Promise<boolean> {
  const existing = await findMaterial(id);
  if (!existing) return false;
  await rm(materialFile(existing.kind, id), { force: true });
  return true;
}
