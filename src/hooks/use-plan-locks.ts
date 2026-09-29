import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type LockablePlan = {
  id: string;
  purchasable_once?: boolean | null;
  new_clients_only?: boolean | null;
};

// Indica si la cuenta ya no puede comprar un paquete (y por qué), para
// desactivar el botón antes de llegar al pago. El servidor vuelve a validar
// lo mismo al cobrar; esto solo evita que el cliente lo intente.
export function usePlanLocks(userId: string | undefined) {
  const { data: purchasedPlanIds } = useQuery({
    queryKey: ["plan-locks", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("plan_id")
        .eq("user_id", userId ?? "")
        .eq("status", "completed");
      if (error) throw error;
      return new Set((data ?? []).map((t) => t.plan_id).filter(Boolean) as string[]);
    },
  });

  const hasAnyPurchase = (purchasedPlanIds?.size ?? 0) > 0;

  return (plan: LockablePlan): string | null => {
    if (!userId || !purchasedPlanIds) return null;
    if (plan.purchasable_once && purchasedPlanIds.has(plan.id)) return "Ya adquirido";
    if (plan.new_clients_only && hasAnyPurchase) return "Solo clientes nuevos";
    return null;
  };
}
