import { useEffect, useState } from "react";

import type { RunDetail, StepRunDetail } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";
import type { AppRoute } from "../lib/routing.js";

export const useRunDetailData = (route: AppRoute) => {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [step, setStep] = useState<StepRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name !== "run" && route.name !== "step") {
      setRun(null);
      setStep(null);
      setError(null);
      return;
    }

    setRun(null);
    setStep(null);

    const refresh = async (): Promise<void> => {
      try {
        const nextRun = await fetchJson<RunDetail>(`/runs/${route.runId}`);
        setRun(nextRun);
        if (route.name === "step") {
          const nextStep = await fetchJson<StepRunDetail>(
            `/runs/${route.runId}/steps/${route.stepId}`,
          );
          setStep(nextStep);
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

  return { run, step, error };
};
