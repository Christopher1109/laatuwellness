import { createServerFn } from "@tanstack/react-start";

const MODULE_FIELDS = "key,name,description,long_description,category,enabled,bookable,sort_order";

export const listPublicModules = createServerFn({ method: "GET" }).handler(async () => {
  const { createPublicCatalogClient } = await import("@/lib/public-catalog.server");
  const client = createPublicCatalogClient();
  const { data, error } = await client.from("site_modules")
    .select(MODULE_FIELDS).eq("enabled", true).order("sort_order");
  if (error) throw error;
  return data ?? [];
});

export const getPublicProgram = createServerFn({ method: "GET" })
  .inputValidator((input: { key: string }) => {
    if (typeof input.key !== "string" || !/^[a-z0-9-]{1,80}$/.test(input.key)) {
      throw new Error("Invalid program key.");
    }
    return { key: input.key };
  })
  .handler(async ({ data: input }) => {
    const { createPublicCatalogClient } = await import("@/lib/public-catalog.server");
    const client = createPublicCatalogClient();
    const { data: modulo, error } = await client.from("site_modules")
      .select(MODULE_FIELDS).eq("key", input.key).eq("enabled", true).maybeSingle();
    if (error) throw error;
    if (!modulo) return null;
    const { data: classTypes, error: classError } = await client.from("class_types")
      .select("id,module_key,name,description,active,sort_order")
      .eq("module_key", input.key).eq("active", true).order("sort_order");
    if (classError) throw classError;
    return { modulo, classTypes: classTypes ?? [] };
  });