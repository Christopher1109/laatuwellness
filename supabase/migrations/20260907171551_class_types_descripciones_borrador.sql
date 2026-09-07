-- ============================================================================
-- Descripciones cortas para los tipos de clase de Reformer y 4mat, para que
-- se puedan mostrar en /programas/reformer y /programas/4mat.
--
-- IMPORTANTE: estas descripciones son TEXTO BORRADOR escrito por Claude, no
-- contenido confirmado por el estudio. Lorena/Doris deben revisarlas y
-- editarlas (por WhatsApp o desde el panel admin) antes de darlas por
-- definitivas — nadie del equipo me dio el contenido real de cada clase.
-- ============================================================================

UPDATE public.class_types SET description =
  CASE name
    WHEN 'Classic Pilates' THEN 'Los fundamentos del método sobre reformer: control, respiración y alineación.'
    WHEN 'Athletic Pilates' THEN 'Ritmo más intenso, con más repeticiones y transiciones dinámicas.'
    WHEN 'Tower Pilates' THEN 'Reformer combinado con torre, para más resistencia y rango de movimiento.'
    WHEN 'Circuit Pilates' THEN 'Estaciones que rotan entre reformer y trabajo funcional en el salón.'
    ELSE description
  END
WHERE module_key = 'reformer';

UPDATE public.class_types SET description =
  CASE name
    WHEN 'Strong Start' THEN 'Fuerza funcional de piso para arrancar con energía.'
    WHEN 'Release' THEN 'Movilidad y liberación miofascial a un ritmo más lento.'
    WHEN 'Yoga' THEN 'Respiración, equilibrio y flexibilidad.'
    WHEN 'Dynamat' THEN 'Piso dinámico, en pausa por ahora.'
    ELSE description
  END
WHERE module_key = '4mat';
