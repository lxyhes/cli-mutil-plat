/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--color-bg-primary)',
          secondary: 'var(--color-bg-secondary)',
          tertiary: 'var(--color-bg-tertiary)',
          hover: 'var(--color-bg-hover)',
          elevated: 'var(--color-bg-elevated)',
          input: 'var(--color-input-bg)'
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          placeholder: 'var(--color-text-placeholder)'
        },
        accent: {
          blue: 'var(--color-accent-blue)',
          green: 'var(--color-accent-green)',
          yellow: 'var(--color-accent-yellow)',
          red: 'var(--color-accent-red)',
          purple: 'var(--color-accent-purple)',
          orange: 'var(--color-accent-orange)',
          cyan: 'var(--color-accent-cyan)',
          pink: 'var(--color-accent-pink)'
        },
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)'
        }
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
