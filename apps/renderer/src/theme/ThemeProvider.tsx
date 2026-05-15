import { useEffect } from "react";
import type { Theme } from "@prospero/shared";

export const applyTheme = (theme: Theme): void => {
  const html = document.documentElement;
  html.classList.toggle("dark", theme === "dark");
};

type Props = {
  theme: Theme;
  children: React.ReactNode;
};

export const ThemeProvider = ({ theme, children }: Props) => {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return <>{children}</>;
};
