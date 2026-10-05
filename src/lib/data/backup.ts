/**
 * Backup payload construction (PRD F8), minus the credentials.
 *
 * The dump is derived from the live schema — `db.tables`, not a hand-written list — because a
 * hand-written list fails at exactly the moment it is extended: the previous version enumerated
 * fourteen tables and silently missed `power_curves`, so a backup-and-restore cycle dropped the
 * mean-max curves and with them the CP/W' fit.
 *
 * That same live-schema property is why this file exists. Reading every table also swept up
 * `settings` and `sync_state` whole, and with them the two credentials this app holds:
 *
 *   - `settings.aiKey`         — the rider's own AI provider key
 *   - `sync_state.accessToken` / `refreshToken` — Strava OAuth tokens
 *
 * A `zonadua-backup-*.json` file lands in Downloads, syncs to whatever cloud folder, and is the
 * file riders are asked to attach when reporting a problem. An AI key in the clear there is a
 * live leak today; a Strava `refresh_token` in the clear there would be read access to the
 * rider's entire activity history the moment the connect button ships. Neither belongs in a
 * training-history export, and neither is needed to restore one.
 *
 * So the redaction is a small explicit list of `table.field` paths, applied on the way out.
 * Secrets are the one part of the schema that should *not* travel automatically with the rest,
 * because "forgot to exclude it" and "included it" look identical in a diff but not in a
 * Downloads folder.
 *
 * Restore needs no counterpart: it writes only the rows present in the file, so a field this
 * leaves out is simply absent afterwards — never resurrected from the file, and (because
 * `bulkPut` replaces whole rows) never carried over stale from the row already on the device.
 * The cost is deliberate and stated in the UI: after a restore the rider re-enters the AI key
 * and reconnects Strava.
 */

/** `table.field` paths whose values never leave the device, in any export. */
export const BACKUP_REDACTED_FIELDS: readonly string[] = [
  'settings.aiKey',
  'sync_state.accessToken',
  'sync_state.refreshToken',
  'sync_state.expiresAt'
];

/** The schema generation this file writes; `restoreBackupRows` accepts older ones too. */
export const BACKUP_SCHEMA = 2;

export interface BackupPayload {
  app: 'zonadua';
  schema: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

/**
 * Remove every path in `BACKUP_REDACTED_FIELDS` from a table-keyed dump.
 *
 * Pure, and returns a new object: the input tables are left untouched so the caller can keep
 * using them (the backup is taken from live rows, not from a snapshot that may be mutated).
 * Rows are shallow-copied rather than mutated in place, and a row that is not a plain object is
 * passed through as-is, because this must never be the reason an export throws.
 */
export function redactCredentials(dump: Record<string, unknown[]>): Record<string, unknown[]> {
  // Group by table once, so a dump of thousands of rides is walked once per row, not once per
  // redacted path — the import cost stays proportional to the data, which is the whole dataset.
  const byTable = new Map<string, Set<string>>();
  for (const path of BACKUP_REDACTED_FIELDS) {
    const dot = path.indexOf('.');
    if (dot <= 0) continue;
    const table = path.slice(0, dot);
    const field = path.slice(dot + 1);
    let fields = byTable.get(table);
    if (!fields) byTable.set(table, (fields = new Set()));
    fields.add(field);
  }

  const out: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(dump)) {
    const fields = byTable.get(name);
    out[name] = !fields || !Array.isArray(rows)
      ? rows
      : rows.map((row) => {
          if (row === null || typeof row !== 'object') return row;
          const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
          for (const f of fields) delete copy[f];
          return copy;
        });
  }
  return out;
}

/**
 * Build the JSON payload written to the downloaded file.
 *
 * `exportedAt` is passed in rather than read from the clock so this stays pure and testable.
 */
export function buildBackupPayload(
  dump: Record<string, unknown[]>,
  exportedAt: string
): BackupPayload {
  return {
    app: 'zonadua',
    schema: BACKUP_SCHEMA,
    exportedAt,
    data: redactCredentials(dump)
  };
}

/** What a rider is told about credentials when they export — the same sentence, one place. */
export const BACKUP_CREDENTIALS_NOTE =
  'Credentials are left out of the file: restore it and you will re-enter your AI key and reconnect Strava.';
