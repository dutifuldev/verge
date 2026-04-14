import { useEffect, useMemo, useState } from "react";

import type { RepositorySummary } from "@verge/contracts";

import { NavLink } from "./components/common.js";
import { useAppRoute } from "./hooks/use-app-route.js";
import { useCommitListData } from "./hooks/use-commit-list-data.js";
import { useCommitDetailData } from "./hooks/use-commit-detail-data.js";
import { useRunDetailData } from "./hooks/use-run-detail-data.js";
import { useRunsPageData } from "./hooks/use-runs-page-data.js";
import { useStepSpecs } from "./hooks/use-step-specs.js";
import {
  buildCommitPath,
  buildRepositoryCommitsPath,
  buildRepositoryRunsPath,
  buildRunPath,
  buildStepPath,
  navigate,
} from "./lib/routing.js";
import { statusTone } from "./lib/format.js";
import { CommitsPage } from "./pages/CommitsPage.js";
import { CommitDetailPage } from "./pages/CommitDetailPage.js";
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
  const { commitsPage, error: commitsError } = useCommitListData(route, currentRepositorySlug);
  const { stepSpecs, error: stepSpecsError } = useStepSpecs(currentRepositorySlug);
  const { runsPage, error: runsError } = useRunsPageData(route, currentRepositorySlug);
  const { run, treemap, step, error: runError, treemapError } = useRunDetailData(route);
  const {
    commit,
    treemap: commitTreemap,
    error: commitError,
    treemapError: commitTreemapError,
  } = useCommitDetailData(route);
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

    if (route.name === "commits") {
      navigate(buildRepositoryCommitsPath(fallbackRepositorySlug, { page: route.page }));
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

    if (route.name === "commit") {
      navigate(buildCommitPath(fallbackRepositorySlug, route.commitSha));
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

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.slug === currentRepositorySlug) ?? null,
    [currentRepositorySlug, repositories],
  );
  const selectedRepositorySlug = selectedRepository?.slug ?? null;

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

  const changeCommitsPage = (page: number): void => {
    if (route.name !== "commits" || !selectedRepositorySlug) {
      return;
    }

    navigate(buildRepositoryCommitsPath(selectedRepositorySlug, { page }));
  };

  const navigateToRepository = (nextRepositorySlug: string): void => {
    setPreferredRepositorySlug(nextRepositorySlug);

    if (route.name === "commits") {
      navigate(buildRepositoryCommitsPath(nextRepositorySlug, { page: route.page }));
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

    if (route.name === "commit") {
      navigate(buildCommitPath(nextRepositorySlug, route.commitSha));
      return;
    }

    navigate(buildRepositoryRunsPath(nextRepositorySlug));
  };

  const error =
    repositoriesError ??
    (route.name === "runs"
      ? (stepSpecsError ?? runsError)
      : route.name === "run" || route.name === "step"
        ? runError
        : route.name === "commit"
          ? commitError
          : commitsError);

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
            active={route.name === "commits" || route.name === "commit"}
            href={selectedRepositorySlug ? buildRepositoryCommitsPath(selectedRepositorySlug) : "/"}
            label="Commits"
          />
          <NavLink
            active={route.name === "runs" || route.name === "run" || route.name === "step"}
            href={
              selectedRepositorySlug ? buildRepositoryRunsPath(selectedRepositorySlug) : "/runs"
            }
            label="Runs"
          />
        </nav>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      {route.name === "commits" ? (
        <CommitsPage
          repositorySlug={selectedRepositorySlug}
          commitsPage={commitsPage}
          onPageChange={changeCommitsPage}
        />
      ) : null}

      {route.name === "runs" ? (
        <RunsPage
          repositorySlug={selectedRepositorySlug}
          runsPage={runsPage}
          processSpecs={stepSpecs}
          draftFilters={draftFilters}
          onDraftFilterChange={(key, value) => {
            setDraftFilters((current) => ({ ...current, [key]: value }));
          }}
          onApplyFilters={applyRunFilters}
          onPageChange={changeRunsPage}
        />
      ) : null}

      {route.name === "commit" ? (
        <CommitDetailPage
          commit={commit}
          treemap={commitTreemap}
          treemapError={commitTreemapError}
          error={error}
        />
      ) : null}

      {route.name === "run" ? (
        <RunDetailPage run={run} treemap={treemap} treemapError={treemapError} error={error} />
      ) : null}
      {route.name === "step" ? <StepDetailPage run={run} step={step} error={error} /> : null}
    </main>
  );
};
