import { createContext, useContext, useLayoutEffect, useMemo, type JSX, type ReactNode } from "react";
import type { Copy } from "./copy";
import { THEMES, resolveTheme, type Theme } from "./themes";

const ThemeContext = createContext<Theme>(THEMES.passport);

export function ThemeProvider({ theme, children }: { theme?: string | null; children: ReactNode }): JSX.Element {
  const resolved = useMemo(() => resolveTheme(theme), [theme]);

  /* Layout effect on purpose: children's passive effects (the badge canvas reads
     CSS variables) must see data-theme already applied. */
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved.id;
    document.title = resolved.documentTitle;
    return () => { delete document.documentElement.dataset.theme; };
  }, [resolved]);

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>;
}

// The public theme API deliberately colocates its provider and hooks.
// eslint-disable-next-line react/only-export-components
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// eslint-disable-next-line react/only-export-components
export function useCopy(): Copy {
  return useContext(ThemeContext).copy;
}
