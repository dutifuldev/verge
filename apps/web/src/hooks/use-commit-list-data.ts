import { useEffect, useState } from "react";

import type { PaginatedCommitList } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";
import type { AppRoute } from "../lib/routing.js";

export const useCommitListData = (route: AppRoute, repositorySlug: string | null) => {
  const [commitsPage, setCommitsPage] = useState<PaginatedCommitList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name !== "commits" || !repositorySlug) {
      setCommitsPage(null);
      setError(null);
      return;
    }

    setCommitsPage(null);

    const refresh = async (): Promise<void> => {
      try {
        const search = new URLSearchParams({
          page: String(route.page),
          pageSize: "20",
        });
        const nextCommitsPage = await fetchJson<PaginatedCommitList>(
          `/repositories/${repositorySlug}/commits?${search.toString()}`,
        );
        setError(null);
        setCommitsPage(nextCommitsPage);
      } catch (nextError) {
        setError(describeLoadError(route, nextError, "Failed to load commits"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [route, repositorySlug]);

  return { commitsPage, error };
};
