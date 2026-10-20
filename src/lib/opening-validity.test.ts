import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";

// Exercise the actual database rule rather than a duplicate JavaScript formula.
const env = loadEnv("development", process.cwd(), "VITE_");
const url = env["VITE_SUPABASE_URL"];
const key = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
if (!url || !key) throw new Error("Public database test configuration is missing");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function validityStart(purchase: string) {
  const { data, error } = await client.rpc("purchase_validity_start", {
    _purchased_at: purchase,
  });
  if (error) throw new Error(error.message);
  return new Date(data).toISOString();
}

describe("October 26, 2026 opening exception (Monterrey)", () => {
  it("defers every earlier purchase to October 26 at midnight", async () => {
    expect(await validityStart("2026-10-19T21:03:17Z")).toBe("2026-10-26T06:00:00.000Z");
    expect(await validityStart("2026-10-26T05:59:59Z")).toBe("2026-10-26T06:00:00.000Z");
  });
  it("starts an opening-day purchase at its purchase time", async () => {
    expect(await validityStart("2026-10-26T18:00:00Z")).toBe("2026-10-26T18:00:00.000Z");
  });
  it("does not defer purchases after opening", async () => {
    expect(await validityStart("2026-10-27T18:00:00Z")).toBe("2026-10-27T18:00:00.000Z");
    expect(await validityStart("2026-11-01T18:00:00Z")).toBe("2026-11-01T18:00:00.000Z");
  });
});