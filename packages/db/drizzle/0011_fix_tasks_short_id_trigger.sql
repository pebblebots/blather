-- Fix tasks_set_short_id trigger: remove workspace_id reference
-- The 0010 migration dropped workspace_id from tasks but didn't update this trigger

CREATE OR REPLACE FUNCTION public.tasks_set_short_id()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.short_id IS NULL THEN
    SELECT COALESCE(MAX(short_id), 0) + 1 INTO NEW.short_id
    FROM tasks;
  END IF;
  RETURN NEW;
END;
$function$;
