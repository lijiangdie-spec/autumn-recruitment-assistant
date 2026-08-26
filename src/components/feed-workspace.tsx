"use client";

import { CheckCircle2, CloudDownload, LoaderCircle, Radio, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { UserPreferences } from "@/lib/config/schema";
import type { FeedSyncState } from "@/lib/feed/sync";

async function api<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { cache: "no-store", ...init }); const payload = await response.json().catch(() => ({})) as T & { error?: string }; if (!response.ok) throw new Error(payload.error || "操作失败"); return payload; }

export function FeedWorkspace({ onSynced }: { onSynced: () => Promise<void> }) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [state, setState] = useState<FeedSyncState | null>(null);
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const [pref, status] = await Promise.all([api<{ preferences: UserPreferences }>("/api/preferences"), api<{ state: FeedSyncState | null }>("/api/feed/sync")]); setPreferences(pref.preferences); setUrl(pref.preferences.feedUrl); setState(status.state); }, []);
  useEffect(() => { const timer = window.setTimeout(() => load().catch((error) => setMessage(error.message)), 0); return () => window.clearTimeout(timer); }, [load]);

  async function saveAndSync() {
    if (!preferences) return; setBusy(true); setMessage("");
    try {
      const saved = await api<{ preferences: UserPreferences }>("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preferences, feedUrl: url.trim() }) });
      setPreferences(saved.preferences);
      const result = await api<{ state: FeedSyncState }>("/api/feed/sync", { method: "POST" }); setState(result.state); await onSynced();
      setMessage(`同步完成：新增 ${result.state.inserted}，更新 ${result.state.updated}，关闭 ${result.state.closed}，未变化 ${result.state.skipped}。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); }
    finally { setBusy(false); }
  }

  return <section className="page-stack feed-workspace"><div className="page-heading"><div><span className="eyebrow">PUBLIC FEED → PRIVATE WORKSPACE</span><h1>岗位订阅</h1><p>这里只同步公开岗位事实；你的偏好、素材、简历、投递进度和备注不会上传。</p></div>{state && <div className="heading-stat"><strong>{state.jobCount}</strong><span>个订阅岗位</span></div>}</div>
    <section className="feed-privacy-grid"><article><Radio /><div><strong>公开信息源</strong><p>公司、岗位、JD、日期和投递链接。</p></div></article><article><ShieldCheck /><div><strong>本地个性化</strong><p>同步后用你自己的偏好重算，不采用发布者分数。</p></div></article><article><CheckCircle2 /><div><strong>版本校验</strong><p>revision 与 SHA-256 不一致时整批拒绝。</p></div></article></section>
    <section className="panel feed-config"><div><span className="eyebrow">FEED.JSON</span><h2>连接岗位网站</h2><p>填入朋友提供的 feed.json 地址，或你自己部署的静态站点地址。</p></div><label>Feed URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.github.io/project/feed.json" /></label><button className="button button-primary" onClick={saveAndSync} disabled={!url.trim() || !preferences || busy}>{busy ? <LoaderCircle className="spin" /> : <CloudDownload />}保存并检查更新</button></section>
    {state && <section className="panel feed-state"><header className="panel-header"><h2>最近一次同步</h2><span>{new Date(state.syncedAt).toLocaleString("zh-CN")}</span></header><dl><div><dt>版本</dt><dd><code>{state.revision.slice(0, 16)}</code></dd></div><div><dt>新增</dt><dd>{state.inserted}</dd></div><div><dt>更新</dt><dd>{state.updated}</dd></div><div><dt>关闭</dt><dd>{state.closed ?? 0}</dd></div><div><dt>错误</dt><dd>{state.errors.length}</dd></div></dl>{state.errors.length > 0 && <details><summary>查看未导入项目</summary><ul>{state.errors.map((error) => <li key={error}>{error}</li>)}</ul></details>}</section>}
    {message && <div className="notice notice-amber" role="status">{message}</div>}
  </section>;
}
