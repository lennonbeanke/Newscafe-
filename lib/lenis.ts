import type Lenis from "lenis";

/** Module-level handle so any client component can stop/start/scroll without prop drilling. */
let instance: Lenis | null = null;

export const setLenis = (lenis: Lenis | null) => {
  instance = lenis;
};

export const getLenis = () => instance;

export function lockScroll() {
  instance?.stop();
  document.documentElement.style.overflow = "hidden";
}

export function unlockScroll() {
  instance?.start();
  document.documentElement.style.overflow = "";
}
