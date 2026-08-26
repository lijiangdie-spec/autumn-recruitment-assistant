"use client";

import { useCallback, useEffect, useState } from "react";

import { OnboardingWizard, type SetupPayload } from "@/components/onboarding-wizard";
import { RadarApp } from "@/components/radar-app";
import type { DependencyCheck } from "@/lib/config/doctor";

interface SetupResponse extends SetupPayload {
  completed: boolean;
  dataRoot: string;
  checks: DependencyCheck[];
  error?: string;
}

export function AppEntry() {
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    const response = await fetch("/api/setup", { cache: "no-store" });
    const payload = await response.json() as SetupResponse;
    if (!response.ok) throw new Error(payload.error || "无法读取首次设置");
    setSetup(payload);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  if (error) return <main className="setup-shell"><section className="setup-card"><h1>秋招助手无法启动</h1><p>{error}</p><button className="button button-primary" onClick={() => refresh().catch(() => undefined)}>重新检测</button></section></main>;
  if (!setup) return <main className="setup-shell"><section className="setup-card"><h1>秋招助手</h1><p>正在检查本机环境与数据目录…</p></section></main>;
  if (!setup.completed) return <OnboardingWizard initial={setup} onCompleted={refresh} />;
  return <RadarApp />;
}
