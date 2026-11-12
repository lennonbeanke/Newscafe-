import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Build a sized Unsplash URL from a photo id. next/image handles optimisation on top of this. */
export function img(id: string, width = 1600) {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;
}

/** Rand with a non-breaking thousands separator, e.g. R2 290. */
export function formatPrice(value: number) {
  return `R${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0")}`;
}
