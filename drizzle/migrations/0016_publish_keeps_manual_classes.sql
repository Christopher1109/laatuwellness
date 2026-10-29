-- "Actualizar clases" ya no apaga las clases agregadas o cambiadas a mano
-- (manual_override). Antes, una clase creada desde Horarios de clases que no
-- estaba en el horario semanal se desactivaba al publicar.
DO $migration$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.publish_schedule_range(text, date, date)'::regprocedure);
  IF position('AND NOT c.manual_override' in v_def) = 0 THEN
    v_def := replace(v_def,
      E'  UPDATE public.classes c\n  SET active = false\n  WHERE c.module_key = _module_key\n    AND c.active\n',
      E'  UPDATE public.classes c\n  SET active = false\n  WHERE c.module_key = _module_key\n    AND c.active\n    AND NOT c.manual_override\n');
    IF position('AND NOT c.manual_override' in v_def) = 0 THEN
      RAISE EXCEPTION 'publish_schedule_range no tiene el formato esperado';
    END IF;
    EXECUTE v_def;
  END IF;
END $migration$;
