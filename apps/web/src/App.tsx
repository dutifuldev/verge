import { useEffect, useMemo, useState } from "react";

import type { RepositorySummary } from "@verge/contracts";

import { NavLink, StatusPill } from "./components/common.js";
import { useAppRoute } from "./hooks/use-app-route.js";
import { useOverviewData } from "./hooks/use-overview-data.js";
import { useRunDetailData } from "./hooks/use-run-detail-data.js";
import { useRunsPageData } from "./hooks/use-runs-page-data.js";
import {
  buildRepositoryOverviewPath,
  buildRepositoryRunsPath,
  buildRunPath,
  buildStepPath,
  navigate,
} from "./lib/routing.js";
import { statusTone } from "./lib/format.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { StepDetailPage } from "./pages/StepDetailPage.js";
import { fetchJson } from "./lib/api.js";

export { statusTone } from "./lib/format.js";

export const App = () => {
  const route = useAppRoute();
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [preferredRepositorySlug, setPreferredRepositorySlug] = useState<string | null>(null);
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null);
  const currentRepositorySlug = route.repositorySlug ?? preferredRepositorySlug;
  const { health, processSpecs, error: overviewError } = useOverviewData(currentRepositorySlug);
  const { runsPage, error: runsError } = useRunsPageData(route, currentRepositorySlug);
  const { run, treemap, step, error: runError, treemapError } = useRunDetailData(route);

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
    void (async () => {
      try {
        const nextRepositories = await fetchJson<RepositorySummary[]>("/repositories");
        setRepositories(nextRepositories);
        setRepositoriesError(null);
        setPreferredRepositorySlug((current) => {
          const stored =
            current ??
            window.localStorage.getItem("verge:selectedRepositorySlug") ??
            nextRepositories[0]?.slug ??
            null;

          if (stored && nextRepositories.some((repository) => repository.slug === stored)) {
            return stored;
          }

          return nextRepositories[0]?.slug ?? null;
        });
      } catch (error) {
        setRepositoriesError(
          error instanceof Error ? error.message : "Failed to load repositories",
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!preferredRepositorySlug) {
      return;
    }

    window.localStorage.setItem("verge:selectedRepositorySlug", preferredRepositorySlug);
  }, [preferredRepositorySlug]);

  useEffect(() => {
    if (route.repositorySlug) {
      return;
    }

    const fallbackRepositorySlug =
      run?.repositorySlug ?? preferredRepositorySlug ?? repositories[0]?.slug ?? null;

    if (!fallbackRepositorySlug) {
      return;
    }

    if (route.name === "overview") {
      navigate(buildRepositoryOverviewPath(fallbackRepositorySlug));
      return;
    }

    if (route.name === "runs") {
      navigate(
        buildRepositoryRunsPath(fallbackRepositorySlug, {
          page: route.page,
          status: route.status,
          trigger: route.trigger,
          stepKey: route.stepKey,
        }),
      );
      return;
    }

    if (route.name === "run") {
      navigate(buildRunPath(fallbackRepositorySlug, route.runId));
      return;
    }

    navigate(buildStepPath(fallbackRepositorySlug, route.runId, route.stepId));
  }, [preferredRepositorySlug, repositories, route, run?.repositorySlug]);

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
  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.slug === currentRepositorySlug) ?? null,
    [currentRepositorySlug, repositories],
  );
  const selectedRepositorySlug = selectedRepository?.slug ?? null;

  const submitManualRun = async (): Promise<void> => {
    if (!selectedRepositorySlug) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetchJson<{ runId: string; stepRunIds: string[] }>("/runs/manual", {
        method: "POST",
        body: JSON.stringify({
          repositorySlug: selectedRepositorySlug,
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
        navigate(buildRunPath(selectedRepositorySlug, response.runId));
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to start run");
    } finally {
      setSubmitting(false);
    }
  };

  const applyRunFilters = (): void => {
    if (!selectedRepositorySlug) {
      return;
    }

    navigate(
      buildRepositoryRunsPath(selectedRepositorySlug, {
        page: 1,
        status: draftFilters.status,
        trigger: draftFilters.trigger,
        stepKey: draftFilters.stepKey,
      }),
    );
  };

  const changeRunsPage = (page: number): void => {
    if (route.name !== "runs" || !selectedRepositorySlug) {
      return;
    }

    navigate(
      buildRepositoryRunsPath(selectedRepositorySlug, {
        page,
        status: route.status,
        trigger: route.trigger,
        stepKey: route.stepKey,
      }),
    );
  };

  const navigateToRepository = (nextRepositorySlug: string): void => {
    setPreferredRepositorySlug(nextRepositorySlug);

    if (route.name === "overview") {
      navigate(buildRepositoryOverviewPath(nextRepositorySlug));
      return;
    }

    if (route.name === "runs") {
      navigate(
        buildRepositoryRunsPath(nextRepositorySlug, {
          page: route.page,
          status: route.status,
          trigger: route.trigger,
          stepKey: route.stepKey,
        }),
      );
      return;
    }

    navigate(buildRepositoryRunsPath(nextRepositorySlug));
  };

  const error =
    repositoriesError ??
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
          <div className="brandPath">
            <span className="brandName">Verge</span>
            <span className="brandSlash">/</span>
            <select
              className="repoPicker"
              aria-label="Repository"
              value={selectedRepositorySlug ?? ""}
              onChange={(event) => {
                const nextRepositorySlug = event.target.value;
                if (!nextRepositorySlug) {
                  return;
                }

                navigateToRepository(nextRepositorySlug);
              }}
            >
              {repositories.map((repository) => (
                <option key={repository.slug} value={repository.slug}>
                  {repository.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <nav className="topnav">
          <NavLink
            active={route.name === "overview"}
            href={
              selectedRepositorySlug ? buildRepositoryOverviewPath(selectedRepositorySlug) : "/"
            }
            label="Overview"
          />
          <NavLink
            active={route.name === "runs"}
            href={
              selectedRepositorySlug ? buildRepositoryRunsPath(selectedRepositorySlug) : "/runs"
            }
            label="Runs"
          />
        </nav>
        <div className="topbarMeta">
          <StatusPill status={activeRunCount > 0 ? "running" : "passed"} />
          <span className="secondaryText">{activeRunCount} active</span>
        </div>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      {route.name === "overview" ? (
        <OverviewPage
          repositorySlug={selectedRepositorySlug}
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
          repositorySlug={selectedRepositorySlug}
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

      {route.name === "run" ? (
        <RunDetailPage run={run} treemap={treemap} treemapError={treemapError} error={error} />
      ) : null}
      {route.name === "step" ? <StepDetailPage run={run} step={step} error={error} /> : null}
    </main>
  );
};
