type ProductEdition = "pro" | "oss";

function normalizeEdition(raw: string | undefined): ProductEdition {
  const value = (raw ?? "pro").trim().toLowerCase();
  if (value === "oss" || value === "open-source" || value === "opensource") return "oss";
  return "pro";
}

export const PRODUCT_EDITION: ProductEdition = normalizeEdition(
  import.meta.env.VITE_AL_PRODUCT_EDITION as string | undefined
);

export const ENABLE_PRO_ANALYZER = PRODUCT_EDITION === "pro";
export const ENABLE_PERSPECTIVE_PIVOT = PRODUCT_EDITION === "pro";
