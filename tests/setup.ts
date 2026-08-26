import os from "node:os";
import path from "node:path";

// Keep test imports from ever opening or migrating the production SQLite file.
process.env.RECRUITMENT_DB_PATH = ":memory:";
process.env.AUTUMN_ASSISTANT_DATA_ROOT = path.join(os.tmpdir(), `autumn-assistant-vitest-${process.pid}`);
