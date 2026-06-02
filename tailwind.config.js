/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        // Legacy aliases — kept so existing class names that reference these
        // still render. New components should use the theme tokens below.
        'eerie': '#0a0a0a',
        'dark-bg': '#141414',
        'dark-card': '#1a1a1a',
        'dark-border': '#2a2a2a',

        // Theme tokens — resolve at runtime from the active [data-theme="…"]
        // block in index.css. Use these for any colour that should track
        // the user's theme choice.
        bg: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        input: 'var(--bg-input)',

        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',

        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          fg: 'var(--accent-fg)',
          ring: 'var(--accent-ring)',
        },

        line: 'var(--border-base)',
        lineStrong: 'var(--border-strong)',
      },
      backgroundImage: {
        'gradient-page': 'var(--gradient-page)',
        'gradient-accent': 'var(--gradient-accent)',
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-brand': 'var(--gradient-brand)',
      },
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
        '5xl': '3840px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
