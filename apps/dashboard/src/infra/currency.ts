const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

/** Formats a number as ARS currency using the es-AR locale (e.g. "$ 1.500,00"). */
export function formatARS(value: number): string {
  return arsFormatter.format(value);
}
