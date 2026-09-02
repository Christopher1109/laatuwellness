-- ============================================================================
-- Convenios corporativos (Wellhub, TotalPass): el cliente de esas plataformas
-- no paga nada a Läätu directamente — Wellhub/TotalPass le pagan a Läätu por
-- fuera (a través de SU PROPIO portal de partner), mensual, por visita
-- validada. Estos planes de $0 son solo para que el staff pueda reservarle
-- la clase a esa clienta en NUESTRO sistema (control de cupo/capacidad) sin
-- que el sistema le pida pagar. No reemplazan el check-in oficial en la app
-- de Wellhub/TotalPass — ver instrucciones de staff.
--
-- is_staff_only: para que estos planes de $0 NO aparezcan en las páginas
-- públicas de compra (cualquiera vería "Convenio Wellhub — $0" y podría
-- intentar "comprarlo"). Solo se pueden asignar desde el panel de staff/admin
-- vía admin_purchase_plan, que ya no filtra por esta columna (staff sí debe
-- poder verlos y asignarlos ahí).
-- ============================================================================
alter table public.token_plans add column if not exists is_staff_only boolean not null default false;

insert into public.token_plans (name, description, category, tokens, price_cents, recurring, active, sort_order, is_staff_only)
select v.name, v.description, 'convenio', 1, 0, false, true, v.sort_order, true
from (values
  ('Convenio Wellhub', 'Visita cubierta por el convenio de la empresa con Wellhub. No se cobra en Läätu — Wellhub le paga a Läätu por separado.', 1),
  ('Convenio TotalPass', 'Visita cubierta por el convenio de la empresa con TotalPass. No se cobra en Läätu — TotalPass le paga a Läätu por separado.', 2)
) as v(name, description, sort_order)
where not exists (select 1 from public.token_plans p where p.name = v.name);
