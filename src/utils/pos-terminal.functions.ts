import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BRAND_LABEL,
  cancelPinpadPayment,
  createPinpadPayment,
  type PosBrand,
} from "@/lib/clip-pinpad.server";
import {
  isFinalStatus,
  syncTerminalPayment,
  type TerminalPaymentRow,
} from "@/lib/pos-terminal.server";

const UUID = /^[a-f0-9-]{36}$/i;
const ROW_COLUMNS =
  "id, brand, status, pinpad_request_id, amount_cents, sale_id, error, card_last4";

export type TerminalPaymentState = {
  id: string;
  brand: PosBrand;
  status: string; // creating | pending | completed | failed | canceled
  saleId: string | null;
  error: string | null;
  cardLast4: string | null;
};

function toState(row: TerminalPaymentRow): TerminalPaymentState {
  return {
    id: row.id,
    brand: row.brand,
    status: row.status,
    saleId: row.sale_id,
    error: row.error,
    cardLast4: row.card_last4,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente de supabase del middleware
async function assertStaff(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isStaff }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_staff", { _user_id: userId }),
  ]);
  if (!isAdmin && !isStaff) throw new Error("Solo el staff puede cobrar en terminal.");
}

function pinpadWebhookUrl(rawOrigin: string): string {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error("Origen inválido");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Origen inválido");
  const token = process.env["CLIP_WEBHOOK_SECRET"];
  if (!token) throw new Error("CLIP_WEBHOOK_SECRET no está configurado");
  return `${url.protocol}//${url.host}/api/public/clip/pinpad-webhook?token=${encodeURIComponent(token)}`;
}

type StartInput = {
  brand: PosBrand;
  clientId: string;
  items: { productId: string; qty: number }[];
  origin: string;
};

export const startTerminalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StartInput) => {
    if (data.brand !== "laatu" && data.brand !== "goodes") throw new Error("Marca inválida");
    if (!UUID.test(data.clientId)) throw new Error("Cliente inválido");
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 50) {
      throw new Error("Carrito inválido");
    }
    for (const it of data.items) {
      if (!UUID.test(it.productId)) throw new Error("Producto inválido");
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 100)
        throw new Error("Cantidad inválida");
    }
    if (typeof data.origin !== "string" || !data.origin) throw new Error("origin requerido");
    return data;
  })
  .handler(async ({ data, context }): Promise<TerminalPaymentState> => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);
    const webhookUrl = pinpadWebhookUrl(data.origin);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas nuevas, aún no están en los tipos generados
    const admin = supabaseAdmin as any;

    const { data: terminal } = await admin
      .from("pos_terminals")
      .select("serial_number, active")
      .eq("brand", data.brand)
      .maybeSingle();
    if (!terminal?.serial_number || !terminal.active) {
      throw new Error(
        `La terminal de ${BRAND_LABEL[data.brand]} no está configurada. Agrega su número de serie en "Terminales Clip".`,
      );
    }

    // Precios y marca se toman de la base de datos, nunca del navegador.
    const ids = data.items.map((it) => it.productId);
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, name, price_cents, brand, active")
      .in("id", ids);
    if (productsError) throw new Error("No se pudieron validar los productos");
    const byId = new Map<
      string,
      { id: string; name: string; price_cents: number; brand: string | null; active: boolean }
    >((products ?? []).map((p: { id: string }) => [p.id, p]));

    let amountCents = 0;
    const items = data.items.map((it) => {
      const p = byId.get(it.productId);
      if (!p || !p.active) throw new Error("Hay un producto que ya no está disponible.");
      if ((p.brand ?? "laatu") !== data.brand) {
        throw new Error(`"${p.name}" no es de ${BRAND_LABEL[data.brand]}; va en la otra terminal.`);
      }
      amountCents += p.price_cents * it.qty;
      return {
        product_id: p.id,
        description: p.name,
        qty: it.qty,
        unit_price_cents: p.price_cents,
      };
    });
    if (amountCents <= 0) throw new Error("El total debe ser mayor a cero.");

    const { data: row, error: insertError } = await admin
      .from("pos_terminal_payments")
      .insert({
        brand: data.brand,
        serial_number: terminal.serial_number,
        sold_by: userId,
        user_id: data.clientId,
        items,
        amount_cents: amountCents,
        status: "creating",
      })
      .select(ROW_COLUMNS)
      .single();
    if (insertError || !row) throw new Error("No se pudo crear el cobro.");

    try {
      const { pinpadRequestId } = await createPinpadPayment({
        brand: data.brand,
        amountCents,
        reference: row.id,
        serialNumber: terminal.serial_number,
        webhookUrl,
      });
      await admin
        .from("pos_terminal_payments")
        .update({
          pinpad_request_id: pinpadRequestId,
          status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return toState({ ...row, pinpad_request_id: pinpadRequestId, status: "pending" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo enviar el cobro a la terminal.";
      await admin
        .from("pos_terminal_payments")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      throw new Error(message);
    }
  });

export const checkTerminalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!UUID.test(data.paymentId)) throw new Error("Cobro inválido");
    return data;
  })
  .handler(async ({ data, context }): Promise<TerminalPaymentState> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva
    const admin = supabaseAdmin as any;
    const { data: row } = await admin
      .from("pos_terminal_payments")
      .select(ROW_COLUMNS)
      .eq("id", data.paymentId)
      .maybeSingle();
    if (!row) throw new Error("Cobro no encontrado");
    if (isFinalStatus(row.status)) return toState(row);
    return toState(await syncTerminalPayment(admin, row));
  });

export const cancelTerminalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!UUID.test(data.paymentId)) throw new Error("Cobro inválido");
    return data;
  })
  .handler(async ({ data, context }): Promise<TerminalPaymentState & { message?: string }> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva
    const admin = supabaseAdmin as any;
    const { data: row } = await admin
      .from("pos_terminal_payments")
      .select(ROW_COLUMNS)
      .eq("id", data.paymentId)
      .maybeSingle();
    if (!row) throw new Error("Cobro no encontrado");
    if (isFinalStatus(row.status)) return toState(row);

    // Antes de cancelar, confirmamos que no se haya pagado en ese instante.
    const synced = await syncTerminalPayment(admin, row);
    if (isFinalStatus(synced.status)) return toState(synced);

    if (synced.pinpad_request_id) {
      const result = await cancelPinpadPayment(synced.brand, synced.pinpad_request_id);
      if (!result.canceled) {
        return {
          ...toState(synced),
          message:
            "La terminal ya tomó el cobro. Cancélalo directamente en la terminal; el sistema se actualiza solo.",
        };
      }
    }
    await admin
      .from("pos_terminal_payments")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", synced.id);
    return toState({ ...synced, status: "canceled" });
  });
