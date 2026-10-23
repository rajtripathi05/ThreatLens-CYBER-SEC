/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070C18",
        surface: "#0C1424",
        raised: "#131E33",
        line: "#1E2C45",
        ink: "#E8EEF8",
        muted: "#93A5C1",
        faint: "#62769A",
        accent: { DEFAULT: "#2DD4BF", dim: "#14B8A6", ink: "#05201C" },
        sev: { high: "#FB7185", medium: "#FBBF24", low: "#7DD3FC" },
        sim: "#C4A1FF",
        demo: "#FBBF24",
        emp: "#2DD4BF",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Space Grotesk", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
      boxShadow: { panel: "0 1px 0 0 rgba(255,255,255,0.035) inset, 0 16px 40px -24px rgba(0,0,0,0.7)", glow: "0 0 0 1px rgba(45,212,191,0.35), 0 10px 30px -12px rgba(45,212,191,0.35)" },
    },
  },
  plugins: [],
};
