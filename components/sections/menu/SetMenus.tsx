"use client";

import { setMenus } from "@/lib/menu-data";
import { formatPrice } from "@/lib/utils";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Functions menu: Set Menu One (R450) and Set Menu Two (R290), copper-and-navy in dark mode and a cream card with the
 * same copper edge in light mode (colours come from the --set-* theme variables).
 */
export function SetMenus() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {setMenus.map((m, i) => (
        <Reveal key={m.id} delay={i * 0.12}>
          <article
            aria-labelledby={`${m.id}-title`}
            className="relative h-full overflow-hidden rounded-3xl border border-[color-mix(in_srgb,var(--set-accent)_38%,transparent)] bg-[var(--set-bg)] p-7 pl-11 text-[var(--set-text)] shadow-[0_30px_70px_-35px_rgba(0,0,0,0.5)] md:p-10 md:pl-16"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-3.5 bg-gradient-to-b from-[#e08a4f] via-[#b5532e] to-[#e9b27a]" />
            <header className="flex items-start justify-between gap-4">
              <h3 id={`${m.id}-title`} className="display text-4xl leading-none md:text-5xl">
                {m.title}
              </h3>
              <p className="display shrink-0 text-5xl leading-none text-[var(--set-accent)] md:text-6xl" aria-label={`${formatPrice(m.price)} per person`}>
                {formatPrice(m.price)}
              </p>
            </header>
            <p className="mt-3 text-sm tracking-wide text-[var(--set-sub)]">{m.includes}</p>

            {m.courses.map((c) => (
              <div key={c.title} className="mt-7">
                <h4 className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[var(--set-accent)]">{c.title}</h4>
                <ul className="mt-3 space-y-3">
                  {c.items.map((it) => (
                    <li key={it.name}>
                      <p className="text-[1.05rem] font-medium">
                        {it.name}
                        {it.vegetarian && (
                          <span title="Vegetarian" aria-label="Vegetarian" className="ml-2 inline-flex h-5 w-5 translate-y-[-0.1em] items-center justify-center rounded-full border border-current align-middle text-[0.58rem] font-bold opacity-80">
                            V
                          </span>
                        )}
                      </p>
                      {it.description && <p className="text-sm leading-relaxed text-[var(--set-sub)]">{it.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        </Reveal>
      ))}
    </div>
  );
}
