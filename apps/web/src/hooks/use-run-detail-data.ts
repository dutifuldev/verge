import { useEffect, useState } from "react";

import type { RunDetail, RunTreemap, StepRunDetail } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";
import type { AppRoute } from "../lib/routing.js";

export const useRunDetailData = (route: AppRoute) => {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [treemap, setTreemap] = useState<RunTreemap | null>(null);
  const [step, setStep] = useState<StepRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [treemapError, setTreemapError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name !== "run" && route.name !== "step") {
      setRun(null);
      setTreemap(null);
      setStep(null);
      setError(null);
      setTreemapError(null);
      return;
    }

    setRun(null);
    setTreemap(null);
    setStep(null);
    setTreemapError(null);

    const refresh = async (): Promise<void> => {
      try {
        const nextRun = await fetchJson<RunDetail>(`/runs/${route.runId}`);
        setRun(nextRun);
        if (route.name === "step") {
          const nextStep = await fetchJson<StepRunDetail>(
            `/runs/${route.runId}/steps/${route.stepId}`,
          );
          setStep(nextStep);
        } else {
          try {
            const nextTreemap = await fetchJson<RunTreemap>(`/runs/${route.runId}/treemap`);
            setTreemap(nextTreemap);
            setTreemapError(null);
          } catch (nextTreemapError) {
            setTreemap(null);
            setTreemapError(
              describeLoadError(route, nextTreemapError, "Failed to load duration map"),
            );
          }
        }
        setError(null);
      } catch (nextError) {
        setError(describeLoadError(route, nextError, "Failed to load run data"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [route]);

  return { run, treemap, step, error, treemapError };
};
