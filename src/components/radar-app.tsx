"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  ArrowUpRight, BriefcaseBusiness, Check, ChevronRight, CircleAlert, Clock3, Database,
  Building2, FileInput, FileText, FolderOpen, LayoutDashboard, LibraryBig, Link2, LoaderCircle, MapPin, PenLine,
  Plus, Radar, RefreshCw, RotateCcw, Rss, Search, Settings2, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APPLICATION_STAGES, type Application, type ApplicationEvent, type ApplicationStage, type CompanyDetail, type CompanyLink, type CrawlRun, type Posting, type PostingIndexItem, type ResumeGenerationJob, type SourceArchiveCoverage, type SourceHealth, type SpreadsheetImportRun, type TrashCompanyPage, type TrashCompanySummary } from "@/lib/types";
import { type PersonalScoreOverrides } from "@/lib/personal-scoring";
import { InternConversionBadge, ScorePanel, ScoreStamp } from "@/components/score-panel";
import { MaterialsWorkspace } from "@/components/materials-workspace";
import { FeedWorkspace } from "@/components/feed-workspace";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { applicationApplyUrl, canAddPostingToApplicationBoard, getDashboardStats, groupByCompany, sortCompanyGroupsByTopPosting, type DashboardStats } from "@/lib/dashboard";
import { formatJobNumber, postingIneligibilityNote } from "@/lib/job-numbering";

type View = "recommended" | "applications" | "materials" | "feed" | "trash" | "links" | "sources" | "settings";
type DetailTab = "jd" | "score" | "resume" | "progress" | "files";
type ScoreScope = "worth" | "all";

const COMPANY_PAGE_SIZE = 60;
const SEARCH_DELAY_MS = 250;

const STAGE_META: Record<ApplicationStage, { label: string; short: string }> = {
  preparing: { label: "准备材料", short: "准备" }, applied: { label: "已投递", short: "投递" },
  written_test: { label: "笔试", short: "笔试" }, interview: { label: "面试", short: "面试" },
  withdrawn: { label: "我方退出 / 拒绝", short: "退出" }, rejected: { label: "已被拒", short: "被拒" }, offer: { label: "Offer", short: "Offer" },
};

