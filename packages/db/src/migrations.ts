import { sql, type Kysely } from "kysely";

export type SchemaMigration = {
  id: string;
  sql: string;
};

export const schemaMigrations: SchemaMigration[] = [
  {
    id: "001_initial_schema",
    sql: `
      create table if not exists repositories (
        id uuid primary key,
        slug text not null unique,
        display_name text not null,
        root_path text not null,
        default_branch text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists repo_areas (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        key text not null,
        display_name text not null,
        created_at timestamptz not null default now(),
        unique (repository_id, key)
      );

      create table if not exists process_specs (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        key text not null,
        display_name text not null,
        description text not null,
        kind text not null,
        base_command jsonb not null,
        cwd text not null,
        observed_area_keys jsonb not null,
        materialization jsonb not null,
        reuse_enabled boolean not null default false,
        checkpoint_enabled boolean not null default false,
        always_run boolean not null default false,
        created_at timestamptz not null default now(),
        unique (repository_id, key)
      );

      create table if not exists processes (
        id uuid primary key,
        process_spec_id uuid not null references process_specs(id) on delete cascade,
        key text not null,
        label text not null,
        type text not null,
        metadata jsonb not null,
        created_at timestamptz not null default now(),
        unique (process_spec_id, key)
      );

      create table if not exists event_ingestions (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        source text not null,
        delivery_id text not null,
        event_name text not null,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        unique (repository_id, source, delivery_id)
      );

      create table if not exists run_requests (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        event_ingestion_id uuid references event_ingestions(id) on delete set null,
        trigger text not null,
        commit_sha text not null,
        branch text,
        pull_request_number integer,
        changed_files jsonb not null,
        status text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists runs (
        id uuid primary key,
        run_request_id uuid not null references run_requests(id) on delete cascade,
        process_spec_id uuid not null references process_specs(id) on delete cascade,
        fingerprint text not null,
        status text not null,
        plan_reason text not null,
        reused_from_run_id uuid references runs(id),
        checkpoint_source_run_id uuid references runs(id),
        created_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz
      );

      create table if not exists run_processes (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        process_key text not null,
        process_label text not null,
        process_type text not null,
        status text not null,
        selection_payload jsonb not null,
        attempt_count integer not null default 0,
        claimed_by text,
        lease_expires_at timestamptz,
        last_heartbeat_at timestamptz,
        created_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz
      );

      create table if not exists run_events (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        run_process_id uuid references run_processes(id) on delete cascade,
        kind text not null,
        message text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists observations (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        run_process_id uuid references run_processes(id) on delete cascade,
        process_key text,
        area_key text,
        status text not null,
        summary jsonb not null,
        execution_scope jsonb not null,
        observed_at timestamptz not null default now()
      );

      create table if not exists run_artifacts (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        run_process_id uuid references run_processes(id) on delete cascade,
        artifact_key text not null,
        storage_path text not null,
        media_type text not null,
        metadata jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists run_checkpoints (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        process_spec_id uuid not null references process_specs(id) on delete cascade,
        fingerprint text not null,
        completed_process_keys jsonb not null,
        pending_process_keys jsonb not null,
        storage_path text,
        created_at timestamptz not null default now(),
        resumable_until timestamptz not null
      );

      create table if not exists area_freshness_state (
        id uuid primary key,
        repo_area_id uuid not null references repo_areas(id) on delete cascade unique,
        latest_status text not null,
        freshness_bucket text not null,
        last_observed_at timestamptz,
        last_successful_observed_at timestamptz,
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_run_requests_repository_commit on run_requests(repository_id, commit_sha);
      create index if not exists idx_run_requests_repository_pr on run_requests(repository_id, pull_request_number);
      create index if not exists idx_runs_request on runs(run_request_id);
      create index if not exists idx_run_processes_status on run_processes(status, lease_expires_at);
      create index if not exists idx_observations_run on observations(run_id, observed_at);
      create index if not exists idx_checkpoints_spec_fingerprint on run_checkpoints(process_spec_id, fingerprint, created_at desc);
    `,
  },
  {
    id: "002_run_step_process_cutover",
    sql: `
      drop table if exists checkpoints cascade;
      drop table if exists artifacts cascade;
      drop table if exists observations cascade;
      drop table if exists run_events cascade;
      drop table if exists process_runs cascade;
      drop table if exists step_runs cascade;
      drop table if exists runs cascade;
      drop table if exists event_ingestions cascade;
      drop table if exists processes cascade;
      drop table if exists step_specs cascade;
      drop table if exists repo_area_state cascade;
      drop table if exists repo_areas cascade;
      drop table if exists repositories cascade;

      drop table if exists run_checkpoints cascade;
      drop table if exists run_artifacts cascade;
      drop table if exists observations cascade;
      drop table if exists run_events cascade;
      drop table if exists run_processes cascade;
      drop table if exists runs cascade;
      drop table if exists run_requests cascade;
      drop table if exists event_ingestions cascade;
      drop table if exists processes cascade;
      drop table if exists process_specs cascade;
      drop table if exists area_freshness_state cascade;
      drop table if exists repo_areas cascade;
      drop table if exists repositories cascade;

      create table if not exists repositories (
        id uuid primary key,
        slug text not null unique,
        display_name text not null,
        root_path text not null,
        default_branch text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists repo_areas (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        key text not null,
        display_name text not null,
        path_prefixes jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        unique (repository_id, key)
      );

      create table if not exists step_specs (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        key text not null,
        display_name text not null,
        description text not null,
        kind text not null,
        base_command jsonb not null,
        cwd text not null,
        observed_area_keys jsonb not null,
        materialization jsonb not null,
        reuse_enabled boolean not null default false,
        checkpoint_enabled boolean not null default false,
        always_run boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (repository_id, key)
      );

      create table if not exists processes (
        id uuid primary key,
        step_spec_id uuid not null references step_specs(id) on delete cascade,
        key text not null,
        display_name text not null,
        kind text not null,
        file_path text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (step_spec_id, key)
      );

      create table if not exists event_ingestions (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        source text not null,
        delivery_id text not null,
        event_name text not null,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        unique (repository_id, source, delivery_id)
      );

      create table if not exists runs (
        id uuid primary key,
        repository_id uuid not null references repositories(id) on delete cascade,
        event_ingestion_id uuid references event_ingestions(id) on delete set null,
        trigger text not null,
        commit_sha text not null,
        commit_title text,
        branch text,
        pull_request_number integer,
        changed_files jsonb not null,
        status text not null,
        created_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz
      );

      create table if not exists step_runs (
        id uuid primary key,
        run_id uuid not null references runs(id) on delete cascade,
        step_spec_id uuid references step_specs(id) on delete set null,
        step_key text not null,
        display_name text not null,
        kind text not null,
        base_command jsonb not null,
        cwd text not null,
        observed_area_keys jsonb not null,
        materialization jsonb not null,
        checkpoint_enabled boolean not null default false,
        config_fingerprint text not null,
        fingerprint text not null,
        status text not null,
        plan_reason text not null,
        reused_from_step_run_id uuid references step_runs(id),
        checkpoint_source_step_run_id uuid references step_runs(id),
        created_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz,
        unique (run_id, step_key)
      );

      create table if not exists process_runs (
        id uuid primary key,
        step_run_id uuid not null references step_runs(id) on delete cascade,
        process_id uuid references processes(id) on delete set null,
        process_key text not null,
        display_name text not null,
        kind text not null,
        file_path text,
        metadata jsonb not null default '{}'::jsonb,
        selection_payload jsonb not null default '{}'::jsonb,
        status text not null,
        attempt_count integer not null default 0,
        claimed_by text,
        lease_expires_at timestamptz,
        last_heartbeat_at timestamptz,
        created_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz,
        unique (step_run_id, process_key)
      );

      create table if not exists run_events (
        id uuid primary key,
        step_run_id uuid not null references step_runs(id) on delete cascade,
        process_run_id uuid references process_runs(id) on delete cascade,
        kind text not null,
        message text not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create table if not exists observations (
        id uuid primary key,
        step_run_id uuid not null references step_runs(id) on delete cascade,
        process_run_id uuid references process_runs(id) on delete cascade,
        process_id uuid references processes(id) on delete set null,
        process_key text,
        area_key text,
        status text not null,
        summary jsonb not null default '{}'::jsonb,
        execution_scope jsonb not null default '{}'::jsonb,
        observed_at timestamptz not null default now()
      );

      create table if not exists artifacts (
        id uuid primary key,
        step_run_id uuid not null references step_runs(id) on delete cascade,
        process_run_id uuid references process_runs(id) on delete cascade,
        artifact_key text not null,
        storage_path text not null,
        media_type text not null,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create table if not exists checkpoints (
        id uuid primary key,
        step_run_id uuid not null references step_runs(id) on delete cascade,
        step_spec_id uuid references step_specs(id) on delete set null,
        step_key text not null,
        fingerprint text not null,
        completed_process_keys jsonb not null,
        pending_process_keys jsonb not null,
        storage_path text,
        created_at timestamptz not null default now(),
        resumable_until timestamptz not null
      );

      create table if not exists repo_area_state (
        repo_area_id uuid primary key references repo_areas(id) on delete cascade,
        latest_status text not null,
        freshness_bucket text not null,
        last_observed_at timestamptz,
        last_successful_observed_at timestamptz,
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_repo_areas_repository_key on repo_areas(repository_id, key);
      create index if not exists idx_step_specs_repository_key on step_specs(repository_id, key);
      create index if not exists idx_processes_step_spec_key on processes(step_spec_id, key);
      create index if not exists idx_runs_repository_created on runs(repository_id, created_at desc);
      create index if not exists idx_runs_repository_commit on runs(repository_id, commit_sha);
      create index if not exists idx_runs_repository_pr on runs(repository_id, pull_request_number);
      create index if not exists idx_step_runs_run on step_runs(run_id, created_at asc);
      create index if not exists idx_step_runs_fingerprint on step_runs(step_key, fingerprint, created_at desc);
      create index if not exists idx_process_runs_status on process_runs(status, lease_expires_at);
      create index if not exists idx_process_runs_step on process_runs(step_run_id, status);
      create index if not exists idx_observations_step on observations(step_run_id, observed_at);
      create index if not exists idx_checkpoints_step_fingerprint on checkpoints(step_key, fingerprint, created_at desc);
    `,
  },
  {
    id: "003_duration_columns",
    sql: `
      alter table runs add column if not exists duration_ms integer;
      alter table step_runs add column if not exists duration_ms integer;
      alter table process_runs add column if not exists duration_ms integer;
    `,
  },
  {
    id: "004_commit_process_state",
    sql: `
      create table if not exists commit_process_state (
        repository_id uuid not null references repositories(id) on delete cascade,
        commit_sha text not null,
        step_key text not null,
        step_display_name text not null,
        step_kind text not null,
        process_key text not null,
        process_display_name text not null,
        process_kind text not null,
        file_path text,
        selected_run_id uuid not null references runs(id) on delete cascade,
        selected_step_run_id uuid not null references step_runs(id) on delete cascade,
        selected_process_run_id uuid not null references process_runs(id) on delete cascade,
        status text not null,
        duration_ms integer,
        reused boolean not null default false,
        attempt_count integer not null default 0,
        updated_at timestamptz not null default now(),
        primary key (repository_id, commit_sha, step_key, process_key)
      );

      create index if not exists idx_commit_process_state_repository_commit
        on commit_process_state(repository_id, commit_sha, step_key);
      create index if not exists idx_commit_process_state_selected_run
        on commit_process_state(selected_run_id, selected_step_run_id, selected_process_run_id);
    `,
  },
  {
    id: "005_commit_titles",
    sql: `
      alter table runs add column if not exists commit_title text;
    `,
  },
];

export const runMigrations = async (db: Kysely<any>): Promise<void> => {
  await sql`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `.execute(db);

  const applied = await sql<{ id: string }>`
    select id from schema_migrations
  `.execute(db);

  const appliedIds = new Set(applied.rows.map((row) => row.id));
  for (const migration of schemaMigrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    await sql.raw(migration.sql).execute(db);
    await sql`
      insert into schema_migrations (id)
      values (${migration.id})
    `.execute(db);
  }
};
