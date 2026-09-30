import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPinpadPayment, refundClipPayment, type PosBrand } from "@/lib/clip-pinpad.server";
import { describeError } from "@/lib/describe-error";

const UUID = /^[a-f0-9-]{36}$/i;

// Reembolso de un cobro hecho en terminal Clip. Orden:
//   1) calcula cuánto se devuelve (créditos no usados + productos),
//   2) pide a Clip que regrese el dinero a la tarjeta,
//   3) solo si Clip aceptó, quita créditos / regresa inventario en el sistema.
// Si el paso 3 fallara, el id del reembolso de Clip queda guardado y al
// reintentar ya no se vuelve a pedir el dinero a Clip.
export const refundTerminalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string; reason: string }) => {
    if (!UUID.test(data.paymentId)) throw new Error("Cobro inválido");
    if (typeof data.reason !== "string") throw new Error("Motivo inválido");
    return { paymentId: data.paymentId, reason: data.reason.trim().slice(0, 200) };
  })
  .handler(async ({ data, context }): Promise<{ refundedCents: number }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Solo un administrador puede hacer reembolsos.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas/funciones nuevas, aún no están en los tipos generados
    const admin = supabaseAdmin as any;

    const { data: row } = await admin
      .from("pos_terminal_payments")
      .select("id, brand, status, pinpad_request_id, refunded_at, clip_refund_id")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (!row || row.status !== "completed") throw new Error("Cobro no encontrado.");
    if (row.refunded_at) throw new Error("Este cobro ya fue reembolsado.");

    const { data: preview, error: previewError } = await admin.rpc("pos_refund_preview", {
      _kind: "terminal",
      _id: row.id,
    });
    if (previewError) throw new Error(describeError(previewError));
    const refundCents = Number(preview?.refund_cents ?? 0);
    if (refundCents <= 0) {
      throw new Error("El cliente ya usó todos los créditos; no hay monto por reembolsar.");
    }

    let clipRefundId: string | null = row.clip_refund_id ?? null;
    if (!clipRefundId) {
      const detail = await getPinpadPayment(row.brand as PosBrand, row.pinpad_request_id);
      const references: { type: "transaction" | "receipt"; id: string }[] = [
        ...detail.clipPaymentIds.map((id) => ({ type: "transaction" as const, id })),
        ...(detail.receiptNo ? [{ type: "receipt" as const, id: detail.receiptNo }] : []),
      ];
      if (references.length === 0) {
        throw new Error("No se encontró el pago aprobado en Clip para reembolsarlo.");
      }
      const { refundId } = await refundClipPayment({
        brand: row.brand as PosBrand,
        amountCents: refundCents,
        reason: data.reason || "Reembolso en mostrador",
        references,
        idempotencyKey: row.id,
      });
      clipRefundId = refundId || "clip-ok";
      await admin
        .from("pos_terminal_payments")
        .update({ clip_refund_id: clipRefundId })
        .eq("id", row.id);
    }

    const { error: applyError } = await admin.rpc("pos_apply_refund", {
      _kind: "terminal",
      _id: row.id,
      _reason: data.reason,
      _clip_refund_id: clipRefundId,
      _by: context.userId,
    });
    if (applyError) {
      throw new Error(
        `Clip ya devolvió el dinero, pero no se pudo actualizar el sistema: ${describeError(applyError)}. Vuelve a intentar el reembolso; no se cobrará dos veces.`,
      );
    }
    return { refundedCents: refundCents };
  });
