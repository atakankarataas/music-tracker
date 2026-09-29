-- Extended Streaming History includes Private Session flags. Unknown API-only
-- flags stay NULL; ordinary archive views still include private listening.
ALTER TABLE public.scrobbles ADD COLUMN incognito_mode boolean;
