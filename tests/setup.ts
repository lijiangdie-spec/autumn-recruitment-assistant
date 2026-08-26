// Keep test imports from ever opening or migrating the production SQLite file.
process.env.RECRUITMENT_DB_PATH = ":memory:";
process.env.AUTUMN_ASSISTANT_DATA_ROOT = `${process.env.TEMP || process.env.TMP || "."}\\autumn-assistant-vitest-${process.pid}`;
