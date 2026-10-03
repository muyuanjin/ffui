# Settings persistence

FFUI stores application settings in `ffui.settings.json` in the active data directory. The document has one business model and a separate document header:

```json
{
  "version": 2,
  "metadata": {
    "writerVersion": "0.3.6",
    "savedAt": "2026-10-03T12:00:00Z"
  },
  "settings": {
    "locale": "zh-CN"
  }
}
```

`version` identifies the file schema, not the application release. `writerVersion` and `savedAt` describe the last successful write; they do not select between competing copies. No settings history or per-release configuration is stored in this document.

## Loading and compatibility

The settings owner retains the complete JSON document and exposes a typed view to the application. Loading applies defaults and normalization to that view without rewriting the file. Unversioned documents and versions 0, 1 and 2 are readable. Legacy forced output formats are interpreted by media type; version 2 retains explicitly unified formats. Migration is persisted with an actual settings edit.

Unknown object fields survive ordinary saves, including nested fields and document metadata. An unsupported enum or mode is preserved in the document and reported as unavailable. Its typed fallback exists only for rendering; dependent operations cannot execute using that fallback. Unrelated settings remain editable. A known array containing unknown structure is read-only because replacing its typed projection would discard that structure. Unsupported higher file versions are globally read-only.

A missing file supplies defaults. Invalid JSON, malformed known values and read failures produce explicit errors. They do not authorize replacing settings with defaults or automatically restoring a backup. Existing backup files remain untouched. An explicit application reset can replace an unreadable document.

Participating versions must preserve unknown fields and respect unavailable settings. Already released executables cannot be made to obey this protocol: an old writer can discard newer data when it replaces the file. Old settings can be inherited by a participating version, but switching back to such an old writer does not guarantee preservation of newer preferences.

## Saving and concurrent instances

Settings IPC returns the confirmed typed view, a document content identity, a data-directory identity and unavailable-field diagnostics. A save supplies that baseline and the desired view. The owner derives the changed fields, acquires a process and platform lock, rereads the latest document and merges unrelated edits. Mode objects and arrays are conflict units. A concurrent change to the same unit is rejected unless both writers request the same value. A changed data-directory identity requires reloading. Download and probe caches remain backend-owned.

The owner publishes settings and runtime effects only after an atomic replacement succeeds. A failed write leaves the confirmed runtime state and document unchanged. The frontend accepts the returned confirmation and reapplies edits made while the save was pending. Closing waits for pending saves and reports unresolved failures.

Configuration bundles export the complete settings document. Schema 1 bundles are readable; schema 2 bundles carry `settingsDocument`. Explicit imports merge supplied document values while retaining fields absent from the import. Reset deliberately replaces the document with defaults. Data-directory migration copies complete file bytes atomically, preserves existing destination files and reports essential copy failures before selecting the destination.

## Queue history

Queue state and terminal logs are separate from application settings. Unavailable queue persistence or retention settings prevent recovery, replacement and cleanup using placeholder defaults. Enabling queue recovery cannot recreate history that has already been deleted or overwritten.
