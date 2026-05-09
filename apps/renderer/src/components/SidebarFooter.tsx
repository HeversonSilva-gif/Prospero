import { ThemeToggle } from "./ThemeToggle.js";
import { LanguageToggle } from "./LanguageToggle.js";

export const SidebarFooter = () => (
  <div className="mt-auto pt-3 border-t border-surface-border flex flex-col gap-2 px-2">
    <LanguageToggle />
    <ThemeToggle />
  </div>
);
