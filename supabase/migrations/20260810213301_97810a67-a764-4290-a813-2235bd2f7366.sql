INSERT INTO public.classes (module_key, room, instructor, starts_at, capacity, duration_min, tokens_cost, active)
SELECT x.module_key, x.room, x.instructor,
       (date_trunc('day', now() at time zone 'America/Monterrey') + (d || ' days')::interval + x.hour) at time zone 'America/Monterrey',
       x.capacity, x.duration_min, x.tokens_cost, true
FROM generate_series(0, 13) AS d
CROSS JOIN (VALUES
  ('reformer','Reformer Studio','Lore', interval '7 hours', 10, 50, 1),
  ('reformer','Reformer Studio','Ana', interval '9 hours', 10, 50, 1),
  ('reformer','Reformer Studio','Lore', interval '18 hours', 10, 50, 1),
  ('reformer','Reformer Studio','Ana', interval '19 hours 30 minutes', 10, 50, 1),
  ('contraste','Contrast Room','Equipo Läätu', interval '8 hours 30 minutes', 4, 45, 1),
  ('contraste','Contrast Room','Equipo Läätu', interval '20 hours', 4, 45, 1)
) AS x(module_key, room, instructor, hour, capacity, duration_min, tokens_cost)
WHERE EXTRACT(dow FROM (now() at time zone 'America/Monterrey')::date + d) NOT IN (0);

INSERT INTO public.classes (module_key, room, instructor, starts_at, capacity, duration_min, tokens_cost, active)
SELECT x.module_key, x.room, x.instructor,
       (date_trunc('day', now() at time zone 'America/Monterrey') + (d || ' days')::interval + x.hour) at time zone 'America/Monterrey',
       1, x.duration_min, x.tokens_cost, true
FROM generate_series(0, 13) AS d
CROSS JOIN (VALUES
  ('nutricion','Consultorio','Nutrición Läätu', interval '11 hours', 60, 2),
  ('psicologia','Consultorio','Psicología Läätu', interval '16 hours', 60, 2),
  ('rehabilitacion','Consultorio','Fisioterapia Läätu', interval '13 hours', 60, 2)
) AS x(module_key, room, instructor, hour, duration_min, tokens_cost)
WHERE EXTRACT(dow FROM (now() at time zone 'America/Monterrey')::date + d) IN (1,3,5);