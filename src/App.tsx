import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Cpu,
  CircuitBoard,
  FolderPlus,
  Plus,
  Search,
  RefreshCw,
  Upload,
  Download,
  Settings2,
  Layers,
  Boxes,
  Activity,
  ArrowUpRight,
  ChevronRight,
  Trash2,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  HardDrive,
  Folder,
  LayoutGrid,
} from 'lucide-react';
import Papa from 'papaparse';
import { uid, type Workspace, type Project, type BomRow, type Observation } from './core/types';
import {
  readWorkspace,
  writeWorkspace,
  replaceWorkspace,
  recoveryEntries,
  drainWorkspaceWrites,
  readBackupStatus,
  writeBackupStatus,
} from './core/database';
import { APP_VERSION, backupDue, emptyBackupStatus, type BackupStatus } from './core/local-release';
import { holdEditorLock, type EditorState } from './core/editor-lock';
import { EditorGate } from './components/EditorGate';
import {
  emptyWorkspace,
  migrate,
  mergeWorkspace,
  editableWorkspace,
  removeProject,
} from './core/storage';
import {
  calculate,
  defaultBuild,
  boardCount,
  buildRows,
  standardOnlyPackage,
} from './core/calculations';
import { componentAssembly } from './core/assembly-fees';
import { validateRows } from './core/bom';
import { identityWarnings } from './core/identity';
import { supplierChanges } from './core/supplier-changes';
import { RefreshSummary, type RefreshReport } from './components/RefreshSummary';
import { matchesComponent, compareNullable, serviceFor } from './core/component-view';
import { refreshCodes, freshness, createRefreshQueue } from './core/supplier';
import {
  Modal,
  Field,
  AssemblyQuantity,
  Badge,
  useConfirmation,
  Empty,
  money,
  count,
  when,
  download,
  safeName,
} from './components/common';
import { BomImport } from './components/BomImport';
import { BuildPanel } from './components/BuildPanel';
import { PartDetail } from './components/PartDetail';
import {
  Settings,
  DemandPanel,
  InventoryPanel,
  RevisionsPanel,
  ScenariosPanel,
} from './components/WorkspacePanels';

