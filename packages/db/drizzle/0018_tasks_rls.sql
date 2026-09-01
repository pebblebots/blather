-- Least-privilege access controls for tasks exposed through Supabase/PostgREST.
--
-- The application currently uses a single-tenant schema: migration 0010 removed
-- workspace_id and workspace_members. In this schema, a task is relevant to a
-- participant when it is owned/assigned/claimed by them or originated in a
-- channel they belong to. The server's database owner and Supabase's
-- service_role bypass RLS; do not FORCE ROW LEVEL SECURITY, so the existing
-- server-side task path continues to work.

-- Postgres CI databases do not have Supabase's predefined roles, while
-- Supabase does. Create them only for local/vanilla Postgres compatibility.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- Supabase/PostgREST places the authenticated subject in one of these request
-- settings. Keeping this helper in public makes the migration runnable against
-- ordinary Postgres too; it does not trust a client-supplied SQL parameter.
CREATE OR REPLACE FUNCTION public.current_request_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  )
$$;
--> statement-breakpoint

-- Membership checks are security-definer so a caller does not need broad,
-- direct read access to channel_members merely to pass a task policy check.
CREATE OR REPLACE FUNCTION public.is_task_channel_member(p_channel_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_channel_id IS NOT NULL
     AND p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.channel_members cm
       WHERE cm.channel_id = p_channel_id
         AND cm.user_id = p_user_id
     )
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_request_user_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_request_user_id() TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_task_channel_member(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_task_channel_member(uuid, uuid) TO authenticated;
--> statement-breakpoint

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tasks_select_authenticated_relevant ON public.tasks;
--> statement-breakpoint
DROP POLICY IF EXISTS tasks_insert_authenticated_actor ON public.tasks;
--> statement-breakpoint
DROP POLICY IF EXISTS tasks_update_authenticated_actor ON public.tasks;
--> statement-breakpoint
DROP POLICY IF EXISTS tasks_delete_authenticated_actor ON public.tasks;
--> statement-breakpoint

-- A participant can see only tasks they own/operate or tasks from a channel
-- they belong to. Tasks with no source channel are not globally enumerable.
CREATE POLICY tasks_select_authenticated_relevant
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    public.current_request_user_id() IS NOT NULL
    AND (
      creator_id = public.current_request_user_id()
      OR assignee_id = public.current_request_user_id()
      OR claimed_by_id = public.current_request_user_id()
      OR public.is_task_channel_member(source_channel_id, public.current_request_user_id())
    )
  );
--> statement-breakpoint

-- A direct client may create only a task attributed to itself. If it supplies
-- a channel or assignee, both must remain inside that task's channel scope.
CREATE POLICY tasks_insert_authenticated_actor
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    creator_id = public.current_request_user_id()
    AND (
      source_channel_id IS NULL
      OR public.is_task_channel_member(source_channel_id, public.current_request_user_id())
    )
    AND (
      (
        source_channel_id IS NULL
        AND (assignee_id IS NULL OR assignee_id = public.current_request_user_id())
      )
      OR (
        source_channel_id IS NOT NULL
        AND (assignee_id IS NULL OR public.is_task_channel_member(source_channel_id, assignee_id))
      )
    )
  );
--> statement-breakpoint

-- Existing task actors may update. Channel membership alone is deliberately
-- not enough to mutate a task: it grants visibility, not write authority.
-- The WITH CHECK also prevents an update from producing an unowned row.
CREATE POLICY tasks_update_authenticated_actor
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    public.current_request_user_id() IS NOT NULL
    AND (
      creator_id = public.current_request_user_id()
      OR assignee_id = public.current_request_user_id()
      OR claimed_by_id = public.current_request_user_id()
    )
  )
  WITH CHECK (
    public.current_request_user_id() IS NOT NULL
    AND (
      creator_id = public.current_request_user_id()
      OR assignee_id = public.current_request_user_id()
      OR claimed_by_id = public.current_request_user_id()
      -- A claimant must be able to finish/requeue a task. The USING clause
      -- already authenticated that claimant against the old row; clearing a
      -- claim is a legitimate state transition and intentionally removes the
      -- claimant from the new-row authorization expression.
      OR (claimed_by_id IS NULL AND status IN ('queued', 'done'))
    )
    AND (
      source_channel_id IS NULL
      OR assignee_id IS NULL
      OR public.is_task_channel_member(source_channel_id, assignee_id)
    )
  );
--> statement-breakpoint

-- Deletion is intentionally limited to the same task actors as updates.
CREATE POLICY tasks_delete_authenticated_actor
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    public.current_request_user_id() IS NOT NULL
    AND (
      creator_id = public.current_request_user_id()
      OR assignee_id = public.current_request_user_id()
      OR claimed_by_id = public.current_request_user_id()
    )
  );
--> statement-breakpoint

-- Supabase commonly grants PUBLIC/anon/authenticated privileges during table
-- creation. REVOKE first: GRANT is additive, so column-scoped grants alone do
-- not remove an existing table-wide UPDATE privilege. The API server uses the
-- database owner and therefore remains unaffected by these client grants.
REVOKE ALL PRIVILEGES ON TABLE public.tasks FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SEQUENCE public.tasks_short_id_seq FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Do not grant table-wide INSERT/UPDATE: that would let a direct client
-- rewrite authorization columns (creator_id, source_channel_id, claimed_by_id)
-- or server-maintained metadata.
GRANT SELECT, DELETE ON public.tasks TO authenticated;
--> statement-breakpoint
GRANT INSERT (
  title, description, priority, assignee_id, creator_id, source_channel_id
) ON public.tasks TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
  title, description, priority, status, assignee_id, completion_artifact
) ON public.tasks TO authenticated;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.tasks_short_id_seq TO authenticated;
--> statement-breakpoint

COMMENT ON TABLE public.tasks IS
  'RLS: authenticated channel participants and task actors only; server/service_role bypasses RLS.';
--> statement-breakpoint
