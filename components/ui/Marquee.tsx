import { cn } from "@/lib/utils";

interface MarqueeProps {
  items: string[];
  reverse?: boolean;
  className?: string;
  itemClassName?: string;
  separator?: string;
  /** Purely ornamental text: hide it from assistive technology. */
  decorative?: boolean;
}

/** Infinite CSS marquee. Content is duplicated once so the -50% loop is seamless. */
export function Marquee({ items, reverse, className, itemClassName, separator = "✦", decorative }: MarqueeProps) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item} className={cn("flex items-center whitespace-nowrap", itemClassName)}>
          {decorative ? <span aria-hidden data-text={item} className="before:content-[attr(data-text)]" /> : <span>{item}</span>}
          <span className="mx-8 text-gold md:mx-12">{separator}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("flex overflow-hidden select-none", className)} aria-hidden={decorative || undefined}>
      <div className={cn("flex shrink-0", reverse ? "animate-marquee-reverse" : "animate-marquee")}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
