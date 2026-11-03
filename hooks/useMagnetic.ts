import { useRef, type PointerEvent } from "react";
import { useMotionValue, useSpring } from "framer-motion";

/** Spring-driven pull toward the pointer. Spread `bind` on the element and `style` on the motion wrapper. */
export function useMagnetic(strengthX = 0.28, strengthY = 0.4) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strengthX);
    y.set((e.clientY - (r.top + r.height / 2)) * strengthY);
  };
  const onPointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return { ref, style: { x: sx, y: sy }, bind: { onPointerMove, onPointerLeave } };
}
