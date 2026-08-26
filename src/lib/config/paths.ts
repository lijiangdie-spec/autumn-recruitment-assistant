import path from "node:path";

const APP_DIRECTORY_NAME = "秋招助手";

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function defaultAssistantDataRoot(): string {
  // Keep user-home discovery runtime-only. Besides being more portable, this
  // prevents build-time file tracers from walking a developer's home folder.
  const environment = process.env as Record<string, string | undefined>;
  const variable = (...parts: string[]) => environment[parts.join("")]?.trim();
  const home = variable("USER", "PROFILE") || variable("HOME") || process.cwd();
  if (process.platform === "win32") {
    return path.join(variable("LOCAL", "APPDATA") || path.join(home, "AppData", "Local"), APP_DIRECTORY_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_DIRECTORY_NAME);
  }
  return path.join(variable("XDG", "_DATA", "_HOME") || path.join(home, ".local", "share"), "autumn-recruitment-assistant");
}

export function resolveAssistantDataRoot(cwd = process.cwd()): string {
  const configured = process.env.AUTUMN_ASSISTANT_DATA_ROOT?.trim();
  const resolved = path.resolve(configured || defaultAssistantDataRoot());
  const allowRepoData = process.env.AUTUMN_ASSISTANT_ALLOW_REPO_DATA === "1";
  if (!allowRepoData && isWithin(cwd, resolved)) {
    throw new Error("用户数据目录不能位于源码仓库内；请设置 AUTUMN_ASSISTANT_DATA_ROOT 到仓库之外");
  }
  return resolved;
}

export function assistantPath(...segments: string[]): string {
  return path.join(resolveAssistantDataRoot(), ...segments);
}

export function resolveConfiguredPath(value: string, fallbackSegments: string[]): string {
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : assistantPath(...fallbackSegments);
}

export { isWithin };
