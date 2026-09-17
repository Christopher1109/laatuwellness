
-- 1) Desactivar clases duplicadas (mismo módulo, hora, salón y coach) sin reservas
WITH dups AS (
  SELECT c.id,
         row_number() OVER (
           PARTITION BY c.module_key, c.starts_at, c.room, c.coach_id
           ORDER BY (SELECT count(*) FROM public.bookings b WHERE b.class_id = c.id) DESC, c.created_at
         ) rn
  FROM public.classes c
  WHERE c.active AND c.starts_at > now()
)
UPDATE public.classes SET active = false
WHERE id IN (
  SELECT d.id FROM dups d
  WHERE d.rn > 1
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.class_id = d.id AND b.status <> 'cancelled')
);

-- 2) Horario público de un coach, resolviendo el nombre contra staff_profiles
CREATE OR REPLACE FUNCTION public.coach_public_schedule(_coach_name text, _days integer DEFAULT 7)
RETURNS TABLE (id uuid, starts_at timestamptz, room text, module_key text, capacity integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.starts_at, c.room, c.module_key, c.capacity
  FROM public.classes c
  JOIN public.staff_profiles s ON s.id = c.coach_id
  JOIN public.site_modules m ON m.key = c.module_key AND m.enabled
  WHERE c.active
    AND c.starts_at > now()
    AND c.starts_at < now() + make_interval(days => COALESCE(_days, 7))
    AND (s.full_name ILIKE _coach_name OR c.instructor ILIKE _coach_name)
  ORDER BY c.starts_at
$$;

GRANT EXECUTE ON FUNCTION public.coach_public_schedule(text, integer) TO anon, authenticated;
