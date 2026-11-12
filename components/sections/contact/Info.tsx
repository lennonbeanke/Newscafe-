"use client";

import { FiMail, FiMapPin, FiPhone } from "react-icons/fi";
import { fullAddress, site } from "@/lib/site";
import { Reveal } from "@/components/ui/Reveal";

export function Info() {
  const items = [
    { Icon: FiMapPin, label: "Head office", value: fullAddress, href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`, external: true },
    { Icon: FiPhone, label: "Call", value: site.phone, href: `tel:${site.phone.replace(/\s/g, "")}` },
    { Icon: FiMail, label: "Email", value: site.email, href: `mailto:${site.email}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      {items.map(({ Icon, label, value, href, external }, i) => (
        <Reveal key={label} delay={i * 0.1} variant="left" y={0}>
          <a
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="group flex items-center gap-6 border-b border-line pb-6 transition-colors hover:border-gold/60"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line text-gold transition-all duration-500 group-hover:scale-110 group-hover:bg-gold group-hover:text-ink">
              <Icon size={20} />
            </span>
            <span>
              <span className="eyebrow block text-[0.62rem]">{label}</span>
              <span className="display mt-1 block text-2xl transition-transform duration-500 group-hover:translate-x-1 md:text-3xl">{value}</span>
            </span>
          </a>
        </Reveal>
      ))}

    </div>
  );
}
