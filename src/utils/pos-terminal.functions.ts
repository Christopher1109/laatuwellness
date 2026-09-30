import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeError } from "@/lib/describe-error";
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
  // Obligatorio solo si se venden paquetes (a quién se le acreditan las clases).
  clientId: string | null;
  items: { productId: string; qty: number }[];
  plans?: { planId: string; qty: number }[];
  origin: string;
};

export const startTerminalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StartInput) => {
    if (data.brand !== "laatu" && data.brand !== "goodes") throw new Error("Marca inválida");
    const plans = Array.isArray(data.plans) ? data.plans : [];
    if (data.clientId !== null && !UUID.test(data.clientId)) throw new Error("Cliente inválido");
    if (!Array.isArray(data.items) || data.items.length > 50 || plans.length > 20) {
      throw new Error("Carrito inválido");
    }
    if (data.items.length === 0 && plans.length === 0) throw new Error("Carrito vacío");
    for (const it of data.items) {
      if (!UUID.test(it.productId)) throw new Error("Producto inválido");
      if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 100)
        throw new Error("Cantidad inválida");
    }
    for (const pl of plans) {
      if (!UUID.test(pl.planId)) throw new Error("Paquete inválido");
      if (!Number.isInteger(pl.qty) || pl.qty < 1 || pl.qty > 10)
        throw new Error("Cantidad inválida");
    }
    if (plans.length > 0 && !data.clientId) {
      throw new Error("Para vender paquetes o clases hay que elegir al cliente.");
    }
    if (plans.length > 0 && data.brand !== "laatu") {
      throw new Error("Los paquetes de clases se cobran en la terminal de Läätu.");
    }
    if (typeof data.origin !== "string" || !data.origin) throw new Error("origin requerido");
    return { ...data, plans };
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
    let amountCents = 0;
    let items: {
      product_id: string;
      description: string;
      qty: number;
      unit_price_cents: number;
    }[] = [];
    if (data.items.length > 0) {
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

      items = data.items.map((it) => {
        const p = byId.get(it.productId);
        if (!p || !p.active) throw new Error("Hay un producto que ya no está disponible.");
        if ((p.brand ?? "laatu") !== data.brand) {
          throw new Error(
            `"${p.name}" no es de ${BRAND_LABEL[data.brand]}; va en la otra terminal.`,
          );
        }
        amountCents += p.price_cents * it.qty;
        return {
          product_id: p.id,
          description: p.name,
          qty: it.qty,
          unit_price_cents: p.price_cents,
        };
      });
    }

    let plans: { plan_id: string; name: string; qty: number; price_cents: number }[] = [];
    if (data.plans.length > 0) {
      const { data: planRows, error: plansError } = await admin
        .from("token_plans")
        .select("id, name, price_cents, active, purchasable_once, new_clients_only")
        .in(
          "id",
          data.plans.map((pl) => pl.planId),
        );
      if (plansError) throw new Error("No se pudieron validar los paquetes");
      const planById = new Map<
        string,
        {
          id: string;
          name: string;
          price_cents: number;
          active: boolean;
          purchasable_once?: boolean;
          new_clients_only?: boolean;
        }
      >((planRows ?? []).map((p: { id: string }) => [p.id, p]));
      plans = data.plans.map((pl) => {
        const p = planById.get(pl.planId);
        if (!p || !p.active) throw new Error("Hay un paquete que ya no está disponible.");
        if ((p.purchasable_once || p.new_clients_only) && pl.qty > 1) {
          throw new Error(`${p.name} solo se puede comprar una vez por cuenta.`);
        }
        amountCents += p.price_cents * pl.qty;
        return { plan_id: p.id, name: p.name, qty: pl.qty, price_cents: p.price_cents };
      });

      // Reglas por cliente (ej. Newcomer: una sola vez y solo clientes nuevos).
      // Se revisan ANTES de cobrar para no cobrar algo que no se puede acreditar.
      for (const pl of plans) {
        const { data: reason, error: reasonError } = await admin.rpc("plan_purchase_block_reason", {
          _user_id: data.clientId,
          _plan_id: pl.plan_id,
        });
        if (reasonError) throw new Error(describeError(reasonError));
        if (reason) throw new Error(`${pl.name}: ${describeError(String(reason))}`);
      }
    }
    if (amountCents <= 0) throw new Error("El total debe ser mayor a cero.");

    const { data: row, error: insertError } = await admin
      .from("pos_terminal_payments")
      .insert({
        brand: data.brand,
        serial_number: terminal.serial_number,
        sold_by: userId,
        user_id: data.clientId,
        items,
        plans,
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
    if (row.status === "completed") return toState(row);
    return toState(await syncTerminalPayment(admin, row));
  });

// Revisa con Clip los cobros recientes que no quedaron registrados (rechazo
// seguido de reintento en la terminal, webhook perdido, pantalla cerrada a
// medio cobro...). Si Clip dice que se aprobaron, registra la venta.
export const reconcileTerminalPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ recovered: number }> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla nueva
    const admin = supabaseAdmin as any;
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await admin
      .from("pos_terminal_payments")
      .select(ROW_COLUMNS)
      .neq("status", "completed")
      .not("pinpad_request_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(30);
    let recovered = 0;
    for (const row of (rows ?? []) as TerminalPaymentRow[]) {
      try {
        const synced = await syncTerminalPayment(admin, row);
        if (synced.status === "completed") recovered += 1;
      } catch (error) {
        console.error("[POS] no se pudo revisar el cobro", row.id, error);
      }
    }
    return { recovered };
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
