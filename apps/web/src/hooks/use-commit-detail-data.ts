import { useEffect, useState } from "react";

import type { CommitDetail, CommitTreemap } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";
import type { AppRoute } from "../lib/routing.js";

export const useCommitDetailData = (route: AppRoute) => {
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [treemap, setTreemap] = useState<CommitTreemap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [treemapError, setTreemapError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name !== "commit" || !route.repositorySlug) {
      setCommit(null);
      setTreemap(null);
      setError(null);
      setTreemapError(null);
      return;
    }

    setCommit(null);
    setTreemap(null);
    setTreemapError(null);

    const refresh = async (): Promise<void> => {
      try {
        const nextCommit = await fetchJson<CommitDetail>(
          `/repositories/${route.repositorySlug}/commits/${route.commitSha}`,
        );
        setCommit(nextCommit);
        try {
          const nextTreemap = await fetchJson<CommitTreemap>(
            `/repositories/${route.repositorySlug}/commits/${route.commitSha}/treemap`,
          );
          setTreemap(nextTreemap);
          setTreemapError(null);
        } catch (nextTreemapError) {
          setTreemap(null);
          setTreemapError(
            describeLoadError(route, nextTreemapError, "Failed to load commit duration map"),
          );
        }
        setError(null);
      } catch (nextError) {
        setError(describeLoadError(route, nextError, "Failed to load commit data"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [route]);

  return { commit, treemap, error, treemapError };
};
