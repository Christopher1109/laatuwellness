import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type CheckoutSessionResult = { clientSecret: string } | { error: string };

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length && found.data[0]) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    const customer = existing.data[0];
    if (customer) {
      if (options.userId && customer.metadata?.["userId"] !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

export const chargeMembershipFee = createServerFn({ method: "POST" })
  .inputValidator((data: { membershipFeeId: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9-]+$/.test(data.membershipFeeId)) throw new Error("Invalid membershipFeeId");
    return data;
  })
  .handler(async ({ data }): Promise<{ charged: boolean; error?: string }> => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: fee, error: feeError } = await supabaseAdmin
      .from("membership_fees")
      .select("id, user_id, amount_cents, status, reason")
      .eq("id", data.membershipFeeId)
      .maybeSingle();
    if (feeError || !fee) return { charged: false, error: "Fee no encontrado" };
    if (fee.status !== "pending_charge") return { charged: false, error: "Fee ya procesado" };

    try {
      const stripe = createStripeClient(data.environment);

      const customers = await stripe.customers.search({
        query: `metadata['userId']:'${fee.user_id}'`,
        limit: 1,
      });
      const customer = customers.data[0];
      if (!customer) {
        return {
          charged: false,
          error: "Cliente sin cuenta de Stripe (sin membresía pagada en línea)",
        };
      }

      let paymentMethodId: string | undefined;
      if (
        customer.invoice_settings?.default_payment_method &&
        typeof customer.invoice_settings.default_payment_method === "string"
      ) {
        paymentMethodId = customer.invoice_settings.default_payment_method;
      } else {
        const methods = await stripe.paymentMethods.list({ customer: customer.id, type: "card" });
        paymentMethodId = methods.data[0]?.id;
      }
      if (!paymentMethodId) {
        return { charged: false, error: "El cliente no tiene una tarjeta guardada para cobro" };
      }

      await stripe.paymentIntents.create({
        amount: fee.amount_cents,
        currency: "mxn",
        customer: customer.id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: fee.reason || "Cargo Läätu Wellness",
      });

      await supabaseAdmin
        .from("membership_fees")
        .update({ status: "charged", charged_at: new Date().toISOString() })
        .eq("id", fee.id);

      return { charged: true };
    } catch (error) {
      return { charged: false, error: getStripeErrorMessage(error) };
    }
  });

export const createCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      priceId: string;
      planId: string;
      customerEmail?: string;
      userId?: string;
      returnUrl: string;
      environment: StripeEnv;
    }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data }): Promise<CheckoutSessionResult> => {
    try {
      const stripe = createStripeClient(data.environment);

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      const stripePrice = prices.data[0];
      if (!stripePrice) throw new Error("Price not found");
      const isRecurring = stripePrice.type === "recurring";

      const customerId =
        data.customerEmail || data.userId
          ? await resolveOrCreateCustomer(stripe, {
              ...(data.customerEmail ? { email: data.customerEmail } : {}),
              ...(data.userId ? { userId: data.userId } : {}),
            })
          : undefined;

      let productDescription: string | undefined;
      if (!isRecurring) {
        const productId =
          typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
        const product = await stripe.products.retrieve(productId);
        productDescription = "name" in product ? product.name : undefined;
      }

      const metadata: Record<string, string> = { planId: data.planId };
      if (data.userId) metadata["userId"] = data.userId;

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        automatic_tax: { enabled: true },
        ...(customerId && {
          customer: customerId,
          customer_update: { address: "auto" as const, name: "auto" as const },
        }),
        ...(!isRecurring &&
          productDescription && {
            payment_intent_data: { description: productDescription },
          }),
        metadata,
        ...(isRecurring && { subscription_data: { metadata } }),
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
