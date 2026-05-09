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
                    DEFAULT: "#1D5DD7",
                    dark: "#001D5A",
                    soft: "#BEE0FE",
                    bg: "#EAF2FE",
                    accent: "#5bc4e7",
                },
                ink: {
                    DEFAULT: "#070C27",
                    muted: "#48484A",
                    soft: "#969696",
                },
                surface: {
                    DEFAULT: "#FFFFFF",
                    soft: "#F5F5FA",
                    border: "#E8E8E8",
                    "border-strong": "#D4D4DA",
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
                },
            },
        },
    },
    plugins: [],
};
//# sourceMappingURL=tailwind.config.js.map