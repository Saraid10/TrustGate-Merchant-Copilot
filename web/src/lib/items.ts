import { Bean, Droplets, Package, ShoppingBag, Wheat, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  "TOOR-5KG": Bean,
  "OIL-15L": Droplets,
  "BAGS-500": ShoppingBag,
  "SUGAR-5KG": Package,
  "ATTA-10KG": Wheat,
  "RICE-25KG": Wheat,
};

export const itemIcon = (sku: string): LucideIcon => icons[sku] ?? Package;
