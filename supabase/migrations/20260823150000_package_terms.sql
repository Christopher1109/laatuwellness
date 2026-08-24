-- ============================================================================
-- Términos y condiciones completos por categoría, tal como vienen en el
-- menú oficial (LAATU_Menu_Editorial). Se sobreescriben para asegurar que
-- cada paquete tenga TODAS las notas que le aplican, no solo una.
-- ============================================================================

-- Class Packages (Newcomer, Single, 3/5/10 Classes, Choose Your Way, Double Up/Mix & Match)
UPDATE public.token_plans SET terms =
  'Sujeto a disponibilidad y reservas en calendario. Sin cargo recurrente. '
  || 'Reformer incluye Reformer, Torre y/o silla. 4mat incluye Start Strong, '
  || 'Pilates Mat, Yoga, Mobility. Las clases se cancelan con un mínimo de 12 '
  || 'horas antes. Waitlist disponible.'
WHERE name IN ('Newcomer', 'Single', '3 Classes', '5 Classes', '10 Classes');

UPDATE public.token_plans SET terms =
  'Se renueva mensual. Sujeto a disponibilidad y reservas en calendario. '
  || 'Reformer incluye Reformer, Torre y/o silla. 4mat incluye Start Strong, '
  || 'Pilates Mat, Yoga, Mobility. Las clases se cancelan con un mínimo de 12 '
  || 'horas antes. Waitlist disponible.'
WHERE name = 'Choose Your Way';

UPDATE public.token_plans SET terms =
  'Se renueva mensual. Solo puede ser usado por una persona. Sujeto a '
  || 'disponibilidad y reservas en calendario. Reformer incluye Reformer, '
  || 'Torre y/o silla. 4mat incluye Start Strong, Pilates Mat, Yoga, Mobility. '
  || 'Las clases se cancelan con un mínimo de 12 horas antes. Waitlist disponible.'
WHERE name = 'Double Up / Mix & Match';

-- Memberships (The OGs, Two a Day Your Way, The Everyday)
UPDATE public.token_plans SET terms =
  'Solo habrá 25 membresías a este precio; una vez cancelada se pierde. '
  || 'Cargo mensual recurrente por un mínimo de 6 meses. Se puede congelar '
  || 'hasta 2 semanas al año. Sujeto a disponibilidad y reservas en calendario. '
  || 'Align y Contrast sujetos a disponibilidad.'
WHERE name = 'The OGs';

UPDATE public.token_plans SET terms =
  'Cargo mensual recurrente por un mínimo de 6 meses. Se puede congelar '
  || 'hasta 2 semanas al año. Sujeto a disponibilidad y reservas en calendario. '
  || 'Align y Contrast sujetos a disponibilidad.'
WHERE name IN ('Two a Day Your Way', 'The Everyday');

-- Align (consulta)
UPDATE public.token_plans SET terms =
  'Sujeto a disponibilidad y reservas en calendario. Sesión con Doris Fisio, '
  || 'descarga muscular de 40 minutos.'
WHERE name = 'Align — Doris Fisio';

-- Contrast (recuperación)
UPDATE public.token_plans SET terms =
  'Puede ser usado por un máximo de 2 personas a la vez. Sujeto a '
  || 'disponibilidad. Sesión de 30 minutos (sauna infrarrojo + cold plunge).'
WHERE name = 'Contrast';
