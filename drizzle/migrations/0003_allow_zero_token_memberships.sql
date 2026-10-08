ALTER TABLE public.token_plans DROP CONSTRAINT IF EXISTS token_plans_tokens_check;
ALTER TABLE public.token_plans ADD CONSTRAINT token_plans_tokens_check CHECK (tokens >= 0);