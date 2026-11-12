"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { menuBooks } from "@/lib/menu-data";
import { getLenis } from "@/lib/lenis";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/ui/Reveal";
import { MenuSectionView } from "./MenuSectionView";
import { SetMenus } from "./SetMenus";

type BookId = (typeof menuBooks)[number]["id"];
const ids = menuBooks.map((b) => b.id) as BookId[];

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = getLenis();
  if (lenis) lenis.scrollTo(el, { offset: -150, duration: 1.2 });
  else el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The four menus as tabs, with a section navigator that follows the reader as they scroll. */
export function MenuBooks() {
  const [active, setActive] = useState<BookId>("breakfast");
  const [current, setCurrent] = useState<string | null>(null);
  const book = useMemo(() => menuBooks.find((b) => b.id === active) ?? menuBooks[0], [active]);

  // Deep links: /menu#cocktails, /menu#functions …
  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash.replace("#", "") as BookId;
      if (ids.includes(hash)) {
        setActive(hash);
        window.setTimeout(() => scrollToId("menus"), 400);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Scroll-spy for the section navigator
  useEffect(() => {
    const els = book.sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-170px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [book]);

  return (
    <section id="menus" aria-label="Full menus" className="relative pb-28 pt-6">
      {/* Sticky: menu tabs, then section chips */}
      <div className="sticky top-[60px] z-30 border-y border-line bg-ink/80 backdrop-blur-xl">
        <div className="container-x">
          <div role="tablist" aria-label="Menus" className="no-scrollbar flex gap-2 overflow-x-auto py-3">
            {menuBooks.map((b) => (
              <button
                key={b.id}
                id={`tab-${b.id}`}
                role="tab"
                aria-selected={active === b.id}
                aria-controls={`panel-${b.id}`}
                onClick={() => {
                  setActive(b.id);
                  setCurrent(null);
                  if (window.location.hash !== `#${b.id}`) history.replaceState(null, "", `#${b.id}`);
                }}
                className={cn(
                  "relative shrink-0 rounded-full px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.2em] transition-colors duration-500",
                  active === b.id ? "text-ink" : "text-bone/70 hover:text-gold-light",
                )}
              >
                {active === b.id && <motion.span layoutId="menu-tab-pill" className="absolute inset-0 rounded-full bg-gold" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                <span className="relative z-10">{b.label}</span>
              </button>
            ))}
          </div>

          {book.sections.length > 0 && (
            <nav aria-label={`${book.label} sections`} className="no-scrollbar flex gap-1 overflow-x-auto border-t border-line py-2">
              {book.sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToId(s.id)}
                  aria-current={current === s.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-2 text-[0.66rem] font-semibold uppercase tracking-[0.18em] transition-colors",
                    current === s.id ? "bg-[color-mix(in_srgb,var(--color-gold)_16%,transparent)] text-gold" : "text-mist hover:text-bone",
                  )}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      <div className="container-x pt-10 md:pt-14">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={book.id}
            id={`panel-${book.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${book.id}`}
            initial={{ opacity: 0, filter: "blur(14px)", y: 18 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, filter: "blur(14px)", transition: { duration: 0.25 } }}
          >
            <header className="mb-4 max-w-3xl">
              <p className="eyebrow mb-3">{book.label} menu</p>
              <p className="display text-3xl italic text-bone/85 md:text-5xl">{book.tagline}</p>
            </header>

            {book.id === "cocktails" && (
              <p className="mb-2 mt-6 text-sm text-mist">
                Our eight Signature Cocktails are featured{" "}
                <a href="#signature-cocktails" onClick={(e) => { e.preventDefault(); scrollToId("signature-cocktails"); }} className="text-gold underline underline-offset-4">
                  above
                </a>
                , and Rush Hour pricing applies to selected cocktails only.
              </p>
            )}

            {book.id === "functions" ? (
              <div className="mt-10">
                <SetMenus />
                <Reveal className="mt-10">
                  <p className="text-sm text-mist">To book a function, email info@newscafe.co.za.</p>
                </Reveal>
              </div>
            ) : (
              book.sections.map((s) => <MenuSectionView key={s.id} section={s} />)
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
