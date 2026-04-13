export type AppRoute =
  | { name: "overview"; repositorySlug: string | null }
  | {
      name: "runs";
      repositorySlug: string | null;
      page: number;
      status: string;
      trigger: string;
      stepKey: string;
    }
  | { name: "step"; repositorySlug: string | null; runId: string; stepId: string }
  | { name: "run"; repositorySlug: string | null; runId: string };

export const buildRepositoryOverviewPath = (repositorySlug: string): string =>
  `/repos/${repositorySlug}`;

export const buildRepositoryRunsPath = (
  repositorySlug: string,
  input?: {
    page?: number;
    status?: string;
    trigger?: string;
    stepKey?: string;
  },
): string => {
  const search = new URLSearchParams();
  if (input?.page && input.page !== 1) {
    search.set("page", String(input.page));
  }
  if (input?.status) {
    search.set("status", input.status);
  }
  if (input?.trigger) {
    search.set("trigger", input.trigger);
  }
  if (input?.stepKey) {
    search.set("stepKey", input.stepKey);
  }

  const query = search.toString();
  return query.length > 0
    ? `/repos/${repositorySlug}/runs?${query}`
    : `/repos/${repositorySlug}/runs`;
};

export const buildRunPath = (repositorySlug: string, runId: string): string =>
  `/repos/${repositorySlug}/runs/${runId}`;

export const buildStepPath = (repositorySlug: string, runId: string, stepId: string): string =>
  `/repos/${repositorySlug}/runs/${runId}/steps/${stepId}`;

export const parseRoute = (): AppRoute => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(window.location.search);

  const repoRunsMatch = path.match(/^\/repos\/([^/]+)\/runs$/);
  if (repoRunsMatch) {
    const pageValue = Number(search.get("page") ?? "1");
    return {
      name: "runs",
      repositorySlug: repoRunsMatch[1] ?? null,
      page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
      status: search.get("status") ?? "",
      trigger: search.get("trigger") ?? "",
      stepKey: search.get("stepKey") ?? "",
    };
  }

  const repoStepMatch = path.match(/^\/repos\/([^/]+)\/runs\/([^/]+)\/steps\/([^/]+)$/);
  if (repoStepMatch) {
    return {
      name: "step",
      repositorySlug: repoStepMatch[1] ?? null,
      runId: repoStepMatch[2]!,
      stepId: repoStepMatch[3]!,
    };
  }

  const repoRunMatch = path.match(/^\/repos\/([^/]+)\/runs\/([^/]+)$/);
  if (repoRunMatch) {
    return { name: "run", repositorySlug: repoRunMatch[1] ?? null, runId: repoRunMatch[2]! };
  }

  const repoOverviewMatch = path.match(/^\/repos\/([^/]+)$/);
  if (repoOverviewMatch) {
    return { name: "overview", repositorySlug: repoOverviewMatch[1] ?? null };
  }

  if (path === "/runs") {
    const pageValue = Number(search.get("page") ?? "1");
    return {
      name: "runs",
      repositorySlug: null,
      page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
      status: search.get("status") ?? "",
      trigger: search.get("trigger") ?? "",
      stepKey: search.get("stepKey") ?? "",
    };
  }

  const stepMatch = path.match(/^\/runs\/([^/]+)\/steps\/([^/]+)$/);
  if (stepMatch) {
    return { name: "step", repositorySlug: null, runId: stepMatch[1]!, stepId: stepMatch[2]! };
  }

  const runMatch = path.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { name: "run", repositorySlug: null, runId: runMatch[1]! };
  }

  return { name: "overview", repositorySlug: null };
};

export const navigate = (path: string): void => {
  if (`${window.location.pathname}${window.location.search}` === path) {
    return;
  }

  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
