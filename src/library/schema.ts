// Schema + migrations for the SQLite library index. Bump SCHEMA_VERSION and
// add a migration step when the shape changes.

export const SCHEMA_VERSION = 2;

export const MIGRATIONS: string[] = [
    // v1
    `
    CREATE TABLE downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        license_id TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT,
        attribution TEXT NOT NULL,
        attribution_required INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        original_query TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        duration_sec REAL NOT NULL DEFAULT 0,
        format TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL,
        downloaded_at INTEGER NOT NULL,
        -- one owned copy per remote sound (dedupe key)
        UNIQUE (provider_id, source_id)
    );
    CREATE INDEX idx_downloads_search ON downloads (content_type);

    CREATE TABLE watched_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        removable INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL
    );

    CREATE TABLE local_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES watched_folders(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        -- lowercase space-joined tokens for LIKE matching
        search_text TEXT NOT NULL,
        duration_sec REAL,
        format TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_local_files_folder ON local_files (folder_id);
    `,
    // v2 — which downloaded sounds were imported into which Resolve project,
    // for per-project attribution export (project identified by GetUniqueId).
    `
    CREATE TABLE imports (
        project_id TEXT NOT NULL,
        download_id INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, download_id)
    );
    `,
];
