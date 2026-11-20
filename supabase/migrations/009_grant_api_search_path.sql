-- Security advisor: private.grant_api had no fixed search_path. Pin it (names are already schema-qualified by regprocedure).
ALTER FUNCTION private.grant_api(regprocedure, text) SET search_path = '';
