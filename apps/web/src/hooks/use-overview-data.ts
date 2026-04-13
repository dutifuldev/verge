import { useEffect, useState } from "react";

import type { RepositoryHealth, StepSpecSummary } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";

export const useOverviewData = (repositorySlug: string | null) => {
  const [health, setHealth] = useState<RepositoryHealth | null>(null);
  const [processSpecs, setProcessSpecs] = useState<StepSpecSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repositorySlug) {
      setHealth(null);
      setProcessSpecs([]);
      setError(null);
      return;
    }

    const refresh = async (): Promise<void> => {
      try {
        const [nextHealth, nextSpecs] = await Promise.all([
          fetchJson<RepositoryHealth>(`/repositories/${repositorySlug}/health`),
          fetchJson<StepSpecSummary[]>(`/repositories/${repositorySlug}/step-specs`),
        ]);
        setError(null);
        setHealth(nextHealth);
        setProcessSpecs(nextSpecs);
      } catch (nextError) {
        setError(describeLoadError({ name: "overview" }, nextError, "Failed to load overview"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [repositorySlug]);

  return { health, processSpecs, error };
};
