// Lógica compartida entre el webhook de Clip PinPad y el POS (que también
// consulta el estado mientras espera). En ambos casos la fuente de verdad es
// Clip: nunca se da por pagado un cobro sin preguntarle a Clip su estado.

import { getPinpadPayment, type PosBrand } from "@/lib/clip-pinpad.server";

export type TerminalPaymentRow = {
  id: string;
  brand: PosBrand;
  status: string;
  pinpad_request_id: string | null;
  amount_cents: number;
  sale_id: string | null;
  error: string | null;
  card_last4: string | null;
};

const FINAL = new Set(["completed", "failed", "canceled"]);

export function isFinalStatus(status: string): boolean {
  return FINAL.has(status);
}

export async function syncTerminalPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva, aún no está en los tipos generados
  admin: any,
  row: TerminalPaymentRow,
): Promise<TerminalPaymentRow> {
  if (isFinalStatus(row.status) || !row.pinpad_request_id) return row;

  const detail = await getPinpadPayment(row.brand, row.pinpad_request_id);
  // Si Clip todavía no lo encuentra, lo dejamos pendiente; no inventamos estado.
  if (!detail.found) return row;

  const now = new Date().toISOString();
  const status = detail.status;

  // En la práctica Clip responde "APPROVED" (su documentación dice
  // "COMPLETED"); se aceptan ambos, además de "PAID" por si cambian.
  if (/^(COMPLETED|APPROVED|PAID|SUCCESS)$/.test(status)) {
    const paid = detail.amountPaidCents ?? detail.amountCents ?? 0;
    if (paid < row.amount_cents) {
      const error = `Clip reporta un pago de $${(paid / 100).toFixed(2)}, menor al total de la venta.`;
      await admin
        .from("pos_terminal_payments")
        .update({
          status: "failed",
          clip_status: status,
          amount_paid_cents: paid,
          error,
          updated_at: now,
        })
        .eq("id", row.id);
      return { ...row, status: "failed", error };
    }

    await admin
      .from("pos_terminal_payments")
      .update({
        clip_status: status,
        amount_paid_cents: paid,
        card_last4: detail.cardLast4 ?? null,
        card_brand: detail.cardBrand ?? null,
        updated_at: now,
      })
      .eq("id", row.id);

    const { data: saleId, error } = await admin.rpc("pos_finalize_terminal_payment", {
      _payment_id: row.id,
    });
    if (error)
      throw new Error(`No se pudo registrar la venta: ${error.message ?? JSON.stringify(error)}`);
    return {
      ...row,
      status: "completed",
      sale_id: saleId as string,
      card_last4: detail.cardLast4 ?? null,
    };
  }

  if (/FAIL|REJECT|DECLIN|ERROR/.test(status)) {
    const error = "El pago fue rechazado o falló en la terminal.";
    await admin
      .from("pos_terminal_payments")
      .update({ status: "failed", clip_status: status, error, updated_at: now })
      .eq("id", row.id);
    return { ...row, status: "failed", error };
  }

  if (/CANCEL|EXPIRE/.test(status)) {
    await admin
      .from("pos_terminal_payments")
      .update({ status: "canceled", clip_status: status, updated_at: now })
      .eq("id", row.id);
    return { ...row, status: "canceled" };
  }

  await admin
    .from("pos_terminal_payments")
    .update({ status: "pending", clip_status: status, updated_at: now })
    .eq("id", row.id);
  return { ...row, status: "pending" };
}
