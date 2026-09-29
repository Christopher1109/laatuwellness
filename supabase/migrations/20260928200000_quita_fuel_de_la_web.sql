-- ============================================================================
-- Fuel deja de estar publicado en la página web y en la app de clientes.
-- Sus productos (smoothies, café, add-ons, agua, barras, etc.) siguen dados
-- de alta y se venden SOLO en el punto de venta del estudio.
--
-- - El módulo 'fuel' se desactiva (no se borra) para que deje de aparecer.
-- - En los textos de los paquetes se quita la palabra "Fuel" sin cambiar el
--   beneficio (ej. "1 Fuel Coffee + Smoothie" -> "1 Coffee + Smoothie").
-- ============================================================================

UPDATE public.site_modules SET enabled = false WHERE key = 'fuel';

UPDATE public.token_plans SET
  description = replace(replace(replace(replace(replace(description,
    'Align, Contrast ni Fuel', 'Align ni Contrast'),
    ' + Fuel.', '.'),
    '1 Fuel ', '1 '),
    'Contrast o Fuel', 'Contrast, smoothies o café'),
    ' Fuel', ''),
  subtitle = replace(replace(replace(replace(replace(subtitle,
    'Align, Contrast ni Fuel', 'Align ni Contrast'),
    ' + Fuel.', '.'),
    '1 Fuel ', '1 '),
    'Contrast o Fuel', 'Contrast, smoothies o café'),
    ' Fuel', ''),
  includes = replace(replace(replace(replace(replace(includes,
    'Align, Contrast ni Fuel', 'Align ni Contrast'),
    ' + Fuel.', '.'),
    '1 Fuel ', '1 '),
    'Contrast o Fuel', 'Contrast, smoothies o café'),
    ' Fuel', ''),
  excludes = replace(replace(replace(replace(replace(excludes,
    'Align, Contrast ni Fuel', 'Align ni Contrast'),
    ' + Fuel.', '.'),
    '1 Fuel ', '1 '),
    'Contrast o Fuel', 'Contrast, smoothies o café'),
    ' Fuel', ''),
  terms = replace(replace(replace(replace(replace(terms,
    'Align, Contrast ni Fuel', 'Align ni Contrast'),
    ' + Fuel.', '.'),
    '1 Fuel ', '1 '),
    'Contrast o Fuel', 'Contrast, smoothies o café'),
    ' Fuel', '')
WHERE description ILIKE '%fuel%'
   OR subtitle ILIKE '%fuel%'
   OR includes ILIKE '%fuel%'
   OR excludes ILIKE '%fuel%'
   OR terms ILIKE '%fuel%';