type View = 'bom' | 'build' | 'scenarios' | 'revisions' | 'demand' | 'inventory' | 'activity';
export default function App() {
  const confirmation = useConfirmation();
  const [initial] = useState(() => ({ workspace: emptyWorkspace(), error: '' }));
  const [ready, setReady] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>('checking');
  const [lockAttempt, setLockAttempt] = useState(0);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>(emptyBackupStatus);
  const [saving, setSaving] = useState(true);
  useEffect(() => {
    setEditorState('checking');
    return holdEditorLock(navigator.locks, setEditorState, () => drainWorkspaceWrites());
  }, [lockAttempt]);
  const [w, setW] = useState<Workspace>(initial.workspace),
    [loadError, setLoadError] = useState(initial.error),
    [saveError, setSaveError] = useState('');
  const [projectId, setProjectId] = useState(initial.workspace.projects[0]?.id || ''),
    [view, setView] = useState<View>('bom');
  const [modal, setModal] = useState<'project' | 'import' | 'settings' | null>(null),
    [editingProject, setEditingProject] = useState(false),
    [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null),
    [restore, setRestore] = useState<Workspace | null>(null);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [stockFilter, setStockFilter] = useState('all'),
    [libraryFilter, setLibraryFilter] = useState('all'),
    [serviceFilter, setServiceFilter] = useState('all'),
    [populationFilter, setPopulationFilter] = useState('all'),
    [sort, setSort] = useState('risk'),
    [group, setGroup] = useState('none'),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [notice, setNotice] = useState(''),
    [code, setCode] = useState('');
  const [refreshReport, setRefreshReport] = useState<RefreshReport | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null),
    wRef = useRef(w);
  const rulesQueued = useRef(new Set<string>());
  wRef.current = w;
  const p = w.projects.find((x) => x.id === projectId),
    b = p?.workingBuild;
  const rows = p && b ? buildRows(p, b) : [];
  const calc = useMemo(
    () =>
      p && b
        ? calculate(rows, w.observations, b, w.pricing, w.inventory, w.settings.staleMinutes)
        : null,
    [p, b, w.observations, w.pricing, w.inventory],
  );
  useEffect(() => {
    if (editorState !== 'editor') return;
    let cancelled = false;
    Promise.all([readWorkspace(localStorage), readBackupStatus().catch(() => emptyBackupStatus())])
      .then(([saved, backup]) => {
        if (!cancelled) {
          setBackupStatus(backup);
          setW(editableWorkspace(saved));
          setProjectId(saved.projects[0]?.id || '');
          setReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError('Saved data could not be loaded: ' + e.message);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editorState]);
  useEffect(() => {
    if (!ready || loadError || editorState !== 'editor') return;
    setSaving(true);
    let cancelled = false;
    Promise.resolve()
      .then(() => writeWorkspace(w))
      .then(() => {
        if (!cancelled) {
          setSaveError('');
          setSaving(false);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setSaveError('Changes are in memory only: ' + e.message + '. Export a backup now.');
      });
    return () => {
      cancelled = true;
    };
  }, [w, loadError, ready, editorState]);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const updateProject = useCallback(
    (next: Project) =>
      setW((prev) =>
        editableWorkspace({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === next.id ? { ...next, updatedAt: Date.now() } : p,
          ),
        }),
      ),
    [],
  );
  const runRefresh = useCallback(async (all: string[]) => {
    setBusy(true);
    const before = wRef.current;
    const successful: Record<string, Observation> = {};
    let failures = 0;
    try {
      await refreshCodes(all, before.observations, (code, result) => {
        if (!(result instanceof Error)) successful[code] = result;
        setW((prev) => {
          const old = prev.observations[code];
          const o: Observation =
            result instanceof Error
              ? {
                  ...(old || {
                    code,
                    model: '',
                    brand: '',
                    description: '',
                    footprint: '',
                    category: '',
                    stock: null,
                    prices: [],
                    library: 'unknown',
                    eligibility: 'unknown',
                    updatedAt: 0,
                    history: [],
                  }),
                  error: result.message,
                  attemptedAt: Date.now(),
                }
              : result;
          const observations = { ...prev.observations, [code]: o },
            events = [...prev.events];
          const messages: string[] = [];
          if (result instanceof Error) {
            if (old?.error !== result.message)
              messages.push(code + ': refresh failed; cached data retained.');
          } else {
            if (old?.stock === 0 && o.stock !== null && o.stock > 0)
              messages.push(code + ': back in stock (' + o.stock + ').');
            if (old && old.library !== o.library)
              messages.push(code + ': library ' + old.library + ' → ' + o.library + '.');
            if (old && old.eligibility !== o.eligibility)
              messages.push(code + ': assembly eligibility changed; review.');
            for (const pr of prev.projects)
              for (const build of [
                pr.workingBuild,
                ...pr.builds.filter((x) => x.status === 'planned'),
              ]) {
                const rr = buildRows(pr, build);
                if (!rr.some((r) => r.code === code && r.population === 'jlc')) continue;
                const prior = calculate(
                  rr,
                  prev.observations,
                  build,
                  prev.pricing,
                  prev.inventory,
                ).lines.find((l) => l.code === code);
                const after = calculate(
                  rr,
                  observations,
                  build,
                  prev.pricing,
                  prev.inventory,
                ).lines.find((l) => l.code === code);
                if (
                  after &&
                  prior &&
                  after.shortage !== prior.shortage &&
                  ((after.shortage ?? 0) > 0 || (prior.shortage ?? 0) > 0)
                )
                  messages.push(
                    pr.name +
                      ' / ' +
                      build.name +
                      ': ' +
                      code +
                      ((after.shortage ?? 0) > 0
                        ? ' short by ' + after.shortage
                        : ' now covers this build') +
                      '.',
                  );
              }
            for (const pr of prev.projects)
              for (const r of pr.rows)
                if (
                  r.code === code &&
                  r.minStock !== undefined &&
                  o.stock !== null &&
                  o.stock < r.minStock &&
                  (old?.stock === null || old?.stock === undefined || old.stock >= r.minStock)
                )
                  messages.push(pr.name + ': ' + code + ' crossed the low-stock threshold.');
          }
          for (const message of [...new Set(messages)])
            events.unshift({
              id: uid(),
              date: Date.now(),
              kind: result instanceof Error ? 'refresh' : 'stock',
              message,
            });
          return { ...prev, observations, events: events.slice(0, 250) };
        });
        if (result instanceof Error) failures++;
      });
    } finally {
      setBusy(false);
    }
    const current = wRef.current;
    const changes = supplierChanges(
      { ...current, observations: before.observations },
      { ...current, observations: { ...current.observations, ...successful } },
      Object.keys(successful),
    );
    setRefreshReport({ id: Date.now(), checked: all.length, failed: failures, changes });
    const requirementChanges = changes.filter((c) => c.kind === 'requirement');
    if (requirementChanges.length)
      setW((prev) => ({
        ...prev,
        events: [
          ...requirementChanges.map((c) => ({
            id: uid(),
            date: Date.now(),
            kind: 'stock',
            message: `${current.projects.find((p) => p.id === c.projectId)?.name || 'Project'} / ${c.code}: ${c.message}`,
          })),
          ...prev.events,
        ].slice(0, 250),
      }));
    setNotice(
      failures
        ? failures + ' lookup(s) failed. Previous observations were kept.'
        : 'Supplier lookup complete. Stock and prices updated.',
    );
  }, []);
  const refreshQueue = useMemo(() => createRefreshQueue(runRefresh), [runRefresh]);
  const refresh = useCallback(
    async (codes?: string[]) => {
      if (!navigator.onLine) {
        setNotice('Offline: your BOM is saved locally. Use Refresh parts when you reconnect.');
        return;
      }
      const all =
        codes ||
        wRef.current.projects.flatMap((p) =>
          [...p.rows, ...p.revisions.flatMap((r) => r.rows)].flatMap((r) => [
            r.code,
            ...r.alternatives.map((a) => a.code),
          ]),
        );
      try {
        await refreshQueue(all);
      } catch (e) {
        setNotice(
          'Lookup stopped: ' + (e as Error).message + '. Your BOM is saved; retry Refresh parts.',
        );
      }
    },
    [refreshQueue],
  );
  useEffect(() => {
    if (!ready || loadError || !online || !p) return;
    const codes = [...new Set(p.rows.map((r) => r.code))].filter(
      (code) =>
        /^C\d+$/.test(code) &&
        w.observations[code]?.supplierRules?.pcbaType === undefined &&
        !rulesQueued.current.has(code),
    );
    codes.forEach((code) => rulesQueued.current.add(code));
    if (codes.length) void refresh(codes);
  }, [ready, loadError, online, p?.id, p?.rows, refresh]);
  useEffect(() => {
    if (!w.settings.pollEnabled) return;
    const timer = setInterval(() => refresh(), Math.max(1, w.settings.pollMinutes) * 60000);
    return () => clearInterval(timer);
  }, [w.settings.pollEnabled, w.settings.pollMinutes, refresh]);
  // Repaint freshness labels even when no supplier response arrives.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const openProject = (id: string) => {
    setProjectId(id);
    setView('bom');
    setSearch('');
    resetFilters();
    setSelected([]);
    setDetailId(null);
  };
  const saveProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingProject && p)
      updateProject({ ...p, name: name.trim(), description: description.trim() });
    else {
      const project: Project = {
        id: uid(),
        name: name.trim(),
        description: description.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rows: [],
        workingBuild: defaultBuild(),
        revisions: [],
        builds: [],
      };
      setW((prev) => ({ ...prev, projects: [...prev.projects, project] }));
      openProject(project.id);
    }
    setModal(null);
  };
  const deleteProject = async (project: Project) => {
    if (
      !(await confirmation.ask(
        'Delete “' +
          project.name +
          '”, including its revisions and saved builds? Allocated inventory will be released. Export a backup first if you need a copy.',
      ))
    )
      return;
    const nextId = wRef.current.projects.find((x) => x.id !== project.id)?.id || '';
    setW((prev) => removeProject(prev, project.id));
    setModal(null);
    openProject(nextId);
    setNotice('Project deleted. Its inventory allocations were released.');
  };
  const importRows = (next: BomRow[], revision: boolean, basis: 'board' | 'panel') => {
    if (!p) return;
    const revisions =
      revision && p.rows.length
        ? [
            ...p.revisions,
            {
              id: uid(),
              name: 'Before import ' + new Date().toLocaleString(),
              date: Date.now(),
              rows: structuredClone(p.rows),
              observations: structuredClone(w.observations),
              build: structuredClone(p.workingBuild),
              pricing: structuredClone(w.pricing),
              inventory: structuredClone(w.inventory),
            },
          ]
        : p.revisions;
    updateProject({
      ...p,
      rows: next,
      revisions,
      workingBuild: { ...p.workingBuild, revisionId: undefined, bomBasis: basis },
    });
    setModal(null);
    setView('bom');
    setSelected([]);
    setSearch('');
    setFilter('all');
    setDetailId(null);
    const codes = next
      .flatMap((r) => [r.code, ...r.alternatives.map((a) => a.code)])
      .filter((code) => /^C\d+$/.test(code));
    if (codes.length) {
      setNotice('BOM imported. Identifying components…');
      void refresh(codes);
    } else {
      setNotice('BOM imported. Add valid LCSC C-numbers to look up supplier data.');
    }
  };
  const addPart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!p || !/^C\d+$/.test(code)) return;
    const next: BomRow = {
      id: uid(),
      code,
      refs: [],
      qty: 1,
      value: '',
      footprint: '',
      mpn: '',
      population: 'jlc',
      tags: [],
      notes: '',
      alternatives: [],
      issues: [],
    };
    updateProject({
      ...p,
      rows: validateRows([...p.rows, next]),
      workingBuild: { ...p.workingBuild, revisionId: undefined },
    });
    setCode('');
    setDetailId(next.id);
    refresh([code]);
  };
  const updateBackupStatus = (next: BackupStatus) => {
    setBackupStatus(next);
    void writeBackupStatus(next).catch(() =>
      setNotice('Backup reminder status could not be saved. Your project data is unaffected.'),
    );
  };
  const backup = () => {
    try {
      download(
        'TRACE-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
        JSON.stringify(w, null, 2),
      );
      updateBackupStatus({ lastExportAt: Date.now(), snoozedUntil: null });
      setNotice('Backup export started. Check that the JSON file was saved in your downloads.');
    } catch (e) {
      setNotice('Backup export failed: ' + (e as Error).message);
    }
  };
  const exportUpdateRecovery = async () => {
    try {
      const entries = (await recoveryEntries()) as { appVersion?: string; workspace?: Workspace }[];
      const snapshot = entries.find((e) => e.appVersion === APP_VERSION);
      if (!snapshot?.workspace) {
        setNotice('No pre-update snapshot is available for this release.');
        return;
      }
      download(
        'TRACE-before-v' + APP_VERSION + '.json',
        JSON.stringify(snapshot.workspace, null, 2),
      );
      setNotice(
        'Pre-update snapshot export started. This contains the workspace from the first launch of this release.',
      );
    } catch (e) {
      setNotice('Recovery export failed: ' + (e as Error).message);
    }
  };
  const recover = async () => {
    const raw = Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith('jlcpcb'))
        .map((k) => [k, localStorage.getItem(k)]),
    );
    let recovery: unknown[] = [];
    try {
      recovery = await recoveryEntries();
    } catch {}
    download(
      'jlcpcb-raw-recovery.json',
      JSON.stringify({ legacy: raw, recovery, currentInMemory: w }, null, 2),
    );
  };
  const restoreFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 25e6) throw new Error('Backup exceeds 25 MB');
      setRestore(migrate(JSON.parse(await file.text())));
    } catch (e) {
      setNotice((e as Error).message);
    }
    if (restoreRef.current) restoreRef.current.value = '';
  };
  const applyRestore = async (mode: 'merge' | 'replace') => {
    if (!restore) return;
    try {
      const next = editableWorkspace(mode === 'merge' ? mergeWorkspace(w, restore) : restore);
      await replaceWorkspace(w, next);
      setW(next);
      setLoadError('');
      setProjectId(next.projects[0]?.id || '');
      setRestore(null);
      setSelected([]);
      setDetailId(null);
      setNotice('Restore complete. Previous local data was preserved.');
    } catch (e) {
      setNotice('Restore stopped: ' + (e as Error).message);
    }
  };
  const csvExport = (jlc = false) => {
    if (!p || !calc) return;
    if (
      jlc &&
      rows.some(
        (r) => r.population === 'jlc' && (r.issues.length || !r.footprint || !r.refs.length),
      )
    ) {
      setNotice('Resolve BOM issues and supply footprints/designators before JLCPCB BOM export.');
      return;
    }
    const data: Record<string, unknown>[] = jlc
      ? rows
          .filter((r) => r.population === 'jlc')
          .map((r) => ({
            Comment: r.value || r.description || r.mpn,
            Designator: r.refs.join(','),
            Footprint: r.footprint,
            'LCSC Part #': r.code,
          }))
      : rows.map((r) => {
          const o = w.observations[r.code],
            l = calc.lines.find((x) => x.rows.some((y) => y.id === r.id));
          const processing = componentAssembly(r, o);
          return {
            'C-number': r.code,
            Designators: r.refs.join(','),
            Value: r.value,
            MPN: r.mpn,
            Description: r.description || o?.description || r.value,
            Footprint: r.footprint,
            Population: r.population,
            'Per-BOM quantity': r.qty,
            'Aggregated placement demand': l?.placed,
            'Aggregated required quantity': l?.required,
            'Quantity rule': l?.quantitySource,
            'Assembly process': l?.process,
            'Assembly service': b?.mode,
            'Cost basis': b?.costScope || 'full',
            'Included in quote costing':
              b?.costScope !== 'selected' || !b.excludedCodes?.includes(r.code),
            'Stock source': b?.source,
            'Observed stock': l?.stock ?? 'Unknown',
            'Aggregated shortage': l?.shortage ?? 'Unknown',
            'Tier unit price': l?.unitPrice ?? 'Unknown',
            'Aggregated feeder fee': l?.fee ?? 'Unknown',
            'Special fee / placement USD': processing.specialFee ?? 'Unknown',
            Library: o?.library || 'unknown',
            Eligibility: o?.eligibility || 'unknown',
            'Last successful refresh': o?.updatedAt ? new Date(o.updatedAt).toISOString() : 'Never',
            Freshness: freshness(o, w.settings.staleMinutes),
            Tags: r.tags.join(','),
            Issues: r.issues.join('; '),
            Notes: r.notes,
          };
        });
    download(
      safeName(p.name) + (jlc ? '-jlc-bom.csv' : '-analysis.csv'),
      Papa.unparse(data, { escapeFormulae: true }),
      'text/csv;charset=utf-8',
    );
    if (jlc)
      setNotice('BOM exported. Placement/CPL and JLCPCB matching review are still required.');
  };
  const status = (r: BomRow) => {
    if (r.population !== 'jlc')
      return { text: r.population === 'dnp' ? 'DNP' : 'Manual assembly', tone: 'muted', risk: 0 };
    const l = calc?.lines.find((l) => l.rows.some((x) => x.id === r.id)),
      o = w.observations[r.code];
    if (r.issues.length) return { text: 'Review BOM', tone: 'warn', risk: 5 };
    if (l?.stock === null || !l) return { text: 'Unknown stock', tone: 'warn', risk: 4 };
    if (l.shortage! > 0) return { text: 'Short ' + count(l.shortage), tone: 'bad', risk: 6 };
    if (o?.error || freshness(o, w.settings.staleMinutes).toLowerCase().includes('stale'))
      return { text: 'Recheck stock', tone: 'warn', risk: 3 };
    if (r.minStock !== undefined && l.stock < r.minStock)
      return { text: 'Low stock', tone: 'warn', risk: 2 };
    return {
      text: l.provisional ? 'Covered · provisional' : 'Covered',
      tone: l.provisional ? 'warn' : 'good',
      risk: 1,
    };
  };
  function resetFilters() {
    setFilter('all');
    setStockFilter('all');
    setLibraryFilter('all');
    setServiceFilter('all');
    setPopulationFilter('all');
    setSearch('');
  }
  const hasFilters =
    !!search ||
    [filter, stockFilter, libraryFilter, serviceFilter, populationFilter].some((v) => v !== 'all');
  const visible = rows
    .filter((r) => {
      const o = w.observations[r.code],
        s = status(r);
      return (
        matchesComponent(
          r,
          o,
          calc?.lines.find((l) => l.rows.some((x) => x.id === r.id)),
          {
            stock: stockFilter,
            library: libraryFilter,
            service: serviceFilter,
            population: populationFilter,
          },
        ) &&
        [
          r.code,
          r.value,
          r.description,
          r.mpn,
          r.refs.join(' '),
          r.tags.join(' '),
          o?.model,
          o?.brand,
          o?.description,
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === 'all' ||
          (filter === 'attention' && (s.risk >= 2 || identityWarnings(r, o).length > 0)) ||
          (filter === 'identity' && identityWarnings(r, o).length > 0) ||
          (filter === 'short' && s.tone === 'bad') ||
          (filter === 'stale' &&
            (!o ||
              !!o.error ||
              freshness(o, w.settings.staleMinutes).toLowerCase().includes('stale'))) ||
          (filter === 'failed' && !!o?.error) ||
          (filter === 'issues' && !!r.issues.length) ||
          (filter === 'critical' && r.critical))
      );
    })
    .sort((a, b) => {
      const ao = w.observations[a.code],
        bo = w.observations[b.code];
      const al = calc?.lines.find((l) => l.rows.some((r) => r.id === a.id)),
        bl = calc?.lines.find((l) => l.rows.some((r) => r.id === b.id));
      const tie = a.code.localeCompare(b.code, undefined, { numeric: true });
      if (sort === 'stock' || sort === 'stock-desc')
        return compareNullable(al?.stock, bl?.stock, sort === 'stock-desc') || tie;
      if (sort === 'capacity') return compareNullable(al?.capacity, bl?.capacity) || tie;
      if (sort === 'quantity') return compareNullable(al?.required, bl?.required, true) || tie;
      if (sort === 'loading') return compareNullable(al?.fee, bl?.fee, true) || tie;
      if (sort === 'updated') return (bo?.updatedAt ?? 0) - (ao?.updatedAt ?? 0);
      if (sort === 'price')
        return (
          (calc?.lines.find((l) => l.code === b.code)?.unitPrice ?? -1) -
          (calc?.lines.find((l) => l.code === a.code)?.unitPrice ?? -1)
        );
      if (sort === 'total')
        return (
          (calc?.lines.find((l) => l.code === b.code)?.cost ?? -1) -
          (calc?.lines.find((l) => l.code === a.code)?.cost ?? -1)
        );
      if (sort === 'code') return a.code.localeCompare(b.code, undefined, { numeric: true });
      return status(b).risk - status(a).risk || Number(!!b.critical) - Number(!!a.critical);
    });
  const groups = new Map<string, BomRow[]>();
  for (const r of visible) {
    const o = w.observations[r.code];
    const key =
      group === 'brand'
        ? o?.brand || 'Unknown brand'
        : group === 'category'
          ? o?.category || 'Unclassified'
          : group === 'library'
            ? o?.library || 'unknown'
            : group === 'service'
              ? {
                  standard: 'Standard-only',
                  economic: 'Economic-capable',
                  unknown: 'Eligibility unknown',
                }[serviceFor(r, o)]
              : group === 'tag'
                ? r.tags[0] || 'Untagged'
                : 'All components';
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const rowDetail = p?.rows.find((r) => r.id === detailId);
  const activeViewTitle = {
    bom: 'Components',
    build: 'Build & cost',
    scenarios: 'Scenarios',
    revisions: 'Revisions',
    demand: 'Combined demand',
    inventory: 'Owned inventory',
    activity: 'Activity',
  }[view];
  if (editorState !== 'editor')
    return <EditorGate state={editorState} retry={() => setLockAttempt((n) => n + 1)} />;
  if (!ready)
    return (
      <div className="empty">
        <CircuitBoard size={32} />
        <h2>Opening your local workbench…</h2>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <CircuitBoard size={27} />
          </span>
          <span>
            TRACE<span className="brand-sub">JLCPCB WORKBENCH</span>
          </span>
          <span className="brand-dot" />
        </a>
        <div className="workspace-label">
          <span>YOUR WORKSPACE</span>
          <Badge tone="good">LOCAL</Badge>
        </div>
        <div className="project-list">
          {w.projects.map((pr) => (
            <button
              key={pr.id}
              className={'project-nav ' + (p?.id === pr.id ? 'active' : '')}
              onClick={() => openProject(pr.id)}
            >
              <Cpu size={18} />
              <span>
                {pr.name}
                <small>{pr.rows.length} BOM rows</small>
              </span>
              {p?.id === pr.id && <ChevronRight size={14} />}
            </button>
          ))}
        </div>
        <button
          className="new-project"
          disabled={!!loadError}
          onClick={() => {
            setEditingProject(false);
            setName('');
            setDescription('');
            setModal('project');
          }}
        >
          <Plus size={16} />
          New project
        </button>
        <div className="nav-divider" />
        <details className="workspace-tools">
          <summary>Workspace tools</summary>
          <button
            className={'nav-item ' + (view === 'demand' ? 'active' : '')}
            onClick={() => setView('demand')}
          >
            <Layers size={18} />
            Combined demand
          </button>
          <button
            className={'nav-item ' + (view === 'inventory' ? 'active' : '')}
            onClick={() => setView('inventory')}
          >
            <Boxes size={18} />
            Owned inventory
          </button>
          <button
            className={'nav-item ' + (view === 'activity' ? 'active' : '')}
            onClick={() => setView('activity')}
          >
            <Activity size={18} />
            Activity <span className="nav-count">{w.events.length}</span>
          </button>
        </details>
        <div className="sidebar-bottom">
          <div className="local-note">
            <HardDrive size={17} />
            <span>
              On your device
              <small>
                {saveError ? 'Changes not saved' : saving ? 'Saving…' : 'Saved in this browser'}
              </small>
            </span>
          </div>
          <p
            className="backup-status"
            title="An export date records the download request. Check that the file was saved."
          >
            Last backup export:{' '}
            {backupStatus.lastExportAt
              ? new Date(backupStatus.lastExportAt).toLocaleDateString()
              : 'Never'}
          </p>
          <div className="sidebar-actions">
            <button onClick={backup} title="Export backup">
              <Download size={16} />
              Backup
            </button>
            <button onClick={() => restoreRef.current?.click()}>
              <Upload size={16} />
              Restore
            </button>
          </div>
          <button className="nav-item" onClick={() => setModal('settings')}>
            <Settings2 size={17} />
            Preferences
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workbench <ChevronRight size={14} />
            <span>{p?.name || 'Workspace'}</span>
          </div>
          <div className="top-status">
            <span className={'status-dot ' + (!online ? 'offline' : '')} />
            {online ? 'Internet available' : 'Offline · cached data'}
            <span className="top-rule" />
            TRACE v{APP_VERSION} · Local
          </div>
        </header>
        <main>
          {backupDue(w.projects.length > 0 || w.inventory.length > 0, backupStatus, Date.now()) && (
            <div className="notice backup-reminder">
              <strong>
                {backupStatus.lastExportAt
                  ? 'Time for a workspace backup'
                  : 'Keep a backup outside this browser'}
              </strong>
              <p>
                Export a JSON backup before clearing browser data, changing browser or updating
                TRACE.
              </p>
              <button onClick={backup}>Export backup</button>
              <button
                onClick={() =>
                  updateBackupStatus({ ...backupStatus, snoozedUntil: Date.now() + 86400000 })
                }
              >
                Remind me tomorrow
              </button>
            </div>
          )}
          {loadError && (
            <div className="notice danger">
              <strong>{loadError}</strong>
              <p>
                Automatic saving is disabled to protect the existing data. Export recovery data,
                then restore a valid backup.
              </p>
              <button onClick={recover}>Export raw recovery data</button>
              <button onClick={() => restoreRef.current?.click()}>Restore backup</button>
            </div>
          )}
          {saveError && (
            <div className="notice danger">
              {saveError}
              <button onClick={backup}>Export backup</button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice dismissible">
              <span>{notice}</span>
              <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>
                {['demand', 'inventory', 'activity'].includes(view)
                  ? activeViewTitle
                  : p?.name || 'Your next board starts here.'}
              </h1>
              <p>
                {['demand', 'inventory', 'activity'].includes(view)
                  ? 'A clear view across your local projects.'
                  : p?.description || 'Follow your components from schematic to assembly.'}
              </p>
            </div>
            <div className="actions">
              {p && !['demand', 'inventory', 'activity'].includes(view) && (
                <>
                  <button
                    onClick={() => {
                      setEditingProject(true);
                      setName(p.name);
                      setDescription(p.description);
                      setModal('project');
                    }}
                  >
                    Edit project
                  </button>
                  <button
                    className="icon-button danger-text"
                    title="Delete project"
                    aria-label="Delete project"
                    onClick={() => deleteProject(p)}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !online || !!loadError}
                    onClick={() =>
                      refresh(rows.flatMap((r) => [r.code, ...r.alternatives.map((a) => a.code)]))
                    }
                  >
                    <RefreshCw size={16} className={busy ? 'spin' : ''} />
                    {busy ? 'Refreshing…' : 'Refresh parts'}
                  </button>
                </>
              )}
            </div>
          </div>
          {p && calc && !['demand', 'inventory', 'activity'].includes(view) && (
            <>
              {calc.eligibility.status === 'ineligible' && (
                <div className="notice danger">
                  <strong>
                    {b!.mode === 'economic'
                      ? 'Economic assembly is incompatible with this BOM or board configuration.'
                      : 'Assembly configuration needs correction.'}
                  </strong>
                  <p>
                    {calc.eligibility.reasons
                      .filter(
                        (reason) =>
                          reason.includes('Standard-only') || reason.includes('requires Standard'),
                      )
                      .slice(0, 3)
                      .join(' · ')}
                  </p>
                  {b!.mode === 'economic' && (
                    <button
                      onClick={() =>
                        updateProject({
                          ...p,
                          workingBuild: { ...b!, mode: 'standard', boardReviewed: false },
                        })
                      }
                    >
                      Switch this build to Standard
                    </button>
                  )}
                </div>
              )}
              <div className="metrics">
                <div className="metric">
                  <span>
                    ASSEMBLY QTY <LayoutGrid size={16} />
                  </span>
                  <strong>
                    {count(boardCount(b!))}
                    <small> in this run</small>
                  </strong>
                  <div className="presets">
                    {[2, 3, 4, 5, 10, 25, 50, 100].map((n) => (
                      <button
                        key={n}
                        className={b!.quantity === n ? 'active' : ''}
                        aria-label={'Assemble ' + n}
                        aria-pressed={b!.quantity === n}
                        onClick={() =>
                          updateProject({
                            ...p,
                            workingBuild: { ...b!, quantity: n, boardReviewed: false },
                          })
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <AssemblyQuantity
                    label="Custom quantity"
                    value={b!.quantity}
                    compact
                    onChange={(quantity) =>
                      updateProject({
                        ...p,
                        workingBuild: { ...b!, quantity, boardReviewed: false },
                      })
                    }
                  />
                </div>
                <div className="metric">
                  <span>
                    OBSERVED CAPACITY <Cpu size={16} />
                  </span>
                  <strong>
                    {count(calc.capacity)}
                    <small> boards</small>
                  </strong>
                  <p>
                    {calc.needsRefresh
                      ? 'Cached / unknown · refresh needed'
                      : calc.provisional
                        ? 'Snapshot · verify attrition'
                        : 'Snapshot · configured requirements'}
                  </p>
                </div>
                <div className={'metric ' + (calc.shortages ? 'metric-alert' : '')}>
                  <span>
                    BUILD BLOCKERS <AlertTriangle size={16} />
                  </span>
                  <strong>
                    {calc.shortages}
                    <small> shortages</small>
                  </strong>
                  <p>
                    {calc.unknown} unknown stock · {rows.filter((r) => r.issues.length).length} BOM
                    rows to review ·{' '}
                    {
                      rows.filter(
                        (r) =>
                          r.population === 'jlc' &&
                          identityWarnings(r, w.observations[r.code]).length > 0,
                      ).length
                    }{' '}
                    identity checks
                  </p>
                </div>
                <div className="metric">
                  <span>
                    {b!.mode.toUpperCase()} ESTIMATE <SlidersHorizontal size={16} />
                  </span>
                  <strong>
                    {calc.eligibility.status === 'ineligible'
                      ? 'Review service'
                      : money(calc.total)}
                  </strong>
                  <p>
                    {b!.costScope === 'selected' ? 'Quote selections' : 'Full BOM budget'} ·{' '}
                    {calc.costLines.length}/{calc.lines.length} types
                    {calc.eligibility.status !== 'ineligible' && (
                      <> · {money(calc.perBoard)} / board</>
                    )}
                    {' · '}
                    {calc.exclusions.length} assumptions / exclusions
                  </p>
                </div>
              </div>
              {refreshReport && (
                <RefreshSummary
                  key={refreshReport.id}
                  report={refreshReport}
                  projectId={p.id}
                  onPart={(code) => {
                    const row = rows.find((r) => r.code === code);
                    if (row && !b?.revisionId) setDetailId(row.id);
                    else {
                      setView('bom');
                      setSearch(code);
                    }
                  }}
                />
              )}
              <details className="capacity-strip">
                <summary>Stock bottlenecks</summary>
                <div>
                  {calc.lines
                    .filter((l) => l.capacity !== null)
                    .sort((a, b) => a.capacity! - b.capacity!)
                    .slice(0, 2)
                    .map((l, i) => (
                      <span key={l.code}>
                        <strong>
                          {i === 0 ? 'Limiting: ' : 'Next: '}
                          {l.code}
                        </strong>{' '}
                        · {count(l.capacity)} boards · {l.refs.join(', ')}
                      </span>
                    ))}
                  {calc.unknown > 0 && (
                    <span className="amber">
                      Unknown rows prevent complete capacity verification.
                    </span>
                  )}
                </div>
              </details>
              <div className="tabs">
                {(
                  [
                    ['bom', 'Components'],
                    ['build', 'Build & cost'],
                    ['scenarios', 'Scenarios'],
                    ['revisions', 'Revisions'],
                  ] as [View, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={view === key ? 'active' : ''}
                    onClick={() => setView(key)}
                  >
                    {label}
                    {key === 'bom' && <span>{rows.length}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {view === 'demand' ? (
            <DemandPanel w={w} />
          ) : view === 'inventory' ? (
            <InventoryPanel w={w} onChange={setW} />
          ) : view === 'activity' ? (
            <section className="panel">
              <span className="eyebrow">CHANGES THAT MATTER</span>
              <h2>Local activity</h2>
              <p className="muted">
                Events are recorded while the app is open. No remote notifications are sent.
              </p>
              {w.events.length ? (
                w.events.map((e) => (
                  <div className="event" key={e.id}>
                    <Activity size={16} />
                    <div>
                      {e.message}
                      <small>{when(e.date)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="Quiet for now">
                  Stock transitions, shortages, library changes and refresh failures will appear
                  here.
                </Empty>
              )}
            </section>
          ) : !p ? (
            <section className="welcome panel">
              <div className="circuit-art">
                <Cpu size={72} />
              </div>
              <span className="eyebrow">FROM FIRST PROTOTYPE TO THE NEXT BATCH</span>
              <h2>
                Keep your BOM
                <br />
                in the circuit.
              </h2>
              <p>
                Track availability, catch assembly surprises, and compare your next production run.
                Everything stays on this device.
              </p>
              <button
                className="primary"
                disabled={!!loadError}
                onClick={() => {
                  setEditingProject(false);
                  setName('');
                  setDescription('');
                  setModal('project');
                }}
              >
                <FolderPlus size={18} />
                Create your first project
              </button>
              <button onClick={() => restoreRef.current?.click()}>
                Restore an existing backup
              </button>
              <div className="welcome-features">
                <span>
                  <Cpu />
                  Component availability
                </span>
                <span>
                  <Layers />
                  Revision continuity
                </span>
                <span>
                  <Boxes />
                  Batch planning
                </span>
              </div>
            </section>
          ) : view === 'build' ? (
            <BuildPanel
              project={p}
              w={w}
              onChange={(b) => updateProject({ ...p, workingBuild: b })}
            />
          ) : view === 'scenarios' ? (
            <ScenariosPanel p={p} w={w} onChange={updateProject} />
          ) : view === 'revisions' ? (
            <RevisionsPanel p={p} w={w} onChange={updateProject} />
          ) : (
            <section className="panel bom-panel">
              <div className="section-heading">
                <div>
                  <h2>Components</h2>
                </div>
                <div className="actions">
                  <button onClick={() => csvExport(false)} disabled={!rows.length}>
                    <Download size={16} />
                    Analysis CSV
                  </button>
                  <button onClick={() => csvExport(true)} disabled={!rows.length}>
                    JLCPCB BOM
                  </button>
                  <button className="primary" onClick={() => setModal('import')}>
                    <Upload size={16} />
                    Import BOM
                  </button>
                </div>
              </div>
              {b?.revisionId && (
                <p className="notice warning">
                  Viewing a pinned revision. Switch to the working BOM in Build & cost to edit its
                  rows. Importing a BOM returns to the working copy.
                </p>
              )}
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search components"
                    placeholder="Search C-number, model, designator or tag…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <label className="compact-filter">
                  <span>Stock</span>
                  <select
                    aria-label="Stock filter"
                    value={stockFilter}
                    onChange={(e) => setStockFilter(e.target.value)}
                  >
                    <option value="all">All stock</option>
                    <option value="short">Short for this batch</option>
                    <option value="out">Out of stock</option>
                    <option value="covered">Covered for this batch</option>
                    <option value="unknown">Unknown stock</option>
                  </select>
                </label>
                <label className="compact-filter">
                  <span>Library</span>
                  <select
                    aria-label="Library filter"
                    value={libraryFilter}
                    onChange={(e) => setLibraryFilter(e.target.value)}
                  >
                    <option value="all">All libraries</option>
                    <option value="basic">Basic</option>
                    <option value="extended">Extended</option>
                    <option value="preferred">Preferred</option>
                    <option value="unknown">Unknown library</option>
                  </select>
                </label>
                <details className="table-options">
                  <summary>
                    <SlidersHorizontal size={14} /> More options
                  </summary>
                  <div>
                    <Field label="Assembly eligibility">
                      <select
                        aria-label="Assembly eligibility filter"
                        value={serviceFilter}
                        onChange={(e) => setServiceFilter(e.target.value)}
                      >
                        <option value="all">All services</option>
                        <option value="economic">Economic-capable</option>
                        <option value="standard">Standard-only</option>
                        <option value="unknown">Unknown eligibility</option>
                      </select>
                    </Field>
                    <Field label="Population">
                      <select
                        aria-label="Population filter"
                        value={populationFilter}
                        onChange={(e) => setPopulationFilter(e.target.value)}
                      >
                        <option value="all">All BOM rows</option>
                        <option value="jlc">JLCPCB assembly</option>
                        <option value="manual">Manual assembly</option>
                        <option value="dnp">DNP</option>
                      </select>
                    </Field>
                    <Field label="Review">
                      <select
                        aria-label="Review filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All components</option>
                        <option value="attention">Needs attention</option>
                        <option value="critical">Critical parts</option>
                        <option value="identity">Part identity differences</option>
                        <option value="stale">Needs refresh</option>
                        <option value="failed">Lookup failed</option>
                        <option value="issues">BOM issues</option>
                      </select>
                    </Field>
                    <select
                      aria-label="Sort components"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="risk">Sort: attention first</option>
                      <option value="stock">Sort: stock ↑</option>
                      <option value="stock-desc">Sort: stock ↓</option>
                      <option value="capacity">Sort: build capacity ↑</option>
                      <option value="loading">Sort: loading fee ↓</option>
                      <option value="quantity">Sort: demand ↓</option>
                      <option value="price">Sort: tier price ↓</option>
                      <option value="total">Sort: line subtotal ↓</option>
                      <option value="updated">Sort: latest check</option>
                      <option value="code">Sort: C-number</option>
                    </select>
                    <select
                      aria-label="Group components"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                    >
                      <option value="none">No grouping</option>
                      <option value="category">By category</option>
                      <option value="brand">By brand</option>
                      <option value="library">By library</option>
                      <option value="service">By assembly eligibility</option>
                      <option value="tag">By first tag</option>
                    </select>
                  </div>
                </details>
              </div>
              <div className="filter-summary">
                <span>
                  {visible.length} of {rows.length} BOM rows{hasFilters ? ' · filters active' : ''}
                </span>
                {hasFilters && <button onClick={resetFilters}>Clear filters</button>}
                <small>Filters change this list only; build totals cover the full BOM.</small>
              </div>
              {selected.length > 0 && (
                <div className="selection-bar">
                  {selected.length} selected
                  <button
                    onClick={async () => {
                      if (
                        await confirmation.ask('Remove ' + selected.length + ' selected BOM rows?')
                      ) {
                        updateProject({
                          ...p,
                          rows: validateRows(p.rows.filter((r) => !selected.includes(r.id))),
                        });
                        setSelected([]);
                      }
                    }}
                  >
                    Remove selected
                  </button>
                  <button onClick={() => setSelected([])}>Clear selection</button>
                </div>
              )}
              {!rows.length ? (
                <Empty title="Bring your design into the workbench">
                  Import a KiCad, EasyEDA or Altium BOM, or add a component below. Missing parts
                  stay visible until you resolve them.
                </Empty>
              ) : !visible.length ? (
                <Empty title="No matching components">Adjust your search or filter.</Empty>
              ) : (
                <div className="table-scroll">
                  <table className="bom-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            aria-label="Select visible rows"
                            type="checkbox"
                            disabled={!!b?.revisionId}
                            checked={
                              visible.length > 0 && visible.every((r) => selected.includes(r.id))
                            }
                            onChange={(e) =>
                              setSelected(e.target.checked ? visible.map((r) => r.id) : [])
                            }
                          />
                        </th>
                        <th>Component / designators</th>
                        <th>Library / service</th>
                        <th>Qty / BOM</th>
                        <th>Stock / build need</th>
                        <th>Batch coverage</th>
                        <th>Tier price</th>
                        <th>Last check</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {[...groups].map(([groupName, items]) => (
                        <React.Fragment key={groupName}>
                          {group !== 'none' && (
                            <tr className="group-row">
                              <td colSpan={9}>
                                <button
                                  onClick={() =>
                                    setCollapsed((prev) =>
                                      prev.includes(groupName)
                                        ? prev.filter((x) => x !== groupName)
                                        : [...prev, groupName],
                                    )
                                  }
                                >
                                  <ChevronRight
                                    size={14}
                                    className={collapsed.includes(groupName) ? '' : 'rotate'}
                                  />
                                  {groupName} <Badge>{items.length}</Badge>
                                </button>
                              </td>
                            </tr>
                          )}
                          {!collapsed.includes(groupName) &&
                            items.map((r) => {
                              const o = w.observations[r.code],
                                line = calc!.lines.find((l) => l.rows.some((x) => x.id === r.id)),
                                s = status(r);
                              const processing = componentAssembly(r, o);
                              return (
                                <tr key={r.id} className={s.tone === 'bad' ? 'row-short' : ''}>
                                  <td>
                                    <input
                                      aria-label={'Select ' + (r.refs.join(',') || r.code)}
                                      type="checkbox"
                                      disabled={!!b?.revisionId}
                                      checked={selected.includes(r.id)}
                                      onChange={(e) =>
                                        setSelected((prev) =>
                                          e.target.checked
                                            ? [...prev, r.id]
                                            : prev.filter((id) => id !== r.id),
                                        )
                                      }
                                    />
                                  </td>
                                  <td>
                                    <button
                                      className="part-link"
                                      disabled={!!b?.revisionId}
                                      onClick={() => setDetailId(r.id)}
                                    >
                                      <span className="part-icon">
                                        <Cpu size={17} />
                                      </span>
                                      <span>
                                        <strong>
                                          {r.mpn ||
                                            o?.model ||
                                            r.value ||
                                            r.code ||
                                            'Unresolved component'}
                                        </strong>
                                        <small className="mono">
                                          {r.code || 'No C-number'}{' '}
                                          <span>· {r.refs.join(', ') || 'No designators'}</span>
                                        </small>
                                      </span>
                                    </button>
                                    <div
                                      className="part-description"
                                      title={r.description || o?.description || r.value}
                                    >
                                      {r.description ||
                                        o?.description ||
                                        r.value ||
                                        'Description not supplied'}
                                    </div>
                                    <div className="part-meta">
                                      {r.footprint || o?.footprint || 'Footprint unknown'}
                                      {r.tags.length ? ' · ' + r.tags.join(' / ') : ''}
                                      {r.critical ? ' · Critical' : ''}
                                      {r.population === 'jlc' && processing.specialFee > 0 && (
                                        <span className="assembly-tag">
                                          Special {money(processing.specialFee, 3)} / unit
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <Badge
                                      tone={
                                        o?.library === 'basic' || o?.library === 'preferred'
                                          ? 'good'
                                          : 'muted'
                                      }
                                    >
                                      {o?.library || 'unknown'}
                                    </Badge>
                                    <small
                                      className={o?.eligibility === 'standard' ? 'amber' : 'muted'}
                                    >
                                      {standardOnlyPackage(r, o) || o?.eligibility === 'standard'
                                        ? 'Standard only'
                                        : o?.eligibility === 'economic'
                                          ? 'Economic eligible'
                                          : 'Eligibility unknown'}
                                      {line?.process === 'tht' && (
                                        <>
                                          <br />
                                          Through-hole · no feeder fee
                                        </>
                                      )}
                                    </small>
                                  </td>
                                  <td className="mono">{r.qty ?? '?'}</td>
                                  <td className="mono">
                                    {count(line?.stock)}
                                    <small>
                                      / {count(line?.required)} needed
                                      {line && line.rows.length > 1 ? ' (shared)' : ''}
                                    </small>
                                    <small>
                                      {count(line?.placed)} placed ·{' '}
                                      {line?.quantitySource || 'unknown'} rule
                                    </small>
                                  </td>
                                  <td>
                                    <Badge tone={s.tone}>{s.text}</Badge>
                                    {identityWarnings(r, o).length > 0 && (
                                      <button
                                        className="identity-link"
                                        disabled={!!b?.revisionId}
                                        onClick={() => setDetailId(r.id)}
                                      >
                                        Check identity
                                      </button>
                                    )}
                                    {b?.costScope === 'selected' &&
                                      b.excludedCodes?.includes(r.code) && (
                                        <small>Excluded from quote costing</small>
                                      )}
                                    {r.alternatives.some((a) =>
                                      ['approved', 'tested'].includes(a.status),
                                    ) && <small>Approved alternate recorded</small>}
                                  </td>
                                  <td className="mono">{money(line?.unitPrice, 4)}</td>
                                  <td>
                                    <span className={o?.error ? 'amber' : 'muted'}>
                                      {freshness(o, w.settings.staleMinutes)}
                                    </span>
                                    <small>
                                      {o?.updatedAt
                                        ? new Date(o.updatedAt).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })
                                        : 'Not checked'}
                                    </small>
                                  </td>
                                  <td>
                                    <button
                                      className="icon-button"
                                      aria-label={'Refresh ' + r.code}
                                      disabled={busy || !online || !r.code}
                                      onClick={() => refresh([r.code])}
                                    >
                                      <RefreshCw size={15} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="table-footer">
                <form onSubmit={addPart} className="inline-controls">
                  <input
                    aria-label="Add component C-number"
                    placeholder="Add C-number, e.g. C25804"
                    value={code}
                    onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
                  />
                  <button type="submit" disabled={!/^C\d+$/.test(code) || !!b?.revisionId}>
                    <Plus size={16} />
                    Add part
                  </button>
                </form>
                <span>
                  {rows.length} BOM rows · {calc?.lines.length} unique assembly parts
                </span>
              </div>
              <p className="footnote">
                Stock is a supplier snapshot, never a reservation. Shared C-numbers use aggregated
                demand. “Covered” does not verify board eligibility or replace JLCPCB order review.
              </p>
            </section>
          )}
          <footer className="app-footer">
            <span>
              <CircuitBoard size={14} /> TRACE / LOCAL WORKBENCH
            </span>
            <span>{busy ? 'Retrieving supplier observations…' : 'Your design. Your device.'}</span>
          </footer>
        </main>
      </div>
      <input
        type="file"
        ref={restoreRef}
        hidden
        accept=".json"
        onChange={(e) => restoreFile(e.target.files?.[0])}
      />
      {modal === 'project' && (
        <Modal
          title={editingProject ? 'Edit project' : 'New project'}
          onClose={() => setModal(null)}
        >
          <form onSubmit={saveProject}>
            <Field label="Project name">
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                placeholder="ESP32 sensor node"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                placeholder="What are you building?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <footer>
              {editingProject && p && (
                <button type="button" className="danger-text" onClick={() => deleteProject(p)}>
                  <Trash2 size={16} />
                  Delete project
                </button>
              )}
              <button type="submit" className="primary">
                {editingProject ? 'Save changes' : 'Create project'}
                <ArrowUpRight size={16} />
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === 'import' && p && (
        <BomImport rows={p.rows} onImport={importRows} onClose={() => setModal(null)} />
      )}
      {modal === 'settings' && (
        <Settings
          w={w}
          onChange={setW}
          onRecovery={exportUpdateRecovery}
          onClose={() => setModal(null)}
        />
      )}
      {rowDetail && p && (
        <PartDetail
          key={rowDetail.id}
          row={rowDetail}
          bomRows={p.rows}
          w={w}
          build={p.workingBuild}
          onRow={(row) =>
            updateProject({
              ...p,
              rows: validateRows(p.rows.map((r) => (r.id === row.id ? row : r))),
            })
          }
          onObservation={(o) =>
            setW((prev) => ({ ...prev, observations: { ...prev.observations, [o.code]: o } }))
          }
          onBuild={(b) => updateProject({ ...p, workingBuild: b })}
          onRefresh={refresh}
          onClose={() => setDetailId(null)}
        />
      )}
      {restore && (
        <Modal title="Restore local backup" onClose={() => setRestore(null)}>
          <p>
            Validated {restore.projects.length} projects and {restore.inventory.length} inventory
            lots.
          </p>
          <p>
            Merge imports projects as separate copies and keeps your pricing/settings. Inventory
            lots with matching IDs are kept once; imported copies need allocation review. Replace
            restores the entire backup. Existing local data is backed up before either action.
          </p>
          <footer>
            <button onClick={() => applyRestore('merge')}>Merge as copies</button>
            <button className="primary" onClick={() => applyRestore('replace')}>
              Replace workspace
            </button>
          </footer>
        </Modal>
      )}
      {confirmation.dialog}
    </div>
  );
}
