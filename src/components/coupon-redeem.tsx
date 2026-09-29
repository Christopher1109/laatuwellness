import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/describe-error";

// Campo para que el cliente canjee un cupón (ej. LAATUAMIGA) y reciba sus
// clases al instante. Las reglas (límite total, límite por persona, solo
// clientes nuevos) las valida la base de datos en redeem_coupon.
export function CouponRedeemBox({ className = "" }: { className?: string }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");

  const redeem = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("redeem_coupon", { _code: code.trim() });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (tokens) => {
      toast.success(
        `Cupón aplicado: se agregaron ${tokens} clase${tokens === 1 ? "" : "s"} a tu cuenta.`,
      );
      setCode("");
      void qc.invalidateQueries({ queryKey: ["app-balance"] });
      void qc.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (e) => toast.error(describeError(e, "No se pudo aplicar el cupón.")),
  });

  return (
    <form
      className={`border border-border p-4 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) redeem.mutate();
      }}
    >
      <p className="eyebrow">¿Tienes un cupón?</p>
      <div className="mt-2 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CÓDIGO"
          autoCapitalize="characters"
          className="min-w-0 flex-1 border border-input bg-transparent px-3 py-2 font-mono text-sm uppercase outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={!code.trim() || redeem.isPending}
          className="border border-foreground px-4 py-2 text-[0.65rem] uppercase tracking-[0.14em] disabled:opacity-40"
        >
          {redeem.isPending ? "Aplicando…" : "Canjear"}
        </button>
      </div>
    </form>
  );
}
