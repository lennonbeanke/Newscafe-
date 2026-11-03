import { useMediaQuery } from "./useMediaQuery";

/** Masonry column count that follows the Tailwind breakpoints (sm 640, lg 1024). */
export function useColumns() {
  const lg = useMediaQuery("(min-width: 1024px)", true);
  const sm = useMediaQuery("(min-width: 640px)", true);
  return lg ? 3 : sm ? 2 : 1;
}
