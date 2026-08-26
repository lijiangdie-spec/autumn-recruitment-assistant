"use client";

import { Check, Gauge, RotateCcw, Save } from "lucide-react";
import { useState } from "react";

import { hasInternAssessmentPenalty, type PersonalScoreBreakdown, type PersonalScoreOverrides, type ScoreRecommendation } from "@/lib/personal-scoring";

export interface ScoredJobView {
  id: number; personalScore: number; landingProbability: number; scoreBreakdown: PersonalScoreBreakdown;
  scoreOverrides: PersonalScoreOverrides; scoreReasons: string[]; scoreRecommendation: ScoreRecommendation;
}

const DIMENSIONS: Array<{ key: keyof PersonalScoreBreakdown; label: string; weight: string }> = [
  { key: "workContent", label: "岗位方向", weight: "30%" },
  { key: "fiveYearGrowth", label: "必须条件", weight: "20%" },
  { key: "currentComp", label: "自定义维度", weight: "20%" },
  { key: "workLifeBalance", label: "JD 完整度", weight: "10%" },
  { key: "platformStability", label: "来源匹配", weight: "10%" },
  { key: "cityPreference", label: "城市偏好", weight: "10%" },
];

type RecommendationView = Pick<ScoredJobView, "personalScore" | "scoreRecommendation">;
type InternConversionView = Pick<ScoredJobView, "scoreReasons"> | { internAssessmentPenalty: boolean };
function recommendationLabel(job: RecommendationView): string {
  if (job.scoreRecommendation === "ineligible") return "偏好冲突";
  return job.scoreRecommendation === "apply" ? "符合偏好" : "低于推荐线";
}

export function ScoreStamp({ job }: { job: RecommendationView }) {
  return <span className={`score-stamp score-stamp-${job.scoreRecommendation}`} aria-label={`偏好匹配 ${job.personalScore} 分，${recommendationLabel(job)}`}><strong>{job.personalScore}</strong><small>匹配分</small></span>;
}

export function InternConversionBadge({ job }: { job: InternConversionView }) {
  const hasPenalty = "internAssessmentPenalty" in job ? job.internAssessmentPenalty : hasInternAssessmentPenalty(job.scoreReasons);
  if (!hasPenalty) return null;
  return <span className="badge badge-amber">包含实习考察</span>;
}

export function ScoreSummary({ job }: { job: ScoredJobView }) {
  return <section className="score-audit" aria-label="个人偏好匹配评分"><header className="score-audit-header"><div className={`score-hero score-hero-${job.scoreRecommendation}`}><span>偏好匹配</span><strong>{job.personalScore}</strong><em>/ 100</em></div><div className="score-decision"><span className={`decision-label decision-${job.scoreRecommendation}`}><Check size={14} />{recommendationLabel(job)}</span><InternConversionBadge job={job} /><p>匹配把握 <strong>{job.landingProbability}%</strong></p><small>推荐线由你在设置中决定</small></div></header><div className="dimension-list">{DIMENSIONS.map(({ key, label, weight }) => { const value = job.scoreBreakdown[key]; return <div className="dimension-row" key={key}><div><span>{label}</span><small>{weight}</small></div><div className="dimension-track" role="progressbar" aria-label={`${label} ${value} 分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }} /></div><strong>{value}</strong></div>; })}</div></section>;
}

export function ScorePanel({ job, onSave }: { job: ScoredJobView; onSave: (overrides: PersonalScoreOverrides) => Promise<void> }) {
  const editorKey = [job.id, job.scoreOverrides.workContent ?? "auto", job.scoreOverrides.fiveYearGrowth ?? "auto"].join(":");
  return <div className="score-panel-stack"><ScoreSummary job={job} /><ScoreEditor key={editorKey} job={job} onSave={onSave} /></div>;
}

function ScoreEditor({ job, onSave }: { job: ScoredJobView; onSave: (overrides: PersonalScoreOverrides) => Promise<void> }) {
  const [roleAlignment, setRoleAlignment] = useState(job.scoreOverrides.workContent ?? job.scoreBreakdown.workContent);
  const [requiredCoverage, setRequiredCoverage] = useState(job.scoreOverrides.fiveYearGrowth ?? job.scoreBreakdown.fiveYearGrowth);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(overrides: PersonalScoreOverrides) { setBusy(true); setError(""); try { await onSave(overrides); } catch (caught) { setError(caught instanceof Error ? caught.message : "评分保存失败"); } finally { setBusy(false); } }
  return <details className="score-editor"><summary><Gauge size={16} /><span>纠正自动匹配</span><small>只覆盖你确认过的判断</small></summary><div className="score-editor-body"><p>如果关键词判断与实际岗位不符，可以人工纠正；其他维度仍从你的设置和 JD 自动计算。</p><fieldset className="score-form-grid"><legend className="sr-only">评分覆盖值</legend><label>岗位方向匹配<input type="number" min={0} max={100} value={roleAlignment} onChange={(event) => setRoleAlignment(Number(event.target.value))} /></label><label>必须条件覆盖<input type="number" min={0} max={100} value={requiredCoverage} onChange={(event) => setRequiredCoverage(Number(event.target.value))} /></label></fieldset>{error && <div className="notice notice-red" role="alert">{error}</div>}<div className="button-row"><button className="button button-primary" disabled={busy} onClick={() => save({ workContent: roleAlignment, fiveYearGrowth: requiredCoverage })}><Save size={15} />保存纠正</button><button className="button button-ghost" disabled={busy} onClick={() => save({})}><RotateCcw size={15} />恢复自动匹配</button></div></div></details>;
}
