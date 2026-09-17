
DELETE FROM public.classes c
WHERE c.active = false
  AND c.starts_at > now()
  AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.class_id = c.id);

WITH dups AS (
  SELECT c.id,
         row_number() OVER (
           PARTITION BY c.module_key, c.starts_at
           ORDER BY (SELECT count(*) FROM public.bookings b WHERE b.class_id = c.id) DESC, c.created_at
         ) rn
  FROM public.classes c
  WHERE c.active AND c.starts_at > now()
)
DELETE FROM public.classes
WHERE id IN (
  SELECT d.id FROM dups d
  WHERE d.rn > 1
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.class_id = d.id)
);
