import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assistantPath, resolveAssistantDataRoot } from "@/lib/config/paths";
import {
  emptyPreferences,
  emptyProfile,
  preferencesSchema,
  profileSchema,
  type UserPreferences,
  type UserProfile,
} from "@/lib/config/schema";

const PROFILE_FILE = "profile.json";
const PREFERENCES_FILE = "preferences.json";

async function atomicJsonWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readJsonSync(filePath: string): unknown | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureAssistantDataDirectories(): Promise<void> {
  const root = resolveAssistantDataRoot();
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(assistantPath("materials", "projects"), { recursive: true }),
    mkdir(assistantPath("materials", "internships"), { recursive: true }),
    mkdir(assistantPath("applications"), { recursive: true }),
    mkdir(assistantPath("resumes"), { recursive: true }),
    mkdir(assistantPath("imports"), { recursive: true }),
    mkdir(assistantPath("backups"), { recursive: true }),
    mkdir(assistantPath("feed-outbox"), { recursive: true }),
  ]);
}

export async function readProfile(): Promise<UserProfile> {
  const value = await readJson(assistantPath(PROFILE_FILE));
  return value === null ? emptyProfile() : profileSchema.parse(value);
}

export function readProfileSync(): UserProfile {
  const value = readJsonSync(assistantPath(PROFILE_FILE));
  return value === null ? emptyProfile() : profileSchema.parse(value);
}

export async function writeProfile(value: unknown): Promise<UserProfile> {
  const parsed = profileSchema.parse(value);
  await atomicJsonWrite(assistantPath(PROFILE_FILE), parsed);
  return parsed;
}

export async function readPreferences(): Promise<UserPreferences> {
  const value = await readJson(assistantPath(PREFERENCES_FILE));
  return value === null ? emptyPreferences() : preferencesSchema.parse(value);
}

export function readPreferencesSync(): UserPreferences {
  const value = readJsonSync(assistantPath(PREFERENCES_FILE));
  return value === null ? emptyPreferences() : preferencesSchema.parse(value);
}

export async function writePreferences(value: unknown): Promise<UserPreferences> {
  const parsed = preferencesSchema.parse(value);
  await atomicJsonWrite(assistantPath(PREFERENCES_FILE), parsed);
  return parsed;
}

export async function readSetupState(): Promise<{ completed: boolean; profile: UserProfile; preferences: UserPreferences; dataRoot: string }> {
  await ensureAssistantDataDirectories();
  const [profile, preferences] = await Promise.all([readProfile(), readPreferences()]);
  return { completed: preferences.setupCompleted, profile, preferences, dataRoot: resolveAssistantDataRoot() };
}
