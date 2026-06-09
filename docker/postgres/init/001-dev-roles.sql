DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mirador_app') THEN
    CREATE ROLE mirador_app LOGIN PASSWORD 'mirador_app_dev';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mirador_readonly') THEN
    CREATE ROLE mirador_readonly LOGIN PASSWORD 'mirador_readonly_dev';
  END IF;
END
$$;
