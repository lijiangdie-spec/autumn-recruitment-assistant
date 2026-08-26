import type { ScoreRecommendation } from "@/lib/personal-scoring";

export const MANUAL_DISPOSITIONS = ["include", "trash"] as const;
export type ManualDisposition = (typeof MANUAL_DISPOSITIONS)[number];
export type DispositionReason = "recommended" | "score" | "ineligible" | "manual";

export interface EffectiveDisposition {
  bucket: "active" | "trash";
  reason: DispositionReason;
  manuallyRestored: boolean;
}

export function resolveDisposition(
  recommendation: ScoreRecommendation,
  manualDisposition: ManualDisposition | null,
): EffectiveDisposition {
  if (manualDisposition === "trash") {
    return { bucket: "trash", reason: "manual", manuallyRestored: false };
  }
  const systemReason: DispositionReason = recommendation === "ineligible"
    ? "ineligible"
    : recommendation === "skip" ? "score" : "recommended";
  if (manualDisposition === "include") {
    return { bucket: "active", reason: systemReason, manuallyRestored: recommendation !== "apply" };
  }
  return { bucket: "active", reason: systemReason, manuallyRestored: false };
}
