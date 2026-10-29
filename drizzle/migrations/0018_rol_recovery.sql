-- Rol nuevo para el equipo: "recovery" (DorisFisio). No es coach: atiende el
-- consultorio de recuperación. Va en su propia migración porque un valor
-- nuevo de enum no se puede usar en la misma transacción en que se crea.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'recovery';
