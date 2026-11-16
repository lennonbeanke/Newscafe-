-- 0010: the PUBLIC API process holds only the public database login, which has no table access. It still has to confirm that the
-- database it is connected to is the development database (and refuse anything else). This one-purpose function lets it read the
-- environment label (a single word) without any table privilege. Migrations 0001-0009 are unchanged.
CREATE FUNCTION public_environment() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT env FROM app_environment $$;
ALTER FUNCTION public_environment() OWNER TO newscafe_definer;
GRANT EXECUTE ON FUNCTION public_environment() TO newscafe_public, newscafe_admin;
