"use client";

import { createContext, useContext } from "react";

export const TransitionContext = createContext<{ navigate: (href: string) => void }>({
  navigate: () => {},
});

export const useTransitionNav = () => useContext(TransitionContext);
