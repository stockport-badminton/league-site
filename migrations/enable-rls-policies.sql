-- Enable RLS on all public tables and create a permissive policy for postgres role
-- Since all DB access goes through one connection (DATABASE_URL postgres user),
-- we just need RLS enabled + a policy that allows postgres role full access

DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    -- Enable RLS on table
    EXECUTE 'ALTER TABLE ' || table_record.tablename || ' ENABLE ROW LEVEL SECURITY;';
    RAISE NOTICE 'Enabled RLS on table: %', table_record.tablename;

    -- Drop existing policy if it exists
    EXECUTE 'DROP POLICY IF EXISTS postgres_full_access ON ' || table_record.tablename || ';';

    -- Create policy that allows postgres role full access (SELECT, INSERT, UPDATE, DELETE)
    EXECUTE 'CREATE POLICY postgres_full_access ON ' || table_record.tablename ||
            ' FOR ALL USING (auth.role() = ''postgres'') WITH CHECK (auth.role() = ''postgres'');';
    RAISE NOTICE 'Created full access policy for postgres role on: %', table_record.tablename;
  END LOOP;
END $$;
