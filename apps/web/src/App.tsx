import { useEffect, useMemo, useState } from "react";

import { NavLink, StatusPill } from "./components/common.js";
import { useAppRoute } from "./hooks/use-app-route.js";
import { useOverviewData } from "./hooks/use-overview-data.js";
import { useRunDetailData } from "./hooks/use-run-detail-data.js";
import { useRunsPageData } from "./hooks/use-runs-page-data.js";
import { navigate } from "./lib/routing.js";
import { statusTone } from "./lib/format.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { StepDetailPage } from "./pages/StepDetailPage.js";
import { fetchJson } from "./lib/api.js";

export { statusTone } from "./lib/format.js";

export const App = () => {
  const route = useAppRoute();
  const { health, processSpecs, error: overviewError } = useOverviewData();
  const { runsPage, error: runsError } = useRunsPageData(route);
  const { run, step, error: runError } = useRunDetailData(route);

  const [commitSha, setCommitSha] = useState("");
  const [branch, setBranch] = useState("main");
  const [changedFiles, setChangedFiles] = useState("");
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState(() =>
    route.name === "runs"
      ? {
          status: route.status,
          trigger: route.trigger,
          stepKey: route.stepKey,
        }
      : { status: "", trigger: "", stepKey: "" },
  );

  useEffect(() => {
    if (route.name !== "runs") {
      return;
    }

    setDraftFilters({
      status: route.status,
      trigger: route.trigger,
      stepKey: route.stepKey,
    });
  }, [route]);

  const activeRunCount = useMemo(() => health?.activeRuns.length ?? 0, [health]);

  const submitManualRun = async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetchJson<{ runId: string; stepRunIds: string[] }>("/runs/manual", {
        method: "POST",
        body: JSON.stringify({
          repositorySlug: "verge",
          commitSha: commitSha.trim(),
          branch: branch.trim() || undefined,
          changedFiles: changedFiles
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          resumeFromCheckpoint,
        }),
      });

      if (response.runId) {
        navigate(`/runs/${response.runId}`);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to start run");
    } finally {
      setSubmitting(false);
    }
  };

  const applyRunFilters = (): void => {
    const search = new URLSearchParams();
    if (draftFilters.status) {
      search.set("status", draftFilters.status);
    }
    if (draftFilters.trigger) {
      search.set("trigger", draftFilters.trigger);
    }
    if (draftFilters.stepKey) {
      search.set("stepKey", draftFilters.stepKey);
    }
    search.set("page", "1");
    navigate(`/runs?${search.toString()}`);
  };

  const changeRunsPage = (page: number): void => {
    if (route.name !== "runs") {
      return;
    }

    const search = new URLSearchParams();
    if (route.status) {
      search.set("status", route.status);
    }
    if (route.trigger) {
      search.set("trigger", route.trigger);
    }
    if (route.stepKey) {
      search.set("stepKey", route.stepKey);
    }
    search.set("page", String(page));
    navigate(`/runs?${search.toString()}`);
  };

  const error =
    submitError ??
    (route.name === "runs"
      ? runsError
      : route.name === "run" || route.name === "step"
        ? runError
        : overviewError);

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brandBlock">
          <div className="brandMark">V</div>
          <div>
            <div className="brandName">Verge</div>
            <div className="secondaryText">Repository control plane</div>
          </div>
        </div>
        <nav className="topnav">
          <NavLink active={route.name === "overview"} href="/" label="Overview" />
          <NavLink active={route.name === "runs"} href="/runs" label="Runs" />
        </nav>
        <div className="topbarMeta">
          <StatusPill status={activeRunCount > 0 ? "running" : "passed"} />
          <span className="secondaryText">{activeRunCount} active</span>
        </div>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      {route.name === "overview" ? (
        <OverviewPage
          health={health}
          processSpecs={processSpecs}
          commitSha={commitSha}
          branch={branch}
          changedFiles={changedFiles}
          resumeFromCheckpoint={resumeFromCheckpoint}
          submitting={submitting}
          onCommitShaChange={setCommitSha}
          onBranchChange={setBranch}
          onChangedFilesChange={setChangedFiles}
          onResumeFromCheckpointChange={setResumeFromCheckpoint}
          onSubmit={() => void submitManualRun()}
        />
      ) : null}

      {route.name === "runs" ? (
        <RunsPage
          runsPage={runsPage}
          processSpecs={processSpecs}
          draftFilters={draftFilters}
          onDraftFilterChange={(key, value) => {
            setDraftFilters((current) => ({ ...current, [key]: value }));
          }}
          onApplyFilters={applyRunFilters}
          onPageChange={changeRunsPage}
        />
      ) : null}

      {route.name === "run" ? <RunDetailPage run={run} error={error} /> : null}
      {route.name === "step" ? <StepDetailPage run={run} step={step} error={error} /> : null}
    </main>
  );
};
