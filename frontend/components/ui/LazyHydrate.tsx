"use client";

import { Suspense, use, type ReactNode } from "react";

const gates = new Map<string, Promise<void>>();

/** Resolves once the wrapper element for `id` is within `margin` of the viewport (or immediately if it can't be observed). */
function gateFor(id: string, margin: string): Promise<void> {
  const existing = gates.get(id);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    const el = document.querySelector(`[data-lazy-hydrate="${id}"]`);
    if (!el || !("IntersectionObserver" in window)) return resolve();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
  });
  gates.set(id, promise);
  return promise;
}

function Gate({ id, margin, children }: { id: string; margin: string; children: ReactNode }) {
  // On the server we render normally. In the browser, suspending during hydration makes React keep the
  // server-rendered HTML as-is (no JS cost) and hydrate the boundary later, once the gate opens.
  if (typeof window !== "undefined") use(gateFor(id, margin));
  return <>{children}</>;
}

/**
 * Defer hydration of a below-the-fold section until it nears the viewport. The server HTML stays in the
 * page (SEO, no layout shift); hydration, effects and GSAP triggers only run when they're about to be seen.
 */
export function LazyHydrate({
  id,
  children,
  margin = "120% 0px",
  minHeight = "100svh",
}: {
  id: string;
  children: ReactNode;
  margin?: string;
  /** Reserves space only for the client-side-navigation case, where there is no server HTML yet. */
  minHeight?: string;
}) {
  return (
    <div data-lazy-hydrate={id} style={{ minHeight }}>
      <Suspense fallback={null}>
        <Gate id={id} margin={margin}>
          {children}
        </Gate>
      </Suspense>
    </div>
  );
}
