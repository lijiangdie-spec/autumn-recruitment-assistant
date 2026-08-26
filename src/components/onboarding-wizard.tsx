"use client";

import { CheckCircle2, CircleAlert, Database, FileText, Laptop, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import type { DependencyCheck } from "@/lib/config/doctor";
import type { UserPreferences, UserProfile } from "@/lib/config/schema";

export interface SetupPayload {
  profile: UserProfile;
  preferences: UserPreferences;
}

interface Props {
  initial: SetupPayload & { checks: DependencyCheck[]; dataRoot: string };
  onCompleted: () => Promise<void>;
}

const splitList = (value: string) => value.split(/[、,，;；\n]+/).map((item) => item.trim()).filter(Boolean);

export function OnboardingWizard({ initial, onCompleted }: Props) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(initial.profile);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [roleKeywords, setRoleKeywords] = useState(preferences.job.roleKeywords.join("、"));
  const [cities, setCities] = useState(preferences.job.cities.join("、"));
  const [requiredKeywords, setRequiredKeywords] = useState(preferences.job.requiredKeywords.join("、"));
  const [excludedKeywords, setExcludedKeywords] = useState(preferences.job.excludedKeywords.join("、"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const agentAvailable = useMemo(() => new Map(initial.checks.map((item) => [item.id, item.available])), [initial.checks]);
  const steps = ["环境", "基本资料", "素材说明", "岗位偏好", "简历与代理"];

  async function finish() {
    setSaving(true);
    setError("");
    try {
      const payload: SetupPayload = {
        profile,
        preferences: {
          ...preferences,
          setupCompleted: true,
          job: {
            ...preferences.job,
            roleKeywords: splitList(roleKeywords),
            cities: splitList(cities),
            requiredKeywords: splitList(requiredKeywords),
            excludedKeywords: splitList(excludedKeywords),
          },
        },
      };
      const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "无法保存设置");
      await onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return <main className="setup-shell">
    <section className="setup-card">
      <header className="setup-heading"><div className="brand-mark"><Sparkles size={22} /></div><div><span>WELCOME TO</span><h1>秋招助手</h1><p>所有个人资料默认只保存在这台电脑。</p></div></header>
      <ol className="setup-steps">{steps.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "done" : ""}><span>{index < step ? "✓" : index + 1}</span>{label}</li>)}</ol>

      {step === 0 && <div className="setup-content"><h2><Laptop />环境体检</h2><p>至少需要 Codex 或 Claude Code 其中一个。PDF 工具缺失时仍可完成资料和岗位管理。</p><div className="doctor-grid">{initial.checks.map((item) => <article key={item.id} className={item.available ? "doctor-ok" : "doctor-warn"}>{item.available ? <CheckCircle2 /> : <CircleAlert />}<div><strong>{item.label}</strong><small>{item.detail || "未检测到"}</small></div></article>)}</div><div className="data-root-note"><Database size={17} /><div><strong>私人数据目录</strong><code>{initial.dataRoot}</code></div></div></div>}

      {step === 1 && <div className="setup-content"><h2>基本资料</h2><p>只填写你愿意放进简历的信息，之后可随时修改。</p><div className="setup-form-grid"><label>姓名<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="你的姓名" /></label><label>邮箱<input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} placeholder="name@example.com" /></label><label>电话<input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="可留空" /></label><label>技能关键词<input value={profile.skills.join("、")} onChange={(event) => setProfile({ ...profile, skills: splitList(event.target.value) })} placeholder="Python、数据分析、写作" /></label></div></div>}

      {step === 2 && <div className="setup-content"><h2><FileText />素材库采用“事实超集”</h2><p>写进素材库不等于写进每一份简历。进入主界面后可以用三种方式补充素材：</p><div className="onboarding-feature-grid"><article><strong>结构化访谈</strong><span>每轮 2–3 个问题，边聊边保存。</span></article><article><strong>旧简历导入</strong><span>从 PDF、Word 或 TEX 拆出可追溯事实。</span></article><article><strong>代码仓库分析</strong><span>只读分析技术证据，角色和成果由你确认。</span></article></div></div>}

      {step === 3 && <div className="setup-content"><h2>岗位偏好</h2><p>不提供行业预设。留空代表暂不限制，不会偷偷套用金融或技术规则。</p><div className="setup-form-grid"><label>目标岗位关键词<input value={roleKeywords} onChange={(event) => setRoleKeywords(event.target.value)} placeholder="研究、设计、供应链…" /></label><label>目标城市<input value={cities} onChange={(event) => setCities(event.target.value)} placeholder="上海、成都、远程" /></label><label>必须包含<input value={requiredKeywords} onChange={(event) => setRequiredKeywords(event.target.value)} placeholder="例如：校招、本科" /></label><label>明确排除<input value={excludedKeywords} onChange={(event) => setExcludedKeywords(event.target.value)} placeholder="例如：销售、外派" /></label><label>推荐阈值<input type="number" min={0} max={100} value={preferences.job.recommendationThreshold} onChange={(event) => setPreferences({ ...preferences, job: { ...preferences.job, recommendationThreshold: Number(event.target.value) } })} /></label><label>岗位 feed<input type="url" value={preferences.feedUrl} onChange={(event) => setPreferences({ ...preferences, feedUrl: event.target.value })} placeholder="可稍后设置" /></label></div></div>}

      {step === 4 && <div className="setup-content"><h2>简历与代理</h2><div className="setup-form-grid"><label>默认代理<select value={preferences.agentProvider} onChange={(event) => setPreferences({ ...preferences, agentProvider: event.target.value as "codex" | "claude" })}><option value="codex" disabled={!agentAvailable.get("codex")}>Codex {!agentAvailable.get("codex") ? "（未检测到）" : ""}</option><option value="claude" disabled={!agentAvailable.get("claude")}>Claude Code {!agentAvailable.get("claude") ? "（未检测到）" : ""}</option></select></label><label>简历模板<select value={preferences.resume.template} onChange={(event) => setPreferences({ ...preferences, resume: { ...preferences.resume, template: event.target.value as "a" | "b" | "c" } })}><option value="c">C · 高密度单栏</option><option value="a">A · 经典单栏</option><option value="b">B · 双栏</option></select></label><label>输出格式<select value={preferences.resume.outputFormat} onChange={(event) => setPreferences({ ...preferences, resume: { ...preferences.resume, outputFormat: event.target.value as "pdf" | "docx" | "both" } })}><option value="pdf">PDF</option><option value="docx">Word</option><option value="both">PDF + Word</option></select></label><label>主题色<input type="color" value={preferences.resume.accentHex} onChange={(event) => setPreferences({ ...preferences, resume: { ...preferences.resume, accentHex: event.target.value } })} /></label></div>{!agentAvailable.get(preferences.agentProvider) && <div className="notice notice-amber"><CircleAlert size={16} />当前代理未检测到。可以先完成设置，安装或登录后再生成简历。</div>}</div>}

      {error && <div className="notice notice-red">{error}</div>}
      <footer className="setup-actions"><button className="button button-ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>上一步</button>{step < steps.length - 1 ? <button className="button button-primary" onClick={() => setStep((value) => value + 1)}>下一步</button> : <button className="button button-primary" disabled={saving} onClick={finish}>{saving ? "正在保存…" : "进入秋招助手"}</button>}</footer>
    </section>
  </main>;
}

