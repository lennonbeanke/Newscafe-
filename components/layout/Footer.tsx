"use client";

import { useRef } from "react";
import { FaFacebookF, FaInstagram, FaTiktok } from "react-icons/fa6";
import { m as motion, useScroll, useTransform } from "framer-motion";
import { fullAddress, navLinks, site } from "@/lib/site";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Marquee } from "@/components/ui/Marquee";
import { Magnetic } from "@/components/ui/Magnetic";

const social = [
  { label: "Instagram", href: site.social.instagram, Icon: FaInstagram },
  { label: "Facebook", href: site.social.facebook, Icon: FaFacebookF },
  { label: "TikTok", href: site.social.tiktok, Icon: FaTiktok },
];

export function Footer() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const y = useTransform(scrollYProgress, [0, 1], ["18%", "0%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [0.15, 1]);

  return (
    <footer ref={ref} className="relative overflow-hidden border-t border-line bg-coal pt-24">
      <Marquee
        items={["Good food", "Great cocktails", "Unmistakable atmosphere", "#ItsAboutTheVibe"]}
        decorative
        className="display mb-24 text-4xl text-bone/20 md:text-6xl"
      />

      <div className="container-x grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="eyebrow mb-5">Visit</p>
          <address className="not-italic text-lg leading-relaxed text-bone/80">
            {fullAddress}
            <br />
            <a className="transition-colors hover:text-gold-light" href={`tel:${site.phone.replace(/\s/g, "")}`}>{site.phone}</a>
            <br />
            <a className="transition-colors hover:text-gold-light" href={`mailto:${site.email}`}>{site.email}</a>
          </address>
          <div className="mt-8 flex gap-3">
            {social.map(({ label, href, Icon }) => (
              <Magnetic key={label} strength={0.5}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-bone/70 transition-colors duration-500 hover:border-gold hover:bg-gold hover:text-ink"
                >
                  <Icon size={16} />
                </a>
              </Magnetic>
            ))}
          </div>
        </div>

        <div className="md:col-span-3">
          <p className="eyebrow mb-5">Explore</p>
          <ul className="flex flex-col gap-3">
            {navLinks.map((l) => (
              <li key={l.href}>
                <TransitionLink href={l.href} className="text-bone/70 transition-all duration-300 hover:pl-2 hover:text-gold-light">
                  {l.label}
                </TransitionLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-4">
          <p className="eyebrow mb-5">Legal</p>
          <p className="text-sm leading-relaxed text-bone/70">{site.legal}</p>
          <p className="mt-4 text-sm leading-relaxed text-mist">{site.ageNotice}</p>
        </div>
      </div>

      <motion.div style={{ y, opacity }} className="pointer-events-none mt-24 select-none text-center">
        <span className="display block text-[14vw] leading-[0.85] tracking-[0.02em] text-gold-gradient">
          {site.name.toUpperCase()}
        </span>
      </motion.div>

      <div className="container-x relative z-10 flex flex-col items-center justify-between gap-3 border-t border-line py-8 text-xs tracking-wider text-mist md:flex-row">
        <p>© {new Date().getFullYear()} {site.name}. All rights reserved.</p>
        <p>{site.ageNotice}</p>
      </div>
    </footer>
  );
}
