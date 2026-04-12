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
