/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--surface-elevated)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        borderc: 'var(--border)',
        accent: 'var(--accent)',
      },
    },
  },
  plugins: [],
};
