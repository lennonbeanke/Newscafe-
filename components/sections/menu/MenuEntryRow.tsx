import { cn, formatPrice } from "@/lib/utils";
import type { MenuEntry } from "@/types";
import { MenuFlag } from "./MenuFlag";

function VegMark() {
  return (
    <span
      title="Vegetarian"
      aria-label="Vegetarian"
      className="ml-2 inline-flex h-5 w-5 translate-y-[-0.1em] items-center justify-center rounded-full border border-[#4d8a2a] align-middle font-sans text-[0.58rem] font-bold text-[#4d8a2a]"
    >
      V
    </span>
  );
}

/** Price cell(s): one price, labelled prices (Glass / Carafe), or two aligned columns (Glass | Bottle). */
function Prices({ entry, columns }: { entry: MenuEntry; columns?: [string, string] }) {
  if (columns) {
    const find = (label: string) => entry.prices?.find((p) => p.label === label)?.amount;
    return (
      <span className="ml-auto flex shrink-0 items-baseline justify-end gap-3 sm:ml-0">
        {columns.map((label) => {
          const v = find(label);
          return (
            <span key={label} className="display min-w-[3.25rem] text-right text-xl text-gold sm:min-w-[4rem] md:text-2xl">
              {v !== undefined ? (
                <>
                  <span className="sr-only">{label} </span>
                  {formatPrice(v)}
                </>
              ) : (
                <span aria-hidden className="text-mist/40">–</span>
              )}
            </span>
          );
        })}
      </span>
    );
  }
  if (entry.prices?.length) {
    return (
      <span className="ml-auto flex shrink-0 flex-wrap items-baseline justify-end gap-x-4 sm:ml-0">
        {entry.prices.map((p) => (
          <span key={p.label} className="display text-xl text-gold md:text-2xl">
            <span className="mr-1.5 font-sans text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">{p.label}</span>
            {formatPrice(p.amount)}
          </span>
        ))}
      </span>
    );
  }
  if (entry.price !== undefined) return <span className="display ml-auto shrink-0 text-2xl text-gold sm:ml-0 md:text-[1.7rem]">{formatPrice(entry.price)}</span>;
  return null;
}

/** One menu item. Prices come straight from the data file; nothing is computed or inferred. */
export function MenuEntryRow({ entry, columns, className, headingLevel: Heading = "h4" }: { entry: MenuEntry; columns?: [string, string]; className?: string; headingLevel?: "h3" | "h4" }) {
  return (
    <li className={cn("break-inside-avoid border-b border-line py-5", className)}>
      <div className="flex items-baseline gap-3">
        <Heading className="display text-2xl leading-tight md:text-[1.75rem]">
          {entry.name}
          {entry.vegetarian && <VegMark />}
          <MenuFlag marked={entry.marked} />
        </Heading>
        <span aria-hidden className="mb-1.5 hidden min-w-4 flex-1 border-b border-dotted border-line sm:block" />
        <Prices entry={entry} columns={columns} />
      </div>

      {entry.description && <p className="mt-1.5 max-w-prose text-[0.95rem] leading-relaxed text-mist">{entry.description}</p>}
      {entry.note && <p className="mt-1 text-sm italic text-bone/75">{entry.note}</p>}

      {entry.alcoholFree !== undefined && (
        <p className="mt-2 flex items-center gap-2 text-sm text-bone/85">
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">Alcohol free if you wish</span>
          <span className="display text-lg text-gold">{formatPrice(entry.alcoholFree)}</span>
        </p>
      )}

      {entry.tradeUp && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--set-accent)_60%,transparent)] px-3.5 py-2 text-sm">
          <span className="rounded-full bg-[var(--set-accent)] px-2.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[var(--set-on-accent)]">Trade up</span>
          <span className="text-bone/90">{entry.tradeUp.name}</span>
          <span className="display ml-auto text-xl text-[var(--set-accent)]">{formatPrice(entry.tradeUp.price)}</span>
        </p>
      )}

      {entry.addOns && entry.addOns.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Optional extras">
          {entry.addOns.map((a) => (
            <li key={a.label} className="rounded-full border border-line px-3 py-1 text-xs text-bone/85">
              {a.label} <b className="ml-1 font-semibold text-gold">+{a.amount}</b>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
