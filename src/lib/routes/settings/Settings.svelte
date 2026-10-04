<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import {
    syncState,
    weightSeries,
    latestFtp,
    allBikes,
    powerZones
  } from '$lib/data/queries.svelte';
  import { db, type Settings as SettingsRec, type WeightLog, type FtpHistory, type Athlete } from '$lib/data/db';
  import { markWiped, newId } from '$lib/data/seed';
  import { recomputeSince } from '$lib/data/recompute';
  import { bandsFromStops, validateStops, ZONE_TEMPLATES, type ZoneStop } from '$lib/domain/zones';
  import { buildTrend } from '$lib/domain/trend';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { toast } from '$lib/toast.svelte';

  /** one global pill; this route only decides the words (UI-SPEC §46) */
  const showToast = (msg: string): void => toast.ok(msg);
  const showFailure = (msg: string, err: unknown): void => {
    console.error('[zonadua] settings failed:', err);
    toast.error(msg);
  };
  
  // ---------- form state (hydrated once from Dexie) ----------
  let hydrated = $state(false);
  // full FTP history, not just the newest row — the trend chart needs the whole series
  let ftpHistory = $state<FtpHistory[]>([]);
  let name = $state('');
  let heightCm = $state(174);
  let weightKg = $state(68.2);
  let ftpW = $state(275);
  let unit = $state<'metric' | 'imperial'>('metric');
  let lang = $state<'en' | 'id'>('en');
  let weatherOn = $state(true);
  let aiProvider = $state<'gemini' | 'openai' | 'openrouter' | 'anthropic'>('gemini');
  let aiKey = $state('');
  let keyDirty = $state(false);
  // theme lives only in the DB record for now — the switch lands with race-day theming (F7)


  void (async () => {
    try {
      const [a, s, w, f] = await Promise.all([
        db.athlete.get('me'),
        db.settings.get('app'),
        db.weight_log.orderBy('date').last(),
        db.ftp_history.orderBy('date').last()
      ]);
      ftpHistory = await db.ftp_history.orderBy('date').toArray();
      if (a) {
        name = a.name;
        heightCm = a.heightCm;
      }
      if (w) weightKg = w.kg;
      if (f) ftpW = f.ftp;
      if (s) {
        unit = s.unit;
        lang = s.lang;
        weatherOn = s.weatherOn;
        aiProvider = s.aiProvider ?? 'gemini';
        aiKey = s.aiKey ?? '';
      }
      hydrated = true;
    } catch (err) {
      // the form is still editable with the seeded defaults, so this is not fatal — but
      // "my settings did not load" must not look identical to "your settings are saved"
      showFailure('Could not load your settings', err);
    }
  })();

  async function saveProfile(): Promise<void> {
    if (!hydrated) return;
    try {
      const a: Athlete = { id: 'me', name: name.trim() || 'Athlete', sex: 'm', birthDate: '1991-05-14', heightCm, updatedAt: Date.now() };
      await db.athlete.put(a);
      showToast('Profile saved');
    } catch (err) {
      showFailure('Could not save profile', err);
    }
  }

  async function logWeight(): Promise<void> {
    const kg = Number.parseFloat(String(weightKg));
    if (!Number.isFinite(kg) || kg <= 0) return;
    try {
      const rec: WeightLog = { id: newId(), date: new Date().toISOString().slice(0, 10), kg, updatedAt: Date.now() };
      await db.weight_log.put(rec);
      showToast(`Weight ${kg} kg logged`);
    } catch (err) {
      showFailure('Could not log weight', err);
    }
  }

  async function logFtp(): Promise<void> {
    const ftp = Number.parseFloat(String(ftpW));
    if (!Number.isFinite(ftp) || ftp <= 0) return;
    try {
      const rec: FtpHistory = { id: newId(), date: new Date().toISOString().slice(0, 10), ftp, updatedAt: Date.now() };
      await db.ftp_history.put(rec);
      ftpHistory = [...ftpHistory, rec].sort((x, y) => x.date.localeCompare(y.date));
      // IF and TSS are both divided by FTP, but the FTP applied to a ride is the one in
      // force on the ride's date (ARCHITECTURE.md §5.1) — so an entry logged today only
      // rescores rides from today forward. Backdated entries rescore everything after them.
      const rescored = await recomputeSince(rec.date);
      showToast(
        rescored > 0
          ? `FTP ${ftp} W logged — ${rescored} ride${rescored === 1 ? '' : 's'} rescored`
          : `FTP ${ftp} W logged — applies from today`
      );
    } catch (err) {
      showFailure('Could not log FTP', err);
    }
  }

  // ---------- body trend (F2-AC2) ----------
  const trend = $derived(buildTrend(weightSeries.current ?? [], ftpHistory));

  // ---------- zone editor (F2-AC4) ----------
  let zoneStops = $state<ZoneStop[]>(
    (powerZones.current ?? []).map((b) => ({ key: b.key, name: b.name, minPct: b.minPct }))
  );
  let zoneBaseline = $state('');
  $effect(() => {
    // re-sync the editor whenever the stored set changes (save, reset, or first load)
    const bands = powerZones.current;
    if (!bands) return;
    const sig = bands.map((b) => `${b.key}:${b.name}:${b.minPct}`).join('|');
    if (sig !== zoneBaseline) {
      zoneBaseline = sig;
      zoneStops = bands.map((b) => ({ key: b.key, name: b.name, minPct: b.minPct }));
    }
  });

  const zoneCheck = $derived(validateStops(zoneStops));
  const zoneBands = $derived(bandsFromStops(zoneStops));
  const zoneChanged = $derived(zoneBaseline !== zoneStops.map((s) => `${s.key}:${s.name}:${s.minPct}`).join('|'));

  function applyTemplate(id: string): void {
    const t = ZONE_TEMPLATES.find((x) => x.id === id);
    if (t) zoneStops = t.stops.map((s) => ({ ...s }));
  }

  function addZone(): void {
    const top = zoneStops.at(-1)?.minPct ?? 0;
    zoneStops = [...zoneStops, { key: `Z${zoneStops.length}`, name: 'New zone', minPct: top + 10 }];
  }

  function removeZone(i: number): void {
    zoneStops = zoneStops.filter((_, k) => k !== i);
  }

  async function saveZones(): Promise<void> {
    if (!zoneCheck.ok) return;
    try {
      const rows = await db.zones.where('type').equals('power').toArray();
      const version = Math.max(0, ...rows.map((r) => r.version)) + 1;
      await db.zones.put({
        id: 'power',
        type: 'power',
        version,
        zones: zoneBands.map((b) => ({ name: b.name, min: b.minPct, max: Number.isFinite(b.maxPct) ? b.maxPct : undefined })),
        updatedAt: Date.now()
      });
      showToast(`Zones saved — v${version}`);
    } catch (err) {
      showFailure('Could not save zones', err);
    }
  }

  async function resetZones(): Promise<void> {
    try {
      await db.zones.delete('power');
      const t = ZONE_TEMPLATES[0];
      zoneStops = t.stops.map((s) => ({ ...s }));
      showToast('Zones reset to Coggan 8-zone');
    } catch (err) {
      // the table still holds the old bands while the form shows Coggan's, so saying
      // nothing here would leave the rider editing zones that are not in effect
      showFailure('Could not reset zones', err);
    }
  }

  async function savePrefs(patch: Partial<SettingsRec>, msg: string): Promise<void> {
    try {
      const cur = (await db.settings.get('app')) ?? { id: 'app', unit: 'metric', theme: 'dark', lang: 'en', weatherOn: true, updatedAt: 0 } as SettingsRec;
      await db.settings.put({ ...cur, ...patch, updatedAt: Date.now() });
      showToast(msg);
    } catch (err) {
      // this carries the unit/language/weather switches and the API key: a silent
      // failure here means the rider flips a switch and reloads into the old state
      showFailure(`Could not save — ${msg}`, err);
    }
  }

  async function saveKey(): Promise<void> {
    await savePrefs({ aiProvider, aiKey: aiKey.trim() || undefined }, aiKey.trim() ? 'API key saved — stored locally only' : 'API key cleared');
    keyDirty = false;
  }

  async function testKey(): Promise<void> {
    if (!aiKey.trim()) {
      showToast('Add a key first');
      return;
    }
    // M5 wires the real provider ping; the key is validated by shape today.
    const shapes: Record<string, RegExp> = {
      gemini: /^AI[\w-]{10,}$/,
      openai: /^sk-[\w-]{10,}$/,
      openrouter: /^sk-or-[\w-]{10,}$/,
      anthropic: /^sk-ant-[\w-]{10,}$/
    };
    const ok = shapes[aiProvider]?.test(aiKey.trim()) ?? aiKey.trim().length > 20;
    showToast(ok ? `Key format looks valid for ${aiProvider}` : `Key does not look like a ${aiProvider} key`);
  }

  // ---------- backup / restore (PRD F8) ----------
  async function backupJson(): Promise<void> {
    try {
      // Derived from the live schema, not hand-listed. The previous version enumerated
      // fourteen table names by hand and silently missed `power_curves`, which arrived with
      // schema v2 — so a backup-and-restore cycle quietly dropped the mean-max power curves,
      // and with them the CP/W' fit. A hand-written list fails at exactly the moment it is
      // extended; reading it off `db.tables` cannot.
      const dump: Record<string, unknown[]> = {};
      for (const t of db.tables) dump[t.name] = await t.toArray();
      const payload = { app: 'zonadua', schema: 2, exportedAt: new Date().toISOString(), data: dump };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `zonadua-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      // clears the bell's backup-overdue reminder (PRD §10)
      await savePrefs({ lastBackupAt: Date.now() }, 'Backup downloaded');
    } catch (err) {
      showFailure('Backup failed', err);
    }
  }

  let restoreInput: HTMLInputElement | null = $state(null);
  async function onRestorePick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; data?: Record<string, unknown[]> };
      // Accept both the old `gowslab` tag and the current one. Renaming the app must not turn
      // every backup a rider already exported into a file the app refuses to open — the
      // payload is the rider's own training history, and there is no undo for "wrong
      // file, sorry".
      if ((parsed.app !== 'zonadua' && parsed.app !== 'gowslab') || !parsed.data)
        throw new Error('Not a Zonadua backup');
      // Restoring is a merge, not a replace: the table set comes from the file so a backup
      // written before a new table existed still restores cleanly.
      for (const tn of Object.keys(parsed.data)) {
        if (!db.tables.some((t) => t.name === tn)) {
          console.warn('[zonadua] backup contains unknown table, skipped:', tn);
        }
      }
      const tableNames = Object.keys(parsed.data ?? {}) as string[];
      await db.transaction('rw', db.tables, async () => {
        for (const tn of tableNames) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = (db as any)[tn] as undefined | { bulkPut: (rows: unknown[]) => Promise<unknown> };
          const rows = parsed.data?.[tn];
          if (t && Array.isArray(rows) && rows.length > 0) await t.bulkPut(rows);
        }
      });
      showToast('Backup restored — data merged');
    } catch (err) {
      showFailure('Restore failed — invalid backup file', err);
    }
  }

  // ---------- wipe all (double confirm) ----------
  let wipeStep = $state(0); // 0 idle · 1 confirm · 2 type DELETE
  let wipeText = $state('');
  async function wipeAll(): Promise<void> {
    try {
      await Promise.all(db.tables.map((t) => t.clear()));
      // Before the reload, and in localStorage, because the reload re-runs the seed and every
      // Dexie table is now empty. Without this the demo rides come straight back.
      markWiped();
      location.hash = '#/';
      location.reload();
    } catch (err) {
      showFailure('Wipe failed', err);
      wipeStep = 0;
    }
  }

  // ---------- derived ----------
  const weights = $derived(weightSeries.current ?? []);
  const weightDelta = $derived(weights.length >= 2 ? Math.round((weights.at(-1)!.kg - weights.at(-2)!.kg) * 10) / 10 : null);
  const ftpVal = $derived(latestFtp.current?.ftp ?? null);
  const sync = $derived(syncState.current);
  const bikeCount = $derived((allBikes.current ?? []).length);
  const lastSync = $derived(sync?.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);
  const lastWeight = $derived(weights.at(-1)?.kg);
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader kicker="Preferences & data" headline="Settings" sub="Everything stays on —" accent="this device." />

  {#if !hydrated}
    <div class="rounded-card bg-surface border border-hairline p-8 text-center elevation-card">
      <span class="kicker">Loading settings…</span>
    </div>
  {:else}
    <!-- ATHLETE PROFILE -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Athlete profile</span>
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Name</span>
        <input
          class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink outline-none focus:border-signal transition-colors"
          type="text"
          bind:value={name}
          onchange={saveProfile}
        />
      </label>
      <div class="grid grid-cols-3 gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Height (cm)</span>
          <input
            class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink text-tabular outline-none focus:border-signal transition-colors"
            type="number"
            min="120"
            max="230"
            bind:value={heightCm}
            onchange={saveProfile}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Weight (kg)</span>
          <input
            class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink text-tabular outline-none focus:border-signal transition-colors"
            type="number"
            min="30"
            step="0.1"
            bind:value={weightKg}
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">FTP (W)</span>
          <input
            class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink text-tabular outline-none focus:border-signal transition-colors"
            type="number"
            min="50"
            step="1"
            bind:value={ftpW}
          />
        </label>
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-[11px] text-ink-dim">
          {#if lastWeight != null}
            Last log {lastWeight} kg{weightDelta !== null ? ` (${weightDelta >= 0 ? '+' : ''}${weightDelta})` : ''} · FTP {ftpVal ?? '—'} W
          {:else}
            No weight history yet
          {/if}
        </span>
        <div class="flex gap-2">
          <button
            class="h-9 px-3.5 rounded-pill bg-ink text-on-mono text-[10px] font-extrabold uppercase tracking-wider active:scale-[0.98] transition-transform"
            onclick={logWeight}
          >
            Log weight
          </button>
          <button
            class="h-9 px-3.5 rounded-pill bg-crimson-fill text-white text-[10px] font-extrabold uppercase tracking-wider active:scale-[0.98] transition-transform"
            onclick={logFtp}
          >
            Log FTP
          </button>
        </div>
      </div>
    </section>

    <!-- BODY TREND (F2-AC2) -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Body trend</span>
        <div class="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider">
          {#if trend.kgPerWeek !== 0}
            <span class="text-ink-dim">
              {trend.kgPerWeek > 0 ? '+' : ''}{trend.kgPerWeek} kg/wk
            </span>
          {/if}
          {#if trend.ftpDelta !== 0}
            <span class={trend.ftpDelta > 0 ? 'text-aman' : 'text-crimson-deep'}>
              {trend.ftpDelta > 0 ? '+' : ''}{trend.ftpDelta} W FTP
            </span>
          {/if}
        </div>
      </div>
      <TrendChart trend={trend} />
      <div class="flex items-center gap-4 pt-1 text-[10px] font-bold uppercase tracking-wider">
        <span class="flex items-center gap-1.5 text-ink-dim">
          <span class="h-2 w-2 rounded-pill bg-crimson"></span> Weight
        </span>
        <span class="flex items-center gap-1.5 text-ink-dim">
          <span class="h-2 w-2 rounded-pill bg-[#62656c]"></span> FTP (step)
        </span>
      </div>
      <p class="text-[11px] font-medium text-ink-dim">
        {#if trend.weight.length > 1}
          Straight segments between weigh-ins — nothing is interpolated between what you actually logged.
        {:else if trend.ftp.length > 1}
          FTP only. Log your weight twice to overlay it here.
        {:else}
          Log weight or FTP to build the trend.
        {/if}
      </p>
    </section>

    <!-- ZONE EDITOR (F2-AC4) -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Power zones</span>
        <span class="text-[10px] font-semibold text-ink-dim">vs FTP {ftpW} W</span>
      </div>

      <div class="flex gap-2 overflow-x-auto scrollbar-none">
        {#each ZONE_TEMPLATES as t (t.id)}
          <button
            class="h-8 shrink-0 rounded-pill px-3.5 text-[10px] font-extrabold uppercase tracking-wider transition-colors {zoneStops.length === t.stops.length &&
            t.stops.every((s, i) => s.name === zoneStops[i]?.name && s.minPct === zoneStops[i]?.minPct)
              ? 'bg-ink text-on-mono'
              : 'bg-tile text-ink-dim border border-hairline hover:text-ink'}"
            onclick={() => applyTemplate(t.id)}
            title={t.note}
          >
            {t.name}
          </button>
        {/each}
      </div>

      <ul class="flex flex-col divide-y divide-hairline">
        {#each zoneBands as band, i (band.key)}
          <li class="flex items-center gap-2.5 py-2">
            <input
              class="h-9 min-w-0 flex-1 rounded-xl bg-tile border border-hairline px-2.5 text-[13px] font-bold text-ink outline-none focus:border-signal"
              value={zoneStops[i]?.name ?? ''}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                zoneStops = zoneStops.map((s, k) => (k === i ? { ...s, name: v } : s));
              }}
              aria-label="Zone {i + 1} name"
            />
            <label class="flex items-center gap-1.5">
              <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">from</span>
              <input
                class="h-9 w-16 rounded-xl bg-tile border border-hairline px-2 text-[13px] font-bold text-ink text-tabular outline-none focus:border-signal"
                type="number"
                min="0"
                max="300"
                step="1"
                value={zoneStops[i]?.minPct ?? 0}
                onchange={(e) => {
                  const v = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
                  zoneStops = zoneStops.map((s, k) => (k === i ? { ...s, minPct: Number.isFinite(v) ? v : 0 } : s));
                }}
                aria-label="Zone {i + 1} lower bound percent of FTP"
              />
              <span class="text-[11px] font-bold text-ink-dim">%</span>
            </label>
            <span class="w-14 shrink-0 text-right text-[11px] font-bold text-tabular text-ink-dim">
              {Math.round((band.minPct / 100) * Number(ftpW))} W
            </span>
            {#if zoneStops.length > 1}
              <button
                class="grid h-8 w-8 shrink-0 place-items-center rounded-pill text-ink-dim hover:text-kritis"
                onclick={() => removeZone(i)}
                aria-label="Remove {band.name}"
              >
                <Icon name="trash" size={15} strokeWidth={1.8} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if !zoneCheck.ok}
        <p class="flex items-center gap-1.5 text-[11px] font-semibold text-kritis">
          <Icon name="alert-triangle" size={13} strokeWidth={2} /> {zoneCheck.reason}
        </p>
      {/if}

      <div class="flex items-center gap-2">
        <button
          class="h-9 px-3 rounded-pill bg-tile border border-hairline text-[10px] font-extrabold uppercase tracking-wider text-ink-dim disabled:opacity-40"
          onclick={addZone}
          disabled={zoneStops.length >= 10}
        >
          <Icon name="plus" size={12} strokeWidth={2.5} class="inline mr-1" /> Zone
        </button>
        <button
          class="h-9 px-3.5 rounded-pill bg-crimson-fill text-white text-[10px] font-extrabold uppercase tracking-wider disabled:opacity-40 active:scale-[0.98] transition-transform"
          onclick={saveZones}
          disabled={!zoneCheck.ok || !zoneChanged}
        >
          Save zones
        </button>
        <button
          class="ml-auto h-9 px-3 rounded-pill bg-tile border border-hairline text-[10px] font-extrabold uppercase tracking-wider text-ink-dim hover:text-ink"
          onclick={resetZones}
        >
          <Icon name="rotate-ccw" size={12} strokeWidth={2.2} class="inline mr-1" /> Reset
        </button>
      </div>
      <p class="text-[11px] font-medium text-ink-dim">
        Upper bounds are filled from the next zone's lower bound, so the bands always tile the
        full range — no power can fall outside every zone.
      </p>
    </section>

    <!-- PREFERENCES -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Preferences</span>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <Icon name="ruler" size={17} strokeWidth={1.5} class="text-ink-dim shrink-0" />
          <span class="text-[13px] font-semibold text-ink">Units</span>
        </div>
        <div class="flex rounded-pill bg-tile border border-hairline p-0.5">
          {#each [['metric', 'km'], ['imperial', 'mi']] as [u, label] (u)}
            <button
              class="h-7 px-3 rounded-pill text-[10px] font-extrabold uppercase tracking-wider transition-colors {unit === u ? 'bg-ink text-on-mono' : 'text-ink-dim'}"
              onclick={() => {
                unit = u as 'metric' | 'imperial';
                void savePrefs({ unit: unit }, `Units switched to ${unit}`);
              }}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-[17px] text-center text-ink-dim font-black text-[13px] shrink-0">Aa</span>
          <span class="text-[13px] font-semibold text-ink">Language</span>
        </div>
        <div class="flex rounded-pill bg-tile border border-hairline p-0.5">
          {#each [['en', 'EN'], ['id', 'ID']] as [l, label] (l)}
            <button
              class="h-7 px-3 rounded-pill text-[10px] font-extrabold uppercase tracking-wider transition-colors {lang === l ? 'bg-ink text-on-mono' : 'text-ink-dim'}"
              onclick={() => {
                lang = l as 'en' | 'id';
                void savePrefs({ lang }, `Language set to ${lang === 'en' ? 'English' : 'Indonesia'}`);
              }}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <Icon name="cloud-sun" size={17} strokeWidth={1.5} class="text-ink-dim shrink-0" />
          <div class="flex flex-col min-w-0">
            <span class="text-[13px] font-semibold text-ink">Weather-aware pacing</span>
            <span class="text-[10px] text-ink-dim">Open-Meteo adjustment in Route estimator</span>
          </div>
        </div>
        <button
          class="w-11 h-6 rounded-pill relative transition-colors {weatherOn ? 'bg-crimson-fill' : 'bg-hairline-strong'}"
          role="switch"
          aria-checked={weatherOn}
          aria-label="Weather-aware pacing"
          onclick={() => {
            weatherOn = !weatherOn;
            void savePrefs({ weatherOn }, `Weather pacing ${weatherOn ? 'on' : 'off'}`);
          }}
        >
          <span class="absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow transition-all {weatherOn ? 'left-[22px]' : 'left-0.5'}"></span>
        </button>
      </div>
    </section>

    <!-- AI KEY (F5 dependency) -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <Icon name="key-round" size={17} strokeWidth={1.5} class="text-aman" />
          <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">AI coach key</span>
        </div>
        {#if aiKey}
          <StatusChip label="Key saved" status="aman" icon="check" />
        {:else}
          <StatusChip label="Not set" status="neutral" />
        {/if}
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each [['gemini', 'Gemini'], ['openai', 'OpenAI'], ['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic']] as [p, label] (p)}
          <button
            class="h-8 px-3 rounded-pill text-[11px] font-bold border transition-colors {aiProvider === p
              ? 'bg-ink text-on-mono border-ink'
              : 'bg-tile text-ink-dim border-hairline hover:text-ink'}"
            onclick={() => {
              aiProvider = p as typeof aiProvider;
              keyDirty = true;
            }}
          >
            {label}
          </button>
        {/each}
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">API key · stored locally, sent only to your provider</span>
        <input
          class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink outline-none focus:border-signal transition-colors"
          type="password"
          placeholder="Paste your key…"
          bind:value={aiKey}
          oninput={() => (keyDirty = true)}
        />
      </label>
      {#if keyDirty}
        <div class="flex gap-2">
          <button
            class="h-10 flex-1 rounded-pill bg-crimson-fill text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
            onclick={saveKey}
          >
            <Icon name="check" size={15} strokeWidth={2.4} />
            Save key
          </button>
          <button
            class="h-10 px-4 rounded-pill bg-tile border border-hairline text-ink-dim text-[10px] font-extrabold uppercase tracking-wider"
            onclick={() => {
              keyDirty = false;
              showToast('Changes discarded');
            }}
          >
            Cancel
          </button>
        </div>
      {:else}
        <div class="flex gap-2">
          <button
            class="h-10 flex-1 rounded-pill bg-tile border border-hairline text-ink text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:border-hairline-strong transition-colors"
            onclick={testKey}
          >
            <Icon name="plug" size={15} strokeWidth={1.8} />
            Test key
          </button>
          {#if aiKey}
            <button
              class="h-10 px-4 rounded-pill bg-tile border border-hairline text-ink-dim hover:text-kritis text-[10px] font-extrabold uppercase tracking-wider transition-colors"
              onclick={() => {
                aiKey = '';
                void saveKey();
              }}
            >
              <Icon name="x" size={15} strokeWidth={1.8} />
            </button>
          {/if}
        </div>
      {/if}
    </section>

    <!-- STRAVA SYNC -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-2.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <Icon name="refresh-cw" size={17} strokeWidth={1.5} class="text-signal" />
          <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Strava sync</span>
        </div>
        <StatusChip label={lastSync ? `Last sync ${lastSync}` : 'Never synced'} status={lastSync ? 'aman' : 'neutral'} />
      </div>
      <p class="text-[12px] text-ink-dim leading-relaxed">
        File import is the primary path — sync is optional and obeys Strava API policy. Reconnect to pull activities since the last cursor.
      </p>
      <button
        class="h-10 w-full rounded-pill bg-tile border border-hairline text-[10px] font-extrabold uppercase tracking-wider text-ink flex items-center justify-center gap-1.5 hover:border-hairline-strong transition-colors"
        onclick={() => showToast(`Sync stored locally · ${bikeCount} bikes · file import stays primary`)}
      >
        <Icon name="refresh-cw" size={14} strokeWidth={1.8} />
        Re-sync now
      </button>
    </section>

    <!-- DATA: BACKUP / RESTORE / WIPE -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-3">
      <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Data management</span>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="h-11 rounded-2xl bg-tile border border-hairline text-[10px] font-extrabold uppercase tracking-wider text-ink flex items-center justify-center gap-1.5 hover:border-hairline-strong transition-colors"
          onclick={backupJson}
        >
          <Icon name="download" size={15} strokeWidth={1.8} />
          Backup JSON
        </button>
        <button
          class="h-11 rounded-2xl bg-tile border border-hairline text-[10px] font-extrabold uppercase tracking-wider text-ink flex items-center justify-center gap-1.5 hover:border-hairline-strong transition-colors"
          onclick={() => restoreInput?.click()}
        >
          <Icon name="upload" size={15} strokeWidth={1.8} />
          Restore
        </button>
      </div>
      <input bind:this={restoreInput} class="hidden" type="file" accept=".json" onchange={onRestorePick} aria-label="Restore backup" />

      {#if wipeStep === 0}
        <button
          class="h-11 w-full rounded-2xl border border-kritis/40 bg-kritis/5 text-kritis text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-kritis/10 transition-colors"
          onclick={() => (wipeStep = 1)}
        >
          <Icon name="trash-2" size={15} strokeWidth={1.8} />
          Delete all data
        </button>
      {:else if wipeStep === 1}
        <div class="rounded-2xl border border-kritis/40 bg-kritis/5 p-3.5 flex flex-col gap-2.5">
          <div class="flex items-start gap-2">
            <Icon name="alert-triangle" size={17} strokeWidth={1.8} class="text-kritis shrink-0 mt-0.5" />
            <p class="text-[12px] font-bold text-kritis leading-relaxed">
              This erases every bike, ride, route and race on this device. Export a backup first — this cannot be undone.
            </p>
          </div>
          <div class="flex gap-2">
            <button
              class="h-9 flex-1 rounded-pill bg-kritis text-white text-[10px] font-extrabold uppercase tracking-wider"
              onclick={() => (wipeStep = 2)}
            >
              Continue
            </button>
            <button
              class="h-9 px-4 rounded-pill bg-tile border border-hairline text-ink-dim text-[10px] font-extrabold uppercase tracking-wider"
              onclick={() => (wipeStep = 0)}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="rounded-2xl border border-kritis/40 bg-kritis/5 p-3.5 flex flex-col gap-2.5">
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-bold uppercase tracking-wider text-kritis">Type DELETE to confirm</span>
            <input
              class="h-10 rounded-xl bg-surface border border-kritis/40 px-3 text-sm font-extrabold text-ink outline-none focus:border-kritis"
              type="text"
              bind:value={wipeText}
              placeholder="DELETE"
            />
          </label>
          <div class="flex gap-2">
            <button
              class="h-9 flex-1 rounded-pill bg-kritis text-white text-[10px] font-extrabold uppercase tracking-wider disabled:opacity-40"
              disabled={wipeText !== 'DELETE'}
              onclick={wipeAll}
            >
              Erase everything
            </button>
            <button
              class="h-9 px-4 rounded-pill bg-tile border border-hairline text-ink-dim text-[10px] font-extrabold uppercase tracking-wider"
              onclick={() => {
                wipeStep = 0;
                wipeText = '';
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </section>

    <p class="text-center text-xs text-ink-dim">Zonadua · local-first · your data never leaves this device except AI requests you trigger.</p>
  {/if}
</div>