const fmt = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function formatTime(value: string | null) { return value ? fmt.format(new Date(value)).replaceAll("/", ".") : "—"; }
function stageLabel(stage: ApplicationStage, round: number | null) { return `${STAGE_META[stage].label}${round ? ` ${round}` : ""}`; }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "操作失败");
  return payload;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "gray" | "red" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function RadarApp() {
  const [view, setView] = useState<View>("recommended");
  const [allPostings, setAllPostings] = useState<PostingIndexItem[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [links, setLinks] = useState<CompanyLink[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<CompanyDetail | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [runs, setRuns] = useState<SpreadsheetImportRun[]>([]);
  const [crawlRun, setCrawlRun] = useState<CrawlRun | null>(null);
  const [archiveCoverage, setArchiveCoverage] = useState<SourceArchiveCoverage | null>(null);
  const [selectedPostingId, setSelectedPostingId] = useState<number | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<Posting | null>(null);
  const [selectedPostingLoading, setSelectedPostingLoading] = useState(false);
  const [selectedPostingError, setSelectedPostingError] = useState("");
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("jd");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [scoreScope, setScoreScope] = useState<ScoreScope>("all");
  const [searchResult, setSearchResult] = useState<{ query: string; postings: PostingIndexItem[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailCache = useRef(new Map<number, Posting>());
  const detailAbortController = useRef<AbortController | null>(null);
  const detailRequestId = useRef(0);
  const searchRequestId = useRef(0);

  const refreshAll = useCallback(async () => {
    const [allPostingData, applicationData, linkData, sourceData, importData, crawlData, coverageData, trashData] = await Promise.all([
      api<{ postings: PostingIndexItem[] }>("/api/postings?view=index&disposition=all"), api<{ applications: Application[] }>("/api/applications"),
      api<{ links: CompanyLink[] }>("/api/company-links"), api<{ sources: SourceHealth[] }>("/api/sources"),
      api<{ runs: SpreadsheetImportRun[] }>("/api/spreadsheet-imports"), api<{ run: CrawlRun | null }>("/api/crawl-runs/latest"),
      api<{ coverage: SourceArchiveCoverage }>("/api/source-archive-coverage"),
      api<{ totalItems: number }>("/api/trash?view=count"),
    ]);
    setAllPostings(allPostingData.postings); setApplications(applicationData.applications); setLinks(linkData.links);
    setSources(sourceData.sources); setRuns(importData.runs); setCrawlRun(crawlData.run);
    setArchiveCoverage(coverageData.coverage);
    setTrashCount(trashData.totalItems);
    setSelectedPostingId((id) => id && allPostingData.postings.some((item) => item.id === id && item.effectiveDisposition.bucket === "active") ? id : null);
    setSelectedApplicationId((id) => id && applicationData.applications.some((item) => item.id === id) ? id : applicationData.applications[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshAll().catch((error) => setMessage(error.message)).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshAll]);
  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(""), 5000); return () => clearTimeout(id); }, [message]);
  useEffect(() => {
    if (!applications.some((application) => application.resumeStatus === "queued" || application.resumeStatus === "generating")) return;
    const timer = window.setInterval(() => { refreshAll().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, [applications, refreshAll]);

  useEffect(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const requestId = ++searchRequestId.current;
    if (!normalized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      api<{ postings: PostingIndexItem[] }>(`/api/postings?view=index&disposition=all&q=${encodeURIComponent(normalized)}`, { signal: controller.signal })
        .then((data) => {
          if (searchRequestId.current === requestId) setSearchResult({ query: normalized, postings: data.postings });
        })
        .catch((error) => {
          if (!isAbortError(error) && searchRequestId.current === requestId) {
            setMessage(error instanceof Error ? error.message : "岗位搜索失败");
          }
        })
        .finally(() => {
          if (searchRequestId.current === requestId) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [allPostings, query]);

  useEffect(() => () => detailAbortController.current?.abort(), []);

  const unprocessedPostings = useMemo(() => allPostings.filter((posting) => posting.effectiveDisposition.bucket === "active"), [allPostings]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchedPostings = useMemo(() => {
    if (!normalizedQuery) return allPostings;
    if (searchResult?.query === normalizedQuery) return searchResult.postings;
    if (searchResult) return searchResult.postings;
    return allPostings.filter((posting) => `${posting.company}\n${posting.title}\n${posting.cities.join(" ")}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [allPostings, normalizedQuery, searchResult]);
  const filteredPostings = useMemo(() => searchedPostings.filter((posting) => {
    const visibleByScore = scoreScope === "all" || posting.scoreRecommendation === "apply";
    return posting.effectiveDisposition.bucket === "active" && visibleByScore && (!role || posting.roleFamily === role);
  }), [role, scoreScope, searchedPostings]);
  const selectedIndexPosting = allPostings.find((item) => item.id === selectedPostingId && item.effectiveDisposition.bucket === "active") ?? null;
  const selectedPostingForView = selectedPosting?.id === selectedPostingId ? selectedPosting : null;
  const selectedApplication = applications.find((item) => item.id === selectedApplicationId) ?? null;
  const managedPostingIds = useMemo(() => new Set(applications.map((item) => item.postingId).filter(Boolean)), [applications]);
  const dashboardStats = useMemo(() => getDashboardStats(allPostings), [allPostings]);

  function updateQuery(value: string) {
    setQuery(value);
    if (!value.trim()) {
      searchRequestId.current += 1;
      setSearching(false);
    }
  }

  function selectPosting(postingId: number) {
    setSelectedPostingId(postingId);
    detailAbortController.current?.abort();
    const requestId = ++detailRequestId.current;
    const cached = detailCache.current.get(postingId);
    if (cached) {
      setSelectedPosting(cached);
      setSelectedPostingLoading(false);
      setSelectedPostingError("");
      return;
    }
    const controller = new AbortController();
    detailAbortController.current = controller;
    setSelectedPosting(null);
    setSelectedPostingLoading(true);
    setSelectedPostingError("");
    api<{ posting: Posting }>(`/api/postings/${postingId}`, { signal: controller.signal })
      .then(({ posting }) => {
        if (detailRequestId.current !== requestId) return;
        detailCache.current.set(postingId, posting);
        setSelectedPosting(posting);
      })
      .catch((error) => {
        if (!isAbortError(error) && detailRequestId.current === requestId) {
          setSelectedPostingError(error instanceof Error ? error.message : "岗位详情读取失败");
        }
      })
      .finally(() => {
        if (detailRequestId.current === requestId) setSelectedPostingLoading(false);
      });
  }

  function clearSelectedPosting() {
    detailRequestId.current += 1;
    detailAbortController.current?.abort();
    setSelectedPostingId(null);
    setSelectedPosting(null);
    setSelectedPostingLoading(false);
    setSelectedPostingError("");
  }

  function retrySelectedPosting() {
    if (!selectedPostingId) return;
    detailCache.current.delete(selectedPostingId);
    selectPosting(selectedPostingId);
  }

  async function addPosting(postingId: number) {
    setBusy(`posting-${postingId}`);
    try {
      const { application } = await api<{ application: Application }>("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postingId }) });
      await refreshAll(); setSelectedApplicationId(application.id); setView("applications"); setMessage(`已建立 ${application.folderName}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "建档失败"); }
    finally { setBusy(""); }
  }

  async function savePostingScore(postingId: number, scoreOverrides: PersonalScoreOverrides) {
    const { posting } = await api<{ posting: Posting }>(`/api/postings/${postingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scoreOverrides }) });
    detailCache.current.set(postingId, posting);
    if (selectedPostingId === postingId) setSelectedPosting(posting);
    await refreshAll();
    setMessage("评分依据已保存，推荐顺序已更新。");
  }

  async function openCompany(companyId: number) {
    setBusy(`company-${companyId}`);
    try {
      const { company } = await api<{ company: CompanyDetail }>(`/api/companies/${companyId}`);
      setSelectedCompany(company);
    } catch (error) { setMessage(error instanceof Error ? error.message : "公司岗位读取失败"); }
    finally { setBusy(""); }
  }

  async function setPostingDisposition(posting: Posting, value: "trash" | null) {
    setBusy(`posting-disposition-${posting.id}`);
    try {
      await api(`/api/postings/${posting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        manualDisposition: value,
        manualDispositionReason: value === "trash" ? "人工审查完成" : null,
      }) });
      detailCache.current.delete(posting.id);
      await refreshAll();
      if (posting.companyId && selectedCompany?.id === posting.companyId) await openCompany(posting.companyId);
      clearSelectedPosting();
      setMessage(value === "trash" ? "岗位已处理并放入垃圾桶，可随时恢复。" : "岗位已恢复到未处理岗位；系统评分仍会保留提示。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "岗位状态更新失败"); }
    finally { setBusy(""); }
  }

  async function setCompanyDisposition(companyId: number, manualDisposition: "trash" | null): Promise<boolean> {
    setBusy(`company-disposition-${companyId}`);
    try {
      const result = await api<{ company: CompanyDetail; updated: number }>(`/api/companies/${companyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manualDisposition }),
      });
      detailCache.current.clear();
      await refreshAll();
      clearSelectedPosting();
      if (selectedCompany?.id === companyId) setSelectedCompany(result.company);
      setMessage(manualDisposition === "trash"
        ? `企业当前 ${result.updated} 个未处理岗位已放入垃圾桶。`
        : `企业 ${result.updated} 个岗位已恢复到未处理岗位。`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "企业处理状态更新失败");
      return false;
    } finally { setBusy(""); }
  }

  async function setCompaniesDisposition(companyIds: number[]): Promise<boolean> {
    setBusy("companies-disposition");
    try {
      const result = await api<{ companiesUpdated: number; postingsUpdated: number }>("/api/companies", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          companyIds,
          manualDisposition: "trash",
        }),
      });
      detailCache.current.clear();
      await refreshAll();
      clearSelectedPosting();
      setMessage(`已批量处理 ${result.companiesUpdated} 家企业、${result.postingsUpdated} 个岗位，可在垃圾桶恢复。`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "企业批量处理失败");
      return false;
    } finally { setBusy(""); }
  }

  async function setApplicationDisposition(application: Application, value: "include" | "trash") {
    setBusy(`application-disposition-${application.id}`);
    try {
      await api(`/api/applications/${application.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        manualDisposition: value,
        manualDispositionReason: value === "trash" ? "主动放弃投递" : "从垃圾桶恢复投递",
      }) });
      await refreshAll();
      setMessage(value === "trash" ? "投递档案已放入垃圾桶，文件、简历和进度均已保留。" : "投递档案已恢复。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "投递状态更新失败"); }
    finally { setBusy(""); }
  }

  async function refreshCompany(companyId: number) {
    setBusy(`company-refresh-${companyId}`);
    try {
      const { company } = await api<{ company: CompanyDetail }>(`/api/companies/${companyId}`, { method: "POST" });
      detailCache.current.clear();
      setSelectedCompany(company); await refreshAll(); setMessage("公司官方岗位与投递规则已刷新。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "公司岗位刷新失败"); }
    finally { setBusy(""); }
  }

  async function importLatest(file?: File) {
    setBusy("import");
    try {
      const init: RequestInit = { method: "POST" };
      if (file) { const form = new FormData(); form.append("file", file); init.body = form; }
      else { init.headers = { "Content-Type": "application/json" }; init.body = "{}"; }
      const { run } = await api<{ run: SpreadsheetImportRun }>("/api/spreadsheet-imports", init);
      detailCache.current.clear();
      await refreshAll(); setMessage(`导入完成：读取 ${run.rowsRead} 行，更新 ${run.postingsImported} 个岗位，新增 ${run.linksImported} 条待选链接。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); }
    finally { setBusy(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <main className="workbench-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><Radar size={22} /></span><div><strong>秋招助手</strong><span>LOCAL CAREER WORKSPACE</span></div></div>
        <nav className="primary-nav" aria-label="主导航">
          <NavButton active={view === "recommended"} onClick={() => setView("recommended")} icon={<Radar size={17} />} label="未处理岗位" count={unprocessedPostings.length} />
          <NavButton active={view === "applications"} onClick={() => setView("applications")} icon={<LayoutDashboard size={17} />} label="投递看板" count={applications.length} />
          <NavButton active={view === "materials"} onClick={() => setView("materials")} icon={<LibraryBig size={17} />} label="我的素材" />
          <NavButton active={view === "feed"} onClick={() => setView("feed")} icon={<Rss size={17} />} label="岗位订阅" />
          <NavButton active={view === "trash"} onClick={() => setView("trash")} icon={<Trash2 size={17} />} label="垃圾桶" count={trashCount} />
          <NavButton active={view === "links"} onClick={() => setView("links")} icon={<Link2 size={17} />} label="待手动选岗" count={links.filter((item) => item.status === "pending").length} />
          <NavButton active={view === "sources"} onClick={() => setView("sources")} icon={<Database size={17} />} label="来源与导入" />
          <NavButton active={view === "settings"} onClick={() => setView("settings")} icon={<Settings2 size={17} />} label="设置" />
        </nav>
        <button className="button button-primary" onClick={() => setManualOpen(true)}><Plus size={17} />手动新增岗位</button>
      </header>

      {loading ? <div className="loading-state"><LoaderCircle className="spin" />正在载入岗位档案…</div> : (
        <>
          {view === "recommended" && <RecommendedView postings={filteredPostings} unprocessedPostings={unprocessedPostings} stats={dashboardStats} selected={selectedPostingForView} selectedIndex={selectedIndexPosting} selectedId={selectedPostingId} detailLoading={selectedPostingLoading} detailError={selectedPostingError} retryDetail={retrySelectedPosting} searching={searching} setSelected={selectPosting} openCompany={openCompany} query={query} setQuery={updateQuery} role={role} setRole={setRole} scoreScope={scoreScope} setScoreScope={setScoreScope} processCompany={(companyId) => setCompanyDisposition(companyId, "trash")} processCompanies={setCompaniesDisposition} managed={managedPostingIds} addPosting={addPosting} processPosting={(posting) => setPostingDisposition(posting, "trash")} saveScore={savePostingScore} busy={busy} />}
          {view === "applications" && <ApplicationsView applications={applications} selected={selectedApplication} setSelected={setSelectedApplicationId} tab={detailTab} setTab={setDetailTab} refresh={refreshAll} abandonApplication={(application) => setApplicationDisposition(application, "trash")} setMessage={setMessage} setBusy={setBusy} busy={busy} />}
          {view === "materials" && <MaterialsWorkspace />}
          {view === "feed" && <FeedWorkspace onSynced={refreshAll} />}
          {view === "trash" && <TrashView key={trashCount} totalItems={trashCount} restorePosting={(posting) => setPostingDisposition(posting, null)} restoreCompany={(companyId) => setCompanyDisposition(companyId, null)} restoreApplication={(application) => setApplicationDisposition(application, "include")} openCompany={openCompany} setMessage={setMessage} busy={busy} />}
          {view === "links" && <LinksView links={links} refresh={refreshAll} setMessage={setMessage} openCompany={openCompany} />}
          {view === "sources" && <SourcesView sources={sources} runs={runs} crawlRun={crawlRun} coverage={archiveCoverage} importLatest={importLatest} busy={busy} fileRef={fileRef} />}
          {view === "settings" && <SettingsWorkspace onSaved={refreshAll} />}
        </>
      )}
      <ManualDialog open={manualOpen} setOpen={setManualOpen} onCreated={async (application) => { await refreshAll(); setSelectedApplicationId(application.id); setView("applications"); setMessage(`岗位已建档：${application.folderName}`); }} />
      <CompanyDialog company={selectedCompany} close={() => setSelectedCompany(null)} refreshCompany={refreshCompany} restorePosting={(posting) => setPostingDisposition(posting, null)} processPosting={(posting) => setPostingDisposition(posting, "trash")} busy={busy} />
      <div className={clsx("toast", message && "toast-visible")} role="status" aria-live="polite">{message}</div>
    </main>
  );
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return <button className={clsx("nav-button", active && "nav-button-active")} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button>;
}

function RecommendedView({ postings, unprocessedPostings, stats, selected, selectedIndex, selectedId, detailLoading, detailError, retryDetail, searching, setSelected, openCompany, query, setQuery, role, setRole, scoreScope, setScoreScope, processCompany, processCompanies, managed, addPosting, processPosting, saveScore, busy }: {
  postings: PostingIndexItem[]; unprocessedPostings: PostingIndexItem[]; stats: DashboardStats; selected: Posting | null; selectedIndex: PostingIndexItem | null; selectedId: number | null; detailLoading: boolean; detailError: string; retryDetail: () => void; searching: boolean; setSelected: (id: number) => void; openCompany: (id: number) => void; query: string; setQuery: (v: string) => void; role: string; setRole: (v: string) => void;
  scoreScope: ScoreScope; setScoreScope: (value: ScoreScope) => void; processCompany: (companyId: number) => Promise<boolean>;
  processCompanies: (companyIds: number[]) => Promise<boolean>;
  managed: Set<number | null>; addPosting: (id: number) => void; processPosting: (posting: Posting) => void; saveScore: (id: number, overrides: PersonalScoreOverrides) => Promise<void>; busy: string;
}) {
  const paginationContext = `${query}\u0000${role}\u0000${scoreScope}`;
  const [expandedState, setExpandedState] = useState<{ context: string; key: string } | null>(null);
  const [pagination, setPagination] = useState({ context: paginationContext, count: COMPANY_PAGE_SIZE });
  const expandedCompany = expandedState?.context === paginationContext ? expandedState.key : null;
  const visibleCompanyCount = pagination.context === paginationContext ? pagination.count : COMPANY_PAGE_SIZE;
  const completeGroups = useMemo(() => new Map(groupByCompany(unprocessedPostings).map((group) => [group.key, group])), [unprocessedPostings]);
  const groups = useMemo(() => sortCompanyGroupsByTopPosting(groupByCompany(postings))
    .map((group) => completeGroups.get(group.key) ?? group), [completeGroups, postings]);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCompanyCount), [groups, visibleCompanyCount]);
  const visibleCompanyIds = useMemo(() => visibleGroups
    .map((group) => group.companyId)
    .filter((companyId): companyId is number => companyId !== null), [visibleGroups]);
  const [selection, setSelection] = useState<{ context: string; ids: Set<number> }>({ context: paginationContext, ids: new Set() });
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectedCompanyIds = selection.context === paginationContext ? selection.ids : new Set<number>();
  const allVisibleSelected = visibleCompanyIds.length > 0 && visibleCompanyIds.every((id) => selectedCompanyIds.has(id));
  const someVisibleSelected = visibleCompanyIds.some((id) => selectedCompanyIds.has(id));
  const selectedCanBeManaged = selected ? canAddPostingToApplicationBoard(selected) : false;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [allVisibleSelected, someVisibleSelected]);

  function updateSelectedCompanies(updater: (ids: Set<number>) => Set<number>) {
    setSelection((current) => ({
      context: paginationContext,
      ids: updater(current.context === paginationContext ? new Set(current.ids) : new Set()),
    }));
  }

  function toggleCompany(companyId: number, checked: boolean) {
    updateSelectedCompanies((ids) => {
      if (checked) ids.add(companyId); else ids.delete(companyId);
      return ids;
    });
  }

  function toggleAllVisible(checked: boolean) {
    updateSelectedCompanies((ids) => {
      for (const companyId of visibleCompanyIds) {
        if (checked) ids.add(companyId); else ids.delete(companyId);
      }
      return ids;
    });
  }

  return <section className="page-stack">
    <div className="page-heading">
      <div><span className="eyebrow">UNPROCESSED COMPANY JOBS</span><h1>未处理岗位</h1><p>所有岗位先按企业归档并人工审查，处理完成后再放入垃圾桶。</p></div>
      <DashboardStatsBar stats={stats} />
    </div>
    <div className="filterbar"><label className="searchbox"><Search size={17} /><input aria-label="搜索岗位" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、岗位或 JD" /></label><label className="searchbox"><BriefcaseBusiness size={17} /><input aria-label="岗位方向" value={role} onChange={(event) => setRole(event.target.value)} placeholder="筛选岗位方向" /></label><select aria-label="投递线筛选" value={scoreScope} onChange={(event) => setScoreScope(event.target.value as ScoreScope)}><option value="all">全部未处理岗位</option><option value="worth">符合我的偏好</option></select>{searching && <span className="filter-status" role="status"><LoaderCircle className="spin" size={14} />正在搜索完整 JD…</span>}</div>
    <div className="company-bulk-toolbar">
      <label className="bulk-select-all"><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} disabled={visibleCompanyIds.length === 0 || busy === "companies-disposition"} aria-label={`全选当前已展示的 ${visibleCompanyIds.length} 家企业`} onChange={(event) => toggleAllVisible(event.target.checked)} /><span>全选当前已展示</span></label>
      <div className="bulk-selection-status" role="status" aria-label="企业批量选择状态" aria-live="polite"><strong>已选 {selectedCompanyIds.size} 家企业</strong><span>仅作用于当前筛选与已展示范围</span></div>
      {selectedCompanyIds.size > 0 && <button className="text-button" disabled={busy === "companies-disposition"} onClick={() => setSelection({ context: paginationContext, ids: new Set() })}>清空选择</button>}
      <button className="button button-danger bulk-trash-button" disabled={selectedCompanyIds.size === 0 || busy === "companies-disposition"} aria-label={`将已选 ${selectedCompanyIds.size} 家企业放入垃圾桶`} onClick={() => setBatchDialogOpen(true)}>{busy === "companies-disposition" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}批量放入垃圾桶</button>
    </div>
    <div className="master-detail">
      <div className="company-list-column"><div className="company-group-list" role="list">
        {visibleGroups.map((group, index) => {
          const expanded = expandedCompany === group.key;
          const panelId = `company-jobs-${group.companyId ?? index}`;
          const completeJds = group.records.filter((posting) => posting.jdParseStatus === "parsed").length;
          const pendingJobs = group.records.filter((posting) => posting.verificationStatus !== "verified").length;
          const worthwhileJobs = group.records.filter((posting) => posting.scoreRecommendation === "apply").length;
          return <section className={clsx("company-job-group", selectedCompanyIds.has(group.companyId ?? -1) && "company-job-group-selected", expanded && "company-job-group-expanded")} role="listitem" key={group.key}>
            <div className="company-disposition-row">{group.companyId && <label className="company-select-control"><input type="checkbox" checked={selectedCompanyIds.has(group.companyId)} disabled={busy === "companies-disposition"} aria-label={`选择企业${group.company}`} onChange={(event) => toggleCompany(group.companyId!, event.target.checked)} /><span aria-hidden /></label>}<button className="company-group-header company-group-header-disposition company-group-header-selectable" aria-label={group.company} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpandedState(expanded ? null : { context: paginationContext, key: group.key })}>
              <span><Building2 size={18} />{group.companyId && <span className="company-number">企业 {group.companyId}</span>}<strong>{group.company}</strong></span>
              <span className="company-group-tail"><span className="company-group-metric">值得投 <b>{worthwhileJobs}</b><i>/</i>岗位 <b>{group.records.length}</b></span><ChevronRight className="company-group-chevron" size={18} aria-hidden /></span>
            </button>{group.companyId && <button className="company-disposition-action" disabled={busy === `company-disposition-${group.companyId}`} aria-label={`将${group.company}放入垃圾桶`} onClick={async () => { if (await processCompany(group.companyId!)) setExpandedState(null); }}>{busy === `company-disposition-${group.companyId}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}放入垃圾桶</button>}</div>
            {expanded && <div className="company-group-body" id={panelId} role="region" aria-label={`${group.company}岗位`}>
              <div className="company-group-summary">
                <span>未处理 {group.records.length} 个岗位 · 完整 JD {completeJds} 个{pendingJobs ? ` · 待查验 ${pendingJobs} 个` : ""}</span>
                {group.companyId && <button className="text-button" onClick={() => openCompany(group.companyId!)}>查看企业档案 <ArrowUpRight size={14} /></button>}
              </div>
              <div className="record-list" role="list">{group.records.map((posting) => {
                const dispositionLabel = posting.scoreRecommendation === "apply" ? "值得投"
                  : posting.scoreRecommendation === "ineligible" ? "不符合条件" : "低于投递线";
                const dispositionTone = posting.scoreRecommendation === "apply" ? "green"
                  : posting.scoreRecommendation === "ineligible" ? "red" : "amber";
                return <div role="listitem" className="record-list-item" key={posting.id}><button className={clsx("record-card", selectedId === posting.id && "record-card-selected")} onClick={() => setSelected(posting.id)}>
                    <ScoreStamp job={posting} />
                    <div className="record-copy"><span className="record-company"><span className="job-number">{formatJobNumber(posting)}</span>{posting.jdParseStatus === "parsed" ? "完整 JD" : "JD 待补全"}</span><strong>{posting.title}</strong><span><MapPin size={13} />{posting.cities.join(" / ") || "城市待核验"} · 上岸 {posting.landingProbability}%</span>{posting.ineligibilityNote && <span className="record-exclusion">{posting.ineligibilityNote}</span>}</div>
                    <div className="record-badges"><Badge tone={dispositionTone}>{dispositionLabel}</Badge><Badge tone="gray">{posting.roleFamily}</Badge><InternConversionBadge job={posting} /></div>
                    <ChevronRight size={18} />
                  </button></div>;
              })}</div>
            </div>}
          </section>;
        })}
        {postings.length === 0 && <Empty title="暂无未处理企业" text="调整岗位方向、投递线或搜索条件；人工处理完成的岗位可在垃圾桶中恢复。" />}
      </div>{groups.length > 0 && <div className="company-list-footer" role="status"><span>已展示 {visibleGroups.length} / 共 {groups.length} 家企业</span>{visibleGroups.length < groups.length && <button className="button button-secondary" onClick={() => setPagination({ context: paginationContext, count: visibleCompanyCount + COMPANY_PAGE_SIZE })}>显示更多</button>}</div>}</div>
      <aside className="detail-panel sticky-panel">{selected ? <>
        <div className="detail-kicker">岗位编号 · {formatJobNumber(selected)}</div><h2>{selected.title}</h2>
        <button className="company-open-button" disabled={!selected.companyId} onClick={() => selected.companyId && openCompany(selected.companyId)}><Building2 size={15} />{selected.company}<span>查看完整企业档案</span><ChevronRight size={15} /></button>
        {selected.effectiveDisposition.manuallyRestored && <div className="notice notice-amber"><RotateCcw size={16} />系统判定不符合｜已人工恢复</div>}
        <div className="badge-row"><Badge>{selected.roleFamily}</Badge><Badge tone="gray">{selected.cohort || "届别待核验"}</Badge><Badge tone="green">{selected.cities.join("、") || "城市待核验"}</Badge><Badge tone={selected.jdParseStatus === "parsed" ? "green" : selected.jdParseStatus === "failed" ? "red" : "amber"}>{selected.jdParseStatus === "parsed" ? "完整 JD" : selected.jdParseStatus === "partial" ? "部分 JD" : selected.jdParseStatus === "failed" ? "JD 解析失败" : "JD 待解析"}</Badge><InternConversionBadge job={selected} /></div>
        <ScorePanel job={selected} onSave={(overrides) => saveScore(selected.id, overrides)} />
        <div className="detail-actions"><button className="button button-primary" disabled={managed.has(selected.id) || busy === `posting-${selected.id}` || !selectedCanBeManaged} onClick={() => addPosting(selected.id)}>{busy === `posting-${selected.id}` ? <LoaderCircle className="spin" size={17} /> : <BriefcaseBusiness size={17} />}{managed.has(selected.id) ? "已加入投递管理" : !selectedCanBeManaged ? "系统判定不符合" : "加入投递管理"}</button>{selected.applyUrl && <a className="button button-ghost" href={selected.applyUrl} target="_blank" rel="noreferrer">打开投递页<ArrowUpRight size={16} /></a>}<button className="button button-danger" disabled={busy === `posting-disposition-${selected.id}`} onClick={() => processPosting(selected)}><Trash2 size={16} />放入垃圾桶</button></div>
        <InfoGrid posting={selected} /><section className="jd-preview"><h3>岗位 JD</h3><pre>{selected.jdText || "暂无完整 JD；投递链接仍已保留，可稍后重试解析或手动补充。"}</pre></section><Coverage items={selected.fitReasons} gaps={selected.gapReasons} />
      </> : selectedIndex ? <div className="detail-loading-state"><div className="detail-kicker">岗位编号 · {formatJobNumber(selectedIndex)}</div><h2>{selectedIndex.title}</h2>{detailError ? <><div className="notice notice-red" role="alert">{detailError}</div><button className="button button-secondary" onClick={retryDetail}><RefreshCw size={15} />重新读取详情</button></> : <div className="loading-state"><LoaderCircle className={detailLoading ? "spin" : undefined} />正在读取完整 JD 与评分依据…</div>}</div> : <Empty title="展开一家企业" text="点击企业名称查看完整岗位集合，再选择具体岗位阅读 JD。" />}</aside>
    </div>
    <Dialog.Root open={batchDialogOpen} onOpenChange={(open) => busy !== "companies-disposition" && setBatchDialogOpen(open)}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content bulk-confirm-dialog" aria-describedby="bulk-trash-description"><div className="dialog-heading"><div><span className="eyebrow">BATCH ARCHIVE</span><Dialog.Title>确认批量放入垃圾桶</Dialog.Title></div><Dialog.Close className="icon-button" aria-label="关闭"><X /></Dialog.Close></div><Dialog.Description id="bulk-trash-description">将当前已选的 <strong>{selectedCompanyIds.size} 家企业</strong>及其全部未处理岗位放入垃圾桶。JD、投递链接和已有资料都会保留，可随时按企业或岗位恢复。</Dialog.Description><div className="dialog-actions"><Dialog.Close asChild><button className="button button-ghost" disabled={busy === "companies-disposition"}>取消</button></Dialog.Close><button className="button button-danger" disabled={busy === "companies-disposition"} onClick={async () => { const success = await processCompanies([...selectedCompanyIds]); if (success) { setSelection({ context: paginationContext, ids: new Set() }); setExpandedState(null); setBatchDialogOpen(false); } }}>{busy === "companies-disposition" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}确认放入垃圾桶</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}

function DashboardStatsBar({ stats }: { stats: DashboardStats }) {
  const items = [
    ["已入库企业", stats.archivedCompanies],
    ["已入库岗位", stats.archivedPostings],
    ["待查验企业", stats.pendingCompanies],
    ["待查验岗位", stats.pendingPostings],
  ] as const;
  return <dl className="dashboard-stats" aria-label="岗位库统计">{items.map(([label, value], index) => <div className={index >= 2 ? "dashboard-stat-pending" : undefined} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function InfoGrid({ posting }: { posting: Posting }) {
  return <dl className="info-grid"><div><dt>发布日期</dt><dd>{formatTime(posting.publishedAt)}</dd></div><div><dt>截止时间</dt><dd>{formatTime(posting.deadlineAt)}</dd></div><div><dt>来源</dt><dd>{posting.sourceName}</dd></div><div><dt>状态</dt><dd>{posting.verificationStatus === "verified" ? "已核验" : "待核验"}</dd></div></dl>;
}

function Coverage({ items, gaps }: { items: string[]; gaps: string[] }) {
  return <div className="coverage-grid"><section><h3><Check size={15} />JD 覆盖项</h3>{items.slice(0, 4).map((item) => <p key={item}>{item}</p>)}</section><section><h3><CircleAlert size={15} />素材缺口</h3>{gaps.length ? gaps.slice(0, 4).map((item) => <p key={item}>{item}</p>) : <p>暂无明确缺口，仍需以完整 JD 为准。</p>}</section></div>;
}

function ApplicationsView({ applications, selected, setSelected, tab, setTab, refresh, abandonApplication, setMessage, setBusy, busy }: { applications: Application[]; selected: Application | null; setSelected: (id: number) => void; tab: DetailTab; setTab: (tab: DetailTab) => void; refresh: () => Promise<void>; abandonApplication: (application: Application) => void; setMessage: (v: string) => void; setBusy: (v: string) => void; busy: string }) {
  return <section className="page-stack"><div className="page-heading"><div><span className="eyebrow">APPLICATION CONTROL</span><h1>投递看板</h1><p>每张卡片都是一个独立岗位档案，序号与根目录文件夹永久绑定。</p></div><div className="heading-stat"><strong>{applications.length}</strong><span>已管理岗位</span></div></div>
    <div className="application-layout"><div className="pipeline">{APPLICATION_STAGES.map((stage) => { const items = applications.filter((item) => item.currentStage === stage); return <section className="stage-row" key={stage}><header><span className={`stage-dot stage-${stage}`} /><strong>{STAGE_META[stage].label}</strong><em>{items.length}</em></header><div className="stage-cards">{items.map((item) => <button key={item.id} className={clsx("application-card", selected?.id === item.id && "application-card-selected")} onClick={() => setSelected(item.id)}><span className="archive-strip">{String(item.sequence).padStart(3, "0")}</span><span className="application-main"><small>{item.company}</small><strong>{item.title}</strong><em>{item.cities.join(" / ") || "城市待补充"}{item.resumeStale ? " · 简历待更新" : ""}</em><InternConversionBadge job={item} /></span><ScoreStamp job={item} /><ChevronRight size={17} /></button>)}{items.length === 0 && <span className="stage-empty">暂无岗位</span>}</div></section>; })}</div>
      <aside className="detail-panel application-sidebar">{selected ? <ApplicationDetail key={`${selected.id}-${selected.updatedAt}`} application={selected} tab={tab} setTab={setTab} refresh={refresh} abandonApplication={abandonApplication} setMessage={setMessage} setBusy={setBusy} busy={busy} /> : <Empty title="还没有投递档案" text="从未处理岗位加入，或点击右上角手动新增岗位。" />}</aside></div>
  </section>;
}

function ApplicationDetail({ application, tab, setTab, refresh, abandonApplication, setMessage, setBusy, busy }: { application: Application; tab: DetailTab; setTab: (tab: DetailTab) => void; refresh: () => Promise<void>; abandonApplication: (application: Application) => void; setMessage: (v: string) => void; setBusy: (v: string) => void; busy: string }) {
  const [jd, setJd] = useState(application.jdText); const [note, setNote] = useState(application.note);
  const [draftText, setDraftText] = useState(application.resumeDraft ? JSON.stringify(application.resumeDraft, null, 2) : "");
  const [feedback, setFeedback] = useState(""); const [eventStage, setEventStage] = useState<ApplicationStage>("applied"); const [round, setRound] = useState(1); const [eventNote, setEventNote] = useState(""); const [editEvent, setEditEvent] = useState<ApplicationEvent | null>(null);
  async function mutate(url: string, body: unknown, method = "POST") { setBusy("application"); try { await api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await refresh(); setMessage("已同步到数据库和岗位文件夹。"); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(""); } }
  async function startJob(kind: "generate" | "rewrite" | "render") {
    setBusy("resume");
    try {
      if (kind === "render") { const parsed = JSON.parse(draftText); await api(`/api/applications/${application.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resumeDraft: parsed }) }); }
      const { job } = await api<{ job: ResumeGenerationJob }>(`/api/applications/${application.id}/resume-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, feedback }) });
      setMessage("简历任务已进入本地队列，可以继续浏览其他岗位。");
      const timer = window.setInterval(async () => { try { const data = await api<{ job: ResumeGenerationJob }>(`/api/resume-jobs/${job.id}`); if (data.job.status === "succeeded" || data.job.status === "failed") { clearInterval(timer); await refresh(); setBusy(""); setMessage(data.job.status === "succeeded" ? "简历已通过单页校验并更新。" : `简历生成失败，旧版已保留：${data.job.error}`); } } catch { clearInterval(timer); setBusy(""); } }, 1800);
    } catch (error) { setBusy(""); setMessage(error instanceof Error ? error.message : "任务创建失败"); }
  }

  const tabs: Array<[DetailTab, string]> = [["jd", "JD"], ["score", "评分"], ["resume", "简历"], ["progress", "进度"], ["files", "文件"]];
  const applyPageUrl = applicationApplyUrl(application);
  return <><div className="archive-title"><span>{String(application.sequence).padStart(3, "0")}</span><div><small>{application.company}</small><h2>{application.title}</h2><p>{stageLabel(application.currentStage, application.currentRound)}</p><InternConversionBadge job={application} /></div><div className="application-title-actions">{applyPageUrl && <a className="button button-ghost" href={applyPageUrl} target="_blank" rel="noreferrer">打开投递页<ArrowUpRight size={15} /></a>}<button className="button button-danger application-abandon" disabled={busy === `application-disposition-${application.id}`} onClick={() => abandonApplication(application)}><Trash2 size={15} />放弃投递</button></div></div><div className="detail-tabs" role="tablist">{tabs.map(([value, label]) => <button role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === "jd" && <div className="tab-content"><label className="field-label">完整岗位 JD<textarea rows={18} value={jd} onChange={(event) => setJd(event.target.value)} /></label><label className="field-label">岗位备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>{application.resumeStale && <div className="notice notice-amber"><CircleAlert size={16} />JD 已变化，当前简历建议重新生成，但 PDF 未被删除。</div>}<button className="button button-primary" disabled={busy === "application"} onClick={() => mutate(`/api/applications/${application.id}`, { jdText: jd, note }, "PATCH")}><Check size={16} />保存 JD 与备注</button></div>}
    {tab === "score" && <div className="tab-content"><ScorePanel job={application} onSave={async (scoreOverrides) => { await api(`/api/applications/${application.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scoreOverrides }) }); await refresh(); setMessage("评分依据已保存，岗位价值已重算。"); }} /></div>}
    {tab === "resume" && <div className="tab-content"><div className="resume-toolbar"><div><span className="status-label">简历状态</span><strong>{({ empty: "尚未生成", queued: "等待生成", generating: "正在生成", ready: "已就绪", failed: "上次生成失败", stale: "建议重新生成" } as const)[application.resumeStatus]}</strong></div><button className="button button-primary" disabled={busy === "resume"} onClick={() => startJob("generate")}><Sparkles size={16} />{application.resumeDraft ? "根据 JD 重新生成" : "自动生成简历"}</button></div>{application.resumeUpdatedAt && <p className="subtle">最近更新 {formatTime(application.resumeUpdatedAt)} · 仅保留岗位文件夹中的最新版 PDF</p>}
      {(application.resumeStatus === "ready" || application.resumeUpdatedAt) && <iframe title={`${application.company}${application.title}简历预览`} className="pdf-preview" src={`/api/applications/${application.id}/resume?v=${encodeURIComponent(application.resumeUpdatedAt ?? "old")}`} />}
      {application.resumeDraft && <details className="draft-editor"><summary><PenLine size={16} />直接微调结构化草稿</summary><p>可修改教育、经历、项目、bullet、技能与主题色（accentHex），保存后将重新渲染并执行单页校验。</p><textarea aria-label="结构化简历草稿" rows={18} value={draftText} onChange={(event) => setDraftText(event.target.value)} /><button className="button button-secondary" onClick={() => startJob("render")}>保存草稿并重新渲染</button></details>}
      <label className="field-label">自然语言微调<textarea rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="例如：突出风险模型项目，把量化实习压缩为两条，保持所有数字可追溯。" /></label><button className="button button-secondary" disabled={!feedback.trim() || busy === "resume" || !application.resumeDraft} onClick={() => startJob("rewrite")}><Sparkles size={16} />按反馈改写</button>
      {application.resumeDraft && <Coverage items={application.resumeDraft.covered} gaps={application.resumeDraft.gaps} />}</div>}
    {tab === "progress" && <div className="tab-content"><div className="event-form"><label>阶段<select value={eventStage} onChange={(event) => setEventStage(event.target.value as ApplicationStage)}>{APPLICATION_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_META[stage].label}</option>)}</select></label>{(eventStage === "written_test" || eventStage === "interview") && <label>轮次<input type="number" min={1} max={20} value={round} onChange={(event) => setRound(Number(event.target.value))} /></label>}<label className="wide">备注<input value={eventNote} onChange={(event) => setEventNote(event.target.value)} placeholder="邮件、时间或结果" /></label><button className="button button-primary" onClick={() => { const body = { stage: eventStage, round, occurredAt: editEvent?.occurredAt, note: eventNote }; mutate(editEvent ? `/api/applications/${application.id}/events/${editEvent.id}` : `/api/applications/${application.id}/events`, body, editEvent ? "PATCH" : "POST"); setEditEvent(null); setEventNote(""); }}>{editEvent ? "保存纠正" : "同步进度"}</button></div><ol className="timeline">{[...application.events].reverse().map((event) => <li key={event.id}><span className={`timeline-dot stage-${event.stage}`} /><div><strong>{stageLabel(event.stage, event.round)}</strong><time>{formatTime(event.occurredAt)}</time><p>{event.note || "无备注"}</p></div><button className="text-button" onClick={() => { setEditEvent(event); setEventStage(event.stage); setRound(event.round ?? 1); setEventNote(event.note); }}>纠正</button></li>)}</ol></div>}
    {tab === "files" && <div className="tab-content"><div className="folder-card"><FolderOpen size={28} /><div><small>岗位专属文件夹</small><strong>{application.folderName}</strong><code>{application.folderPath}</code></div></div><ul className="file-manifest"><li><FileText />JD.txt<span>自动同步</span></li><li><FileText />简历_你的姓名.pdf<span>按个人资料生成</span></li><li><FileText />resume-draft.json<span>有草稿时生成</span></li><li><FileText />投递进度.json<span>完整事件时间线</span></li></ul><div className="button-row"><button className="button button-primary" onClick={() => mutate(`/api/applications/${application.id}/open-folder`, {})}><FolderOpen size={16} />打开岗位文件夹</button><button className="button button-ghost" onClick={() => mutate(`/api/applications/${application.id}/repair`, {})}><RefreshCw size={16} />修复文件夹</button></div></div>}
  </>;
}

function TrashView({ totalItems, restorePosting, restoreCompany, restoreApplication, openCompany, setMessage, busy }: {
  totalItems: number; restorePosting: (posting: Posting) => void; restoreCompany: (companyId: number) => Promise<boolean>; restoreApplication: (application: Application) => void; openCompany: (id: number) => void; setMessage: (message: string) => void; busy: string;
}) {
  const [companies, setCompanies] = useState<TrashCompanySummary[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { postings: Posting[]; applications: Application[] }>>({});
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<TrashCompanyPage>(`/api/trash?view=companies&offset=0&limit=${COMPANY_PAGE_SIZE}`, { signal: controller.signal })
      .then((page) => {
        setCompanies(page.companies);
        setTotalCompanies(page.totalCompanies);
      })
      .catch((error) => {
        if (!isAbortError(error)) setLoadError(error instanceof Error ? error.message : "垃圾桶读取失败");
      })
      .finally(() => setLoadingCompanies(false));
    return () => controller.abort();
  }, []);

  const reason = (posting: Posting) => postingIneligibilityNote(posting)
    || `处理备注：${posting.manualDispositionReason || "人工审查完成"}`;

  async function loadMoreCompanies() {
    setLoadingMore(true);
    try {
      const page = await api<TrashCompanyPage>(`/api/trash?view=companies&offset=${companies.length}&limit=${COMPANY_PAGE_SIZE}`);
      setCompanies((current) => [...current, ...page.companies]);
      setTotalCompanies(page.totalCompanies);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更多垃圾桶企业读取失败");
    } finally { setLoadingMore(false); }
  }

  async function toggleTrashCompany(company: TrashCompanySummary) {
    if (expandedCompany === company.key) {
      setExpandedCompany(null);
      return;
    }
    setExpandedCompany(company.key);
    if (details[company.key]) return;
    setLoadingDetail(company.key);
    try {
      const selector = company.companyId
        ? `companyId=${company.companyId}`
        : `company=${encodeURIComponent(company.company)}`;
      const detail = await api<{ postings: Posting[]; applications: Application[] }>(`/api/trash?view=detail&${selector}`);
      setDetails((current) => ({ ...current, [company.key]: detail }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "企业垃圾桶详情读取失败");
      setExpandedCompany(null);
    } finally { setLoadingDetail(null); }
  }

  return <section className="page-stack"><div className="page-heading"><div><span className="eyebrow">PROCESSED JOB ARCHIVE</span><h1>垃圾桶</h1><p>这里只先载入企业摘要；展开企业时才读取 JD、简历和进度，恢复后会重新进入未处理岗位。</p></div><div className="heading-stat"><strong>{totalItems}</strong><span>项已处理记录</span></div></div>
    {loadError && <div className="notice notice-red" role="alert">{loadError}</div>}
    <div className="trash-company-groups" role="list">{companies.map((company, index) => {
      const expanded = expandedCompany === company.key;
      const detail = details[company.key];
      const panelId = `trash-company-${company.companyId ?? index}`;
      return <section className={clsx("company-job-group", "trash-company-group", expanded && "company-job-group-expanded")} role="listitem" key={company.key}>
        <div className="company-disposition-row"><button className="company-group-header company-group-header-disposition trash-company-header" aria-label={company.company} aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleTrashCompany(company)}><span><Building2 size={18} />{company.companyId && <span className="company-number">企业 {company.companyId}</span>}<strong>{company.company}</strong></span><span className="company-group-tail"><span className="company-group-metric">岗位 <b>{company.postingCount}</b><i>/</i>档案 <b>{company.applicationCount}</b></span><ChevronRight className="company-group-chevron" size={18} aria-hidden /></span></button>{company.companyId && company.postingCount > 0 && <button className="company-disposition-action" disabled={busy === `company-disposition-${company.companyId}`} aria-label={`恢复${company.company}全部岗位到未处理`} onClick={async () => { if (await restoreCompany(company.companyId!)) setExpandedCompany(null); }}>{busy === `company-disposition-${company.companyId}` ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}恢复企业岗位</button>}</div>
        {expanded && <div className="company-group-body" id={panelId} role="region" aria-label={`${company.company}垃圾桶记录`}>
          <div className="company-group-summary"><span>{company.postingCount} 个岗位线索 · {company.applicationCount} 个投递档案</span>{company.companyId && <button className="text-button" onClick={() => openCompany(company.companyId!)}>查看企业档案 <ArrowUpRight size={14} /></button>}</div>
          {loadingDetail === company.key && <div className="loading-state"><LoaderCircle className="spin" />正在读取这家企业的已处理资料…</div>}
          {detail?.postings.length ? <section className="trash-subsection"><header><h2>已处理岗位</h2><span>{detail.postings.length} JOBS</span></header><div className="trash-list">{detail.postings.map((posting) => <article key={posting.id}><div className="trash-marker trash-marker-job">{formatJobNumber(posting)}</div><div><strong>{posting.title}</strong><p className={postingIneligibilityNote(posting) ? "trash-reason" : undefined}>{reason(posting)}</p><div className="badge-row"><Badge tone={posting.jdParseStatus === "parsed" ? "green" : "amber"}>{posting.jdParseStatus === "parsed" ? "完整 JD" : "JD 可重试"}</Badge><Badge tone="gray">人工已处理</Badge></div></div><div className="button-stack"><button className="button button-secondary" disabled={busy === `posting-disposition-${posting.id}`} onClick={() => restorePosting(posting)}><RotateCcw size={15} />恢复到未处理</button>{posting.applyUrl && <a className="button button-ghost" href={posting.applyUrl} target="_blank" rel="noreferrer">保留的投递链接<ArrowUpRight size={14} /></a>}</div></article>)}</div></section> : null}
          {detail?.applications.length ? <section className="trash-subsection"><header><h2>投递档案</h2><span>{detail.applications.length} FILES</span></header><div className="trash-list">{detail.applications.map((application) => <article key={application.id}><div className="trash-marker trash-marker-file">{String(application.sequence).padStart(3, "0")}</div><div><strong>{application.title}</strong><p>{application.manualDispositionReason || "已放弃投递"} · 文件、简历与 {application.events.length} 条进度事件均保留</p></div><button className="button button-secondary" disabled={busy === `application-disposition-${application.id}`} onClick={() => restoreApplication(application)}><RotateCcw size={15} />恢复投递档案</button></article>)}</div></section> : null}
        </div>}
      </section>;
    })}{loadingCompanies && <div className="loading-state"><LoaderCircle className="spin" />正在读取垃圾桶企业摘要…</div>}{!loadingCompanies && companies.length === 0 && <Empty title="垃圾桶为空" text="人工处理完成的岗位和放弃的投递档案会按企业归并到这里。" />}</div>
    {companies.length > 0 && <div className="company-list-footer" role="status"><span>已展示 {companies.length} / 共 {totalCompanies} 家企业</span>{companies.length < totalCompanies && <button className="button button-secondary" disabled={loadingMore} onClick={loadMoreCompanies}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : null}显示更多</button>}</div>}
  </section>;
}

function CompanyDialog({ company, close, refreshCompany, restorePosting, processPosting, busy }: {
  company: CompanyDetail | null; close: () => void; refreshCompany: (id: number) => void; restorePosting: (posting: Posting) => void; processPosting: (posting: Posting) => void; busy: string;
}) {
  const rule = company?.applicationRule;
  const ruleLabel = !rule || rule.extractionStatus === "needs_review" ? "投递上限待核验"
    : rule.extractionStatus === "not_stated" ? "官方未说明"
      : rule.maxApplications === null ? "官方未说明" : `最多投递 ${rule.maxApplications} 个岗位`;
  return <Dialog.Root open={Boolean(company)} onOpenChange={(open) => !open && close()}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content company-dialog">{company && <><div className="dialog-heading"><div><span className="eyebrow">企业编号 {company.id} · COMPANY JOB FILE</span><Dialog.Title>{company.canonicalName}</Dialog.Title><Dialog.Description>共收录 {company.totalJobs} 个岗位：未处理 {company.unprocessedJobs} 个，已处理 {company.trashJobs} 个。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭"><X /></Dialog.Close></div>
      <section className="application-rule-card"><div><span>官方投递规则</span><strong>{ruleLabel}</strong><p>{rule?.ruleText || "尚未完成官方招聘要求核验。"}</p></div>{rule?.sourceUrl && <a href={rule.sourceUrl} target="_blank" rel="noreferrer">查看官方依据<ArrowUpRight size={15} /></a>}<button className="button button-ghost" disabled={busy === `company-refresh-${company.id}`} onClick={() => refreshCompany(company.id)}>{busy === `company-refresh-${company.id}` ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}刷新官方岗位</button></section>
      <div className="company-job-table">{company.postings.map((posting) => <article key={posting.id} className={posting.effectiveDisposition.bucket === "trash" ? "company-job-trash" : ""}><div><div className="badge-row"><span className="job-number">{formatJobNumber(posting)}</span><Badge tone={posting.effectiveDisposition.bucket === "active" ? "blue" : "gray"}>{posting.effectiveDisposition.bucket === "active" ? "未处理" : "已处理"}</Badge><Badge tone={posting.jdParseStatus === "parsed" ? "green" : "amber"}>{posting.jdParseStatus === "parsed" ? "完整 JD" : "JD 未完整"}</Badge></div><strong>{posting.title}</strong><p>{posting.cities.join(" / ") || "城市待核验"} · {posting.roleFamily}</p>{(postingIneligibilityNote(posting) || posting.effectiveDisposition.bucket === "trash") && <small>{postingIneligibilityNote(posting) || posting.manualDispositionReason || "人工审查完成"}</small>}</div><div className="button-stack">{posting.effectiveDisposition.bucket === "trash" ? <button className="button button-secondary" onClick={() => restorePosting(posting)}><RotateCcw size={14} />恢复到未处理</button> : <button className="button button-danger" onClick={() => processPosting(posting)}><Trash2 size={14} />放入垃圾桶</button>}{posting.applyUrl && <a className="text-button" href={posting.applyUrl} target="_blank" rel="noreferrer">投递链接 ↗</a>}</div></article>)}</div>
      <div className="company-source-strip"><span>已保留 {company.sources.length} 条招聘 / JD / 投递来源</span>{company.sources.slice(0, 6).map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.label || source.sourceKind}</a>)}</div></>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function LinksView({ links, refresh, setMessage, openCompany }: { links: CompanyLink[]; refresh: () => Promise<void>; setMessage: (v: string) => void; openCompany: (id: number) => void }) {
  async function status(id: number, value: CompanyLink["status"]) { try { await api(`/api/company-links/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: value }) }); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); } }
  return <section className="page-stack"><div className="page-heading"><div><span className="eyebrow">MANUAL ROLE SELECTION</span><h1>待手动选岗</h1><p>无法解析具体 JD 的入口也永久保留；登录、验证码和访问限制由你手动处理。</p></div><div className="heading-stat"><strong>{links.filter((item) => item.status === "pending").length}</strong><span>条待处理链接</span></div></div><div className="link-grid">{links.map((link) => <article className={clsx("company-link-card", link.status !== "pending" && "company-link-muted")} key={link.id}><div className="link-icon"><Link2 /></div><div><Badge tone={link.status === "pending" ? "amber" : "gray"}>{link.status === "pending" ? "待选岗" : link.status === "resolved" ? "已处理" : "已忽略"}</Badge><button className="link-company-button" disabled={!link.companyId} onClick={() => link.companyId && openCompany(link.companyId)}>{link.company}<ChevronRight size={15} /></button><p>{link.reason}</p><span className="link-url">{link.applyUrl}</span><div className="button-row"><a className="button button-primary" href={link.applyUrl} target="_blank" rel="noreferrer">打开投递页<ArrowUpRight size={16} /></a><button className="button button-ghost" onClick={() => status(link.id, "resolved")}>标记已处理</button><button className="text-button" onClick={() => status(link.id, "ignored")}>忽略</button></div></div></article>)}{links.length === 0 && <Empty title="链接池为空" text="无法拆分具体岗位的招聘入口会自动出现在这里。" />}</div></section>;
}

function SourcesView({ sources, runs, crawlRun, coverage, importLatest, busy, fileRef }: { sources: SourceHealth[]; runs: SpreadsheetImportRun[]; crawlRun: CrawlRun | null; coverage: SourceArchiveCoverage | null; importLatest: (file?: File) => void; busy: string; fileRef: React.RefObject<HTMLInputElement | null> }) {
return <section className="page-stack"><div className="page-heading"><div><span className="eyebrow">SOURCES & INGESTION</span><h1>来源与导入</h1><p>默认读取你在设置中配置的导入目录，也可选择任意兼容的 .xlsx 副本。</p></div></div><div className="import-hero"><div className="import-symbol"><FileInput size={30} /></div><div><span className="eyebrow">YOUR LOCAL SOURCE</span><h2>本机岗位信息工作簿</h2><p>目录和工作表名称可通过环境变量或设置覆盖，不随开源仓库分发。</p></div><div className="button-stack"><button className="button button-primary" disabled={busy === "import"} onClick={() => importLatest()}>{busy === "import" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}导入配置目录中最新表</button><button className="button button-ghost" onClick={() => fileRef.current?.click()}><Upload size={16} />选择其他 .xlsx</button><input aria-label="选择其他 Excel 工作簿" className="sr-only" ref={fileRef} type="file" accept=".xlsx" onChange={(event) => event.target.files?.[0] && importLatest(event.target.files[0])} /></div></div><ArchiveCoveragePanel coverage={coverage} /><div className="source-columns"><section className="panel"><header className="panel-header"><h2>Excel 导入记录</h2><span>{runs.length} RUNS</span></header><div className="run-list">{runs.map((run) => <article key={run.id}><span className={clsx("run-status", `run-${run.status}`)} /> <div><strong>{run.fileName}</strong><p>{formatTime(run.startedAt)} · 读取 {run.rowsRead} 行 · 识别 {run.postingsFound} 岗位 · 链接 {run.linksImported}</p>{run.errors.map((error) => <em key={error}>{error}</em>)}</div><Badge tone={run.status === "success" ? "green" : run.status === "failed" ? "red" : "amber"}>{run.status}</Badge></article>)}{!runs.length && <Empty title="尚无 Excel 导入记录" text="点击上方按钮开始首轮导入。" />}</div></section><section className="panel"><header className="panel-header"><h2>公开在线来源</h2><span>{sources.length} SOURCES</span></header><div className="source-list">{sources.map((source) => <article key={source.id}><span className={clsx("source-indicator", source.lastStatus === "ok" && "source-ok", source.lastStatus === "error" && "source-error")} /><div><strong>{source.name}</strong><p>{source.trust} · {source.lastCheckedAt ? formatTime(source.lastCheckedAt) : "尚未检查"}</p></div>{source.url.startsWith("http") && <a href={source.url} target="_blank" rel="noreferrer" aria-label={`打开${source.name}`}><ArrowUpRight size={16} /></a>}</article>)}</div>{crawlRun && <p className="crawl-note"><Clock3 size={15} />最近公开采集：{formatTime(crawlRun.finishedAt || crawlRun.startedAt)} · 新增 {crawlRun.inserted} / 更新 {crawlRun.updated}</p>}</section></div></section>;
}

function ArchiveCoveragePanel({ coverage }: { coverage: SourceArchiveCoverage | null }) {
  if (!coverage) return <section className="panel archive-coverage"><Empty title="暂无来源行覆盖数据" text="完成一次腾讯文档归档后将在这里显示。" /></section>;
  const hasGap = coverage.unresolvedRows > 0 || coverage.unarchivedRows > 0;
  const metrics = [
    ["当前来源行", coverage.currentRows],
    ["已映射岗位", coverage.postingRows],
    ["公司入口", coverage.companyLinkRows],
    ["策略排除", coverage.policyExcludedRows],
    ["未解析", coverage.unresolvedRows],
    ["无归档结果", coverage.unarchivedRows],
  ] as const;
  return <section className="panel archive-coverage" aria-labelledby="archive-coverage-title"><header className="panel-header"><h2 id="archive-coverage-title">腾讯文档来源行归档覆盖</h2><Badge tone={hasGap ? "amber" : "green"}>{hasGap ? "需要处理" : "覆盖完整"}</Badge></header>{hasGap && <div className="notice notice-amber archive-warning" role="status"><CircleAlert size={17} /><span>仍有 {coverage.unresolvedRows} 条当前来源行未解析、{coverage.unarchivedRows} 条历史来源行没有归档结果；抓取成功不等于岗位已归档。</span></div>}<dl className="archive-metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString("zh-CN")}</dd></div>)}</dl><p className="archive-footnote">累计保存 {coverage.totalRows.toLocaleString("zh-CN")} 条来源身份；其中 {coverage.staleRows.toLocaleString("zh-CN")} 条已被后续完整快照替换，不参与当前岗位生成。</p></section>;
}

function ManualDialog({ open, setOpen, onCreated }: { open: boolean; setOpen: (v: boolean) => void; onCreated: (application: Application) => Promise<void> }) {
  const [company, setCompany] = useState(""); const [title, setTitle] = useState(""); const [cities, setCities] = useState(""); const [jd, setJd] = useState(""); const [applyUrl, setApplyUrl] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { const { application } = await api<{ application: Application }>("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, title, cities: cities.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean), jdText: jd, applyUrl: applyUrl || null }) }); await onCreated(application); setOpen(false); setCompany(""); setTitle(""); setCities(""); setJd(""); setApplyUrl(""); } catch (err) { setError(err instanceof Error ? err.message : "创建失败"); } finally { setSaving(false); } }
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><div className="dialog-heading"><div><Dialog.Title>手动新增投递岗位</Dialog.Title><Dialog.Description>保存后立即分配稳定序号，并在工作区根目录建立岗位文件夹。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭"><X /></Dialog.Close></div><form onSubmit={submit} className="manual-form"><div className="form-grid"><label>公司<input required value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>岗位<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label></div><label>城市<input value={cities} onChange={(event) => setCities(event.target.value)} placeholder="北京、上海" /></label><label>投递链接<input type="url" value={applyUrl} onChange={(event) => setApplyUrl(event.target.value)} placeholder="https://" /></label><label>完整 JD<textarea rows={10} value={jd} onChange={(event) => setJd(event.target.value)} /></label>{error && <div className="notice notice-red">{error}</div>}<div className="dialog-actions"><Dialog.Close className="button button-ghost" type="button">取消</Dialog.Close><button className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}创建岗位档案</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><BriefcaseBusiness size={28} /><strong>{title}</strong><p>{text}</p></div>; }
