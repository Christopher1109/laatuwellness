import { createServerFn } from "@tanstack/react-start";

// ============================================================================
// Manda una clase de Läätu a Wellhub como "slot" reservable. Se llama
// después de crear/editar una clase que tiene wellhub_max_spots configurado.
//
// PENDIENTE de confirmar con Wellhub (integrations@gympass.com):
//   - La URL base real de su Booking API (WELLHUB_BOOKING_API_URL) y el
//     gym_id (WELLHUB_GYM_ID) que Läätu recibe al darse de alta como partner.
//   - El formato exacto del body — lo de abajo es la mejor estimación según
//     su documentación pública (product_id + slot con fecha/hora/cupo).
//   - Si prod-a la clase falla (por ejemplo, credenciales aún no
//     configuradas), esto NO debe tronar el flujo normal de crear el
//     horario en Läätu — por eso siempre regresa { ok: false } en vez de
//     lanzar, y quien lo llama solo muestra un aviso, no bloquea nada.
// ============================================================================

type PushResult = { ok: true; wellhubSlotId: string } | { ok: false; error: string };

export const pushClassToWellhub = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      classId: string;
      productId: string; // ID del "Product" de Wellhub asociado (ver GET /setup/v1/gyms/:gym_id/products)
      startsAtIso: string;
      durationMin: number;
      maxSpots: number;
    }) => data,
  )
  .handler(async ({ data }): Promise<PushResult> => {
    const baseUrl = process.env["WELLHUB_BOOKING_API_URL"];
    const gymId = process.env["WELLHUB_GYM_ID"];
    const token = process.env["WELLHUB_AUTH_TOKEN"];

    if (!baseUrl || !gymId || !token) {
      return {
        ok: false,
        error:
          "Wellhub todavía no está configurado (faltan WELLHUB_BOOKING_API_URL / WELLHUB_GYM_ID / WELLHUB_AUTH_TOKEN). La clase se guardó normal en Läätu, solo no se mandó a Wellhub.",
      };
    }

    try {
      const res = await fetch(`${baseUrl}/booking/v1/gyms/${gymId}/classes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          product_id: data.productId,
          external_id: data.classId, // nuestro id, para poder correlacionar en el webhook
          starts_at: data.startsAtIso,
          duration_minutes: data.durationMin,
          max_spots: data.maxSpots,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Wellhub respondió ${res.status}: ${text.slice(0, 200)}` };
      }
      const body = (await res.json()) as { id?: string; slot_id?: string };
      const wellhubSlotId = body.slot_id ?? body.id;
      if (!wellhubSlotId) {
        return { ok: false, error: "Wellhub no regresó un ID de slot en la respuesta." };
      }
      return { ok: true, wellhubSlotId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Error de red desconocido" };
    }
  });
