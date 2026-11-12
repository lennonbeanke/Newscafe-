"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, m as motion, useMotionValueEvent, useScroll } from "framer-motion";
import { navLinks, site } from "@/lib/site";
import { lockScroll, unlockScroll } from "@/lib/lenis";
import { cn } from "@/lib/utils";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Magnetic } from "@/components/ui/Magnetic";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const drawer = {
  hidden: { x: "100%" },
  show: { x: "0%", transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { x: "100%", transition: { duration: 0.35, ease: [0.76, 0, 0.24, 1] as const } },
};
const backdrop = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setScrolled(y > 40);
    setHidden(y > 600 && y > prev && !open);
  });

  useEffect(() => {
    if (open) lockScroll();
    else unlockScroll();
    return () => unlockScroll();
  }, [open]);

  // Close the menu whenever the route changes.
  useEffect(() => {
    const id = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <motion.header
        initial={false}
        animate={{ y: hidden ? -110 : 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "fixed inset-x-0 top-0 z-50 animate-[nav-in_0.9s_cubic-bezier(0.16,1,0.3,1)_0.3s_backwards] transition-[background-color,backdrop-filter,border-color,padding] duration-500",
          scrolled || open
            ? "border-b border-line bg-ink/85 py-3 backdrop-blur-xl"
            : // Over the full-bleed hero photograph the bar always uses the dark palette (light text), in either theme.
              "theme-dark border-b border-transparent bg-transparent py-6",
        )}
      >
        <div className="container-x flex items-center justify-between">
          <TransitionLink href="/" className="relative z-[60] flex items-baseline gap-3" aria-label={`${site.name} home`}>
            <span className="display text-2xl tracking-[0.3em] text-bone md:text-3xl">{site.name.toUpperCase()}</span>
          </TransitionLink>

          <nav className="hidden items-center gap-10 lg:flex" aria-label="Primary">
            {navLinks.slice(1).map((l) => (
              <TransitionLink
                key={l.href}
                href={l.href}
                className="group relative py-2 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-bone/80 transition-colors hover:text-gold-light"
              >
                {l.label}
                {isActive(l.href) ? (
                  <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-0.5 h-px bg-gold" />
                ) : (
                  <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-gold/60 transition-transform duration-500 group-hover:scale-x-100" />
                )}
              </TransitionLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 md:gap-4">
            <ThemeToggle />
            <Magnetic className="hidden md:inline-block">
              <TransitionLink
                href="/contact#enquire"
                className="sheen inline-block rounded-full border border-gold/60 px-6 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold-light transition-colors duration-500 hover:bg-gold hover:text-ink"
              >
                Enquire
              </TransitionLink>
            </Magnetic>
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="relative z-[60] flex h-11 w-11 flex-col items-center justify-center gap-[7px] lg:hidden"
            >
              <motion.span animate={open ? { rotate: 45, y: 4.5 } : { rotate: 0, y: 0 }} className="block h-px w-7 bg-bone" />
              <motion.span animate={open ? { rotate: -45, y: -4.5 } : { rotate: 0, y: 0 }} className="block h-px w-7 bg-bone" />
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div key="mobile-menu" initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-40 lg:hidden" data-lenis-prevent>
            <motion.button
              type="button"
              variants={backdrop}
              aria-label="Close menu"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.aside
              variants={drawer}
              className="absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col justify-between overflow-y-auto border-l border-line bg-onyx px-7 pb-10 pt-24 shadow-2xl"
            >
              <nav className="flex flex-col" aria-label="Mobile">
                {navLinks.map((l) => (
                  <TransitionLink
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "border-b border-line py-4 text-[0.8rem] font-semibold uppercase tracking-[0.24em] transition-colors",
                      isActive(l.href) ? "text-gold-light" : "text-bone/80 hover:text-gold-light",
                    )}
                  >
                    {l.label}
                  </TransitionLink>
                ))}
              </nav>
              <div className="flex flex-col gap-2 text-sm text-mist">
                <span className="eyebrow">Find us</span>
                <p>{site.address.suburb}, {site.address.city}</p>
                <a href={`tel:${site.phone.replace(/\s/g, "")}`} className="text-bone">{site.phone}</a>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
