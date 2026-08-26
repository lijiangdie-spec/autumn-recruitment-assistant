"use client";

import { Check, FileUp, FolderGit2, LoaderCircle, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Material, MaterialDraft } from "@/lib/materials/schema";

type Mode = "interview" | "resume" | "repository";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "操作失败");
  return payload;
}

const emptyDraft = (): MaterialDraft => ({
  kind: "project",
  title: "",
  organization: "",
  role: "",
  dateRange: "",
  background: "",
  contribution: "",
  approach: "",
  outcomes: "",
  challenges: "",
  resumeBullets: [],
  keywords: [],
  status: "draft",
  sources: [],
});

const splitList = (value: string) => value.split(/[、,，;；\n]+/).map((item) => item.trim()).filter(Boolean);

export function MaterialsWorkspace() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [mode, setMode] = useState<Mode>("interview");
  const [draft, setDraft] = useState<MaterialDraft>(emptyDraft);
  const [bullets, setBullets] = useState("");
  const [keywords, setKeywords] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setMaterials((await api<{ materials: Material[] }>("/api/materials")).materials);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { refresh().catch((error) => setMessage(error.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function saveInterview(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await api("/api/materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, resumeBullets: splitList(bullets), keywords: splitList(keywords), sources: [{ type: "interview", label: "结构化访谈", path: "", importedAt: new Date().toISOString() }] }),
      });
      setDraft(emptyDraft()); setBullets(""); setKeywords(""); await refresh(); setMessage("素材草稿已保存。确认事实后再将状态改为“已确认”。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function importResume() {
    if (!resumeFile) return; setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.append("file", resumeFile);
      const result = await api<{ materials: Material[]; warnings: string[] }>("/api/materials/import", { method: "POST", body: form });
      await refresh(); setMessage(`已拆出 ${result.materials.length} 条草稿${result.warnings.length ? `；${result.warnings.join("；")}` : "。"}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); }
    finally { setBusy(false); }
  }

  async function analyzeRepo() {
    setBusy(true); setMessage("");
    try {
      const result = await api<{ materials: Material[]; warnings: string[] }>("/api/materials/analyze-repository", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: repoPath }) });
      await refresh(); setMessage(`已生成 ${result.materials.length} 条项目草稿${result.warnings.length ? `；${result.warnings.join("；")}` : "。"}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "分析失败"); }
    finally { setBusy(false); }
  }

  async function update(id: string, body: unknown) {
    setBusy(true); setMessage("");
    try { await api(`/api/materials/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("删除这条素材？此操作只影响外置素材库。")) return;
    setBusy(true); setMessage("");
    try { await fetch(`/api/materials/${id}`, { method: "DELETE" }); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return <section className="page-stack material-workspace">
    <div className="page-heading"><div><span className="eyebrow">PRIVATE FACT LIBRARY</span><h1>我的素材库</h1><p>项目和实习只保存在本机外置数据目录；AI 提取的内容一律先进入草稿。</p></div><div className="heading-stat"><strong>{materials.length}</strong><span>条个人素材</span></div></div>
    <div className="material-mode-tabs" role="tablist">
      <button className={mode === "interview" ? "active" : ""} onClick={() => setMode("interview")}><MessageSquareText />结构化访谈</button>
      <button className={mode === "resume" ? "active" : ""} onClick={() => setMode("resume")}><FileUp />导入旧简历</button>
      <button className={mode === "repository" ? "active" : ""} onClick={() => setMode("repository")}><FolderGit2 />分析代码仓库</button>
    </div>

    {mode === "interview" && <form className="panel material-entry-form" onSubmit={saveInterview}><header className="panel-header"><div><h2>用事实回答，不用先写成简历话术</h2><p>先说清“为什么做、你做了什么、怎么做、结果如何”，之后再按岗位改写。</p></div></header><div className="setup-form-grid"><label>类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Material["kind"] })}><option value="project">项目</option><option value="internship">实习</option></select></label><label>名称<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="项目或实习名称" /></label><label>组织 / 公司<input value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label><label>角色<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label><label>时间<input value={draft.dateRange} onChange={(event) => setDraft({ ...draft, dateRange: event.target.value })} placeholder="2025.06–2025.09" /></label><label>关键词<input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="工具、行业、能力，用顿号分隔" /></label></div><div className="material-long-fields"><label>背景与目标<textarea value={draft.background} onChange={(event) => setDraft({ ...draft, background: event.target.value })} placeholder="当时要解决什么问题？为什么重要？" /></label><label>你的贡献<textarea value={draft.contribution} onChange={(event) => setDraft({ ...draft, contribution: event.target.value })} placeholder="哪些部分由你负责？和团队如何分工？" /></label><label>方法与过程<textarea value={draft.approach} onChange={(event) => setDraft({ ...draft, approach: event.target.value })} placeholder="做了哪些关键决策、分析或实现？" /></label><label>结果与证据<textarea value={draft.outcomes} onChange={(event) => setDraft({ ...draft, outcomes: event.target.value })} placeholder="数字、交付物、反馈；没有数字就写可核验事实" /></label><label>候选简历句<textarea value={bullets} onChange={(event) => setBullets(event.target.value)} placeholder="一行一句，可留空" /></label></div><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />}保存为草稿</button></form>}

    {mode === "resume" && <section className="panel material-import-card"><FileUp /><div><h2>把旧简历拆成事实素材</h2><p>支持 PDF、DOCX、TXT、Markdown、TEX、JSON 和 YAML。不会把姓名、电话等复制成项目素材。</p><input type="file" accept=".pdf,.docx,.txt,.md,.tex,.json,.yaml,.yml" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} /></div><button className="button button-primary" disabled={!resumeFile || busy} onClick={importResume}>{busy ? <LoaderCircle className="spin" /> : <FileUp />}开始只读提取</button></section>}

    {mode === "repository" && <section className="panel material-import-card"><FolderGit2 /><div><h2>从本地仓库提取技术证据</h2><p>代理只读访问你指定的仓库；个人贡献和业务指标仍需你确认。</p><input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="本地代码仓库绝对路径" /></div><button className="button button-primary" disabled={!repoPath.trim() || busy} onClick={analyzeRepo}>{busy ? <LoaderCircle className="spin" /> : <FolderGit2 />}分析仓库</button></section>}

    {message && <div className="notice notice-amber" role="status">{message}</div>}
    <section className="material-library"><header><div><span className="eyebrow">REVIEW BEFORE USE</span><h2>素材清单</h2></div><span>{materials.filter((item) => item.status === "confirmed").length} 已确认 · {materials.filter((item) => item.status === "draft").length} 草稿</span></header><div className="material-card-grid">{materials.map((material) => <article className="material-card" key={material.id}><div className="material-card-heading"><span>{material.kind === "project" ? "项目" : "实习"}</span><em className={material.status}>{material.status === "confirmed" ? "已确认" : "待确认"}</em></div><h3>{material.title}</h3><p>{[material.organization, material.role, material.dateRange].filter(Boolean).join(" · ") || "尚未补充组织、角色和时间"}</p><blockquote>{material.contribution || material.background || material.resumeBullets[0] || "这条素材还需要补充事实。"}</blockquote><div className="material-keywords">{material.keywords.slice(0, 8).map((keyword) => <span key={keyword}>{keyword}</span>)}</div><footer>{material.status === "draft" && <button className="button button-secondary" disabled={busy} onClick={() => update(material.id, { status: "confirmed" })}><Check />确认事实</button>}<button className="text-button danger-text" disabled={busy} onClick={() => remove(material.id)}><Trash2 />删除</button></footer></article>)}</div>{materials.length === 0 && <div className="empty-state"><MessageSquareText /><strong>素材库还是空的</strong><p>从上面任一种方式录入第一段项目或实习。</p></div>}</section>
  </section>;
}
