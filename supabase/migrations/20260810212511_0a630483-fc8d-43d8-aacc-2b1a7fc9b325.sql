ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS module_key text DEFAULT 'reformer';
UPDATE public.classes SET module_key = 'reformer' WHERE module_key IS NULL;
CREATE INDEX IF NOT EXISTS classes_module_key_idx ON public.classes (module_key);

ALTER TABLE public.site_modules ADD COLUMN IF NOT EXISTS long_description text NOT NULL DEFAULT '';
ALTER TABLE public.site_modules ADD COLUMN IF NOT EXISTS bookable boolean NOT NULL DEFAULT true;

INSERT INTO public.site_modules (key, name, category, description, long_description, enabled, sort_order, bookable)
VALUES
  ('rehabilitacion', 'Rehabilitación & Fisioterapia', 'servicio',
   'Sesiones uno a uno con fisioterapeuta para volver al movimiento sin dolor.',
   'Valoración funcional, terapia manual y programa progresivo de carga. Trabajamos lesiones, post-operatorios y dolor crónico con criterio clínico y paciencia.',
   true, 6, true),
  ('recovery-bar', 'Recovery Bar', 'bar',
   'Smoothies de proteína, café de especialidad y preparaciones para recuperar después de entrenar.',
   'Nuestra barra de recuperación vive dentro del estudio. Smoothies de proteína, shots, infusiones y café de especialidad pensados para lo que tu cuerpo necesita justo después de la clase. Se ordena y se paga en el estudio.',
   true, 7, false)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order,
  bookable = EXCLUDED.bookable;

UPDATE public.site_modules SET long_description = 'Salón íntimo de máximo diez personas. Cincuenta minutos de fuerza, control y movilidad sobre reformer, con corrección individual dentro del grupo.' WHERE key = 'reformer' AND long_description = '';
UPDATE public.site_modules SET long_description = 'Sauna infrarrojo y agua fría en ciclos guiados. Baja la inflamación, acelera la recuperación y regula el sistema nervioso.' WHERE key = 'contraste' AND long_description = '';
UPDATE public.site_modules SET long_description = 'Acompañamiento nutricional enfocado en longevidad y energía sostenida, no en dietas de castigo.' WHERE key = 'nutricion' AND long_description = '';
UPDATE public.site_modules SET long_description = 'Sesiones de psicología para sostener el proceso desde adentro. Porque el recorrido también es mental.' WHERE key = 'psicologia' AND long_description = '';