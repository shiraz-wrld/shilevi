-- Shilevi migration 0008: customer account settings and deletion requests.
-- Manual review and execution only. This file has not been run against a live Supabase project.
begin;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'pending' check (status in ('pending','in_review','completed','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  resolution_note text,
  constraint deletion_resolution_note_length check (resolution_note is null or char_length(resolution_note) <= 1000),
  constraint deletion_resolution_consistency check (
    (status in ('pending','in_review') and processed_at is null)
    or (status in ('completed','rejected','cancelled') and processed_at is not null)
  )
);

create unique index if not exists account_deletion_one_open_request_per_user
  on public.account_deletion_requests(user_id)
  where status in ('pending','in_review');

create index if not exists account_deletion_requests_user_requested_idx
  on public.account_deletion_requests(user_id, requested_at desc);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select, insert on public.account_deletion_requests to authenticated;

drop policy if exists "account_deletion_request_select_own" on public.account_deletion_requests;
create policy "account_deletion_request_select_own" on public.account_deletion_requests
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "account_deletion_request_insert_own" on public.account_deletion_requests;
create policy "account_deletion_request_insert_own" on public.account_deletion_requests
for insert to authenticated with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and processed_at is null
  and resolution_note is null
);

-- Ordinary users cannot change request status or erase the audit trail.
-- A future owner-only processing workflow must update these rows using its own guarded policy.
commit;
