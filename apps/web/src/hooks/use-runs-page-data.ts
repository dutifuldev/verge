import { useEffect, useState } from "react";

import type { PaginatedRunList } from "@verge/contracts";

import { describeLoadError, fetchJson } from "../lib/api.js";
import type { AppRoute } from "../lib/routing.js";

export const useRunsPageData = (route: AppRoute, repositorySlug: string | null) => {
  const [runsPage, setRunsPage] = useState<PaginatedRunList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name !== "runs" || !repositorySlug) {
      setRunsPage(null);
      setError(null);
      return;
    }

    setRunsPage(null);

    const refresh = async (): Promise<void> => {
      try {
        const search = new URLSearchParams({
          page: String(route.page),
          pageSize: "20",
        });

        if (route.status) {
          search.set("status", route.status);
        }
        if (route.trigger) {
          search.set("trigger", route.trigger);
        }
        if (route.stepKey) {
          search.set("stepKey", route.stepKey);
        }

        const nextRunsPage = await fetchJson<PaginatedRunList>(
          `/repositories/${repositorySlug}/runs?${search.toString()}`,
        );
        setError(null);
        setRunsPage(nextRunsPage);
      } catch (nextError) {
        setError(describeLoadError(route, nextError, "Failed to load runs"));
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [route, repositorySlug]);

  return { runsPage, error };
};
