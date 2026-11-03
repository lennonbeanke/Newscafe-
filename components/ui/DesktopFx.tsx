"use client";

import { useEffect, useState, type ComponentType } from "react";
import { whenIdle } from "@/lib/idle";

/**
 * Cursor follower and ambient light only make sense with a precise pointer on a wide screen, so their code
 * is fetched after idle on those devices only. Phones and tablets never download or run it.
 */
export function DesktopFx() {
  const [fx, setFx] = useState<ComponentType[] | null>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (!fine) return;
    let alive = true;
    const cancel = whenIdle(() => {
      Promise.all([import("./Cursor"), import("./AmbientGlow")]).then(([c, a]) => {
        if (alive) setFx([c.Cursor, a.AmbientGlow]);
      });
    }, 3000);
    return () => {
      alive = false;
      cancel();
    };
  }, []);

  return fx ? (
    <>
      {fx.map((C, i) => (
        <C key={i} />
      ))}
    </>
  ) : null;
}
