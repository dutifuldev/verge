import { useEffect, useState } from "react";

import type { StepSpecSummary } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";

export const useStepSpecs = (repositorySlug: string | null) => {
  const [stepSpecs, setStepSpecs] = useState<StepSpecSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repositorySlug) {
      setStepSpecs([]);
      setError(null);
      return;
    }

    const refresh = async (): Promise<void> => {
      try {
        const nextSpecs = await fetchJson<StepSpecSummary[]>(
          `/repositories/${repositorySlug}/step-specs`,
        );
        setError(null);
        setStepSpecs(nextSpecs);
      } catch (nextError) {
        setError(describeLoadError({ name: "runs" }, nextError, "Failed to load step specs"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [repositorySlug]);

  return { stepSpecs, error };
};
