"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useTransitionNav } from "@/hooks/useTransitionNav";

type Props = ComponentProps<typeof Link>;

/** next/link that plays the curtain transition for internal navigation. */
export function TransitionLink({ href, onClick, children, ...rest }: Props) {
  const { navigate } = useTransitionNav();
  const url = typeof href === "string" ? href : (href.pathname ?? "/");

  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (/^(https?:|mailto:|tel:)/.test(url)) return;
    e.preventDefault();
    navigate(url);
  };

  return (
    <Link href={href} onClick={handle} {...rest}>
      {children}
    </Link>
  );
}
