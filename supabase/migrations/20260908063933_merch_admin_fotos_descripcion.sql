-- ============================================================================
-- Panel de Merch en admin: falta poder subir foto, precio y descripción
-- del producto para que se refleje en /merch. Agrega la columna de
-- descripción y un bucket público de storage para las fotos (el bucket de
-- staff-photos existente es privado, no sirve para imágenes públicas).
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product_photos_public_read" ON storage.objects;
CREATE POLICY "product_photos_public_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "product_photos_staff_write" ON storage.objects;
CREATE POLICY "product_photos_staff_write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'product-photos' AND (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid())))
  WITH CHECK (bucket_id = 'product-photos' AND (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid())));
