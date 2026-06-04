// Estúdio redesign — Phosphor icon re-exports for the sidebar.
// Icons are rendered via a global IconContext (size 18, weight regular) set in AppShell.
// Re-exporting under the legacy names keeps Sidebar.tsx imports stable.
import {
  House,
  ChatCircle,
  CheckCircle,
  Folder,
  UsersThree,
  Gear,
  ChartLineUp,
  Target,
} from "@phosphor-icons/react";

export const HomeIcon = House;
export const SparklesIcon = ChatCircle; // "Pedir algo"
export const GoalsIcon = Target; // "Metas" → /goals
export const DecisionsIcon = CheckCircle; // "Decisões" → /inbox
export const FolderIcon = Folder;
export const UsersIcon = UsersThree;
export const SettingsIcon = Gear;
export const FinanceIcon = ChartLineUp; // "Financeiro" → /financeiro
