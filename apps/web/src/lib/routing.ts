export type AppRoute =
  | { name: "overview" }
  | {
      name: "runs";
      page: number;
      status: string;
      trigger: string;
      stepKey: string;
    }
  | { name: "step"; runId: string; stepId: string }
  | { name: "run"; runId: string };

export const parseRoute = (): AppRoute => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(window.location.search);

  if (path === "/runs") {
    const pageValue = Number(search.get("page") ?? "1");
    return {
      name: "runs",
      page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
      status: search.get("status") ?? "",
      trigger: search.get("trigger") ?? "",
      stepKey: search.get("stepKey") ?? "",
    };
  }

  const stepMatch = path.match(/^\/runs\/([^/]+)\/steps\/([^/]+)$/);
  if (stepMatch) {
    return { name: "step", runId: stepMatch[1]!, stepId: stepMatch[2]! };
  }

  const runMatch = path.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return { name: "run", runId: runMatch[1]! };
  }

  return { name: "overview" };
};

export const navigate = (path: string): void => {
  if (`${window.location.pathname}${window.location.search}` === path) {
    return;
  }

  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
