import { createFileRoute, redirect } from "@tanstack/react-router";

// El panel de staff se consolidó dentro de /admin (mismo sidebar, con
// permisos distintos según el rol). Esta ruta se queda solo para no romper
// enlaces viejos.
export const Route = createFileRoute("/_authenticated/staff")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
