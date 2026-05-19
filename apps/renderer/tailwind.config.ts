import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "var(--c-primary)",
          dark: "var(--c-primary-dark)",
          soft: "var(--c-primary-soft)",
          bg: "var(--c-primary-bg)",
          fg: "var(--c-primary-fg)",
          accent: "var(--c-accent)",
        },
        ink: {
          DEFAULT: "var(--c-text)",
          muted: "var(--c-text-muted)",
          soft: "var(--c-text-soft)",
        },
        surface: {
          DEFAULT: "var(--c-bg)",
          soft: "var(--c-bg-soft)",
          card: "var(--c-bg-card)",
          border: "var(--c-border)",
          "border-strong": "var(--c-border-strong)",
        },
        semantic: {
          success: "#16a34a",
          "success-bg": "#dcfce7",
          warning: "#FFC520",
          "warning-bg": "#fef9c3",
          danger: "#E83838",
          "danger-bg": "#fee2e2",
          purple: "#7c3aed",
          "purple-bg": "#ede9fe",
          info: "#2563eb",
          "info-bg": "#dbeafe",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
