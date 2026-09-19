import type { Line } from "../types";

/** "New Packaging Supplier (unverified)" → name plus an unverified flag. */
export function supplierParts(supplier: string) {
  const m = supplier.match(/^(.*?)\s*\(unverified\)\s*$/i);
  return m ? { name: m[1], unverified: true } : { name: supplier, unverified: false };
}

/** A priced line whose supplier is not marked unverified. */
export const fromVerifiedSupplier = (line: Line) =>
  !!line.derived && !supplierParts(line.derived.supplier).unverified;
