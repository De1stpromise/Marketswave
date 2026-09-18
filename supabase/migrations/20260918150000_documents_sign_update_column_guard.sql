-- ★ Live vulnerability closed ahead of Task C (2026-09-18, register row 248).
--
-- THE FINDING, proven on the real policy with a throwaway client, not reasoned: the one
-- client UPDATE policy on public.documents ("clients can sign their own from-marketswave
-- documents") constrains the RESULTING ROW's named columns only — status, is_new,
-- deadline_label, direction, client_id. RLS has no column-level form, so a client's "Sign"
-- UPDATE carrying filename / category / storage_path / created_at rewrites succeeded: 1 row,
-- every rewrite landed. A client could redefine what the firm-published document IS in the
-- act of signing it — repoint its storage_path at any object in their own folder, rename it,
-- recategorise it, backdate it.
--
-- THE FIX: a BEFORE UPDATE trigger does what column-level RLS cannot. For a caller in the
-- `authenticated` role it raises if ANY column other than status / is_new / deadline_label
-- differs from OLD. The comparison is to_jsonb(OLD) minus those three keys against the same
-- projection of NEW, so a column added to this table later is protected BY DEFAULT rather than
-- by remembering to add it to a list.
--
-- WHY `authenticated` IS THE RIGHT KEY, checked not assumed: an admin JWT has NO update policy
-- on documents at all (admins only SELECT; every admin write is a service_role Edge Function —
-- update-document, publish-document), so any UPDATE that reaches this trigger under the
-- authenticated role IS a client's Sign transition. service_role bypasses RLS and is exempt
-- here by construction, which is exactly what update-document's generic column patch and Task
-- C's own status flip need.
--
-- This closes the rewrite today without touching the Sign button. Task C then DROPS the
-- client UPDATE policy entirely once signing runs through sign-document; this trigger stays
-- as defence in depth against that policy — or any future client UPDATE policy — coming back.
create or replace function public.documents_client_update_column_guard()
returns trigger
language plpgsql
as $$
declare
  guarded_old jsonb;
  guarded_new jsonb;
begin
  if auth.role() = 'authenticated' then
    guarded_old := to_jsonb(old) - 'status' - 'is_new' - 'deadline_label';
    guarded_new := to_jsonb(new) - 'status' - 'is_new' - 'deadline_label';
    if guarded_old is distinct from guarded_new then
      raise exception 'documents: a client may change only status, is_new and deadline_label'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_client_update_column_guard on public.documents;
create trigger documents_client_update_column_guard
  before update on public.documents
  for each row execute function public.documents_client_update_column_guard();
