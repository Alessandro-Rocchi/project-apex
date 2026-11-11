/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        'pit-bg': '#090D16',
        'pit-panel': '#111827',
        'pit-elevated': '#1F2937',
        'sector-purple': '#A855F7',
        'sector-green': '#22C55E',
        'sector-yellow': '#EAB308',
        'tyre-soft': '#EF4444',
        'tyre-medium': '#FACC15',
        'tyre-hard': '#F8FAFC',
        'tyre-inter': '#22C55E',
        'tyre-wet': '#3B82F6',
      },
    },
  },
};
