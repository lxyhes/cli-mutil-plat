const cssVarColor = (name) => {
  return ({ opacityValue } = {}) => {
    if (opacityValue === undefined) return `var(${name})`
    const numericOpacity = Number(opacityValue)
    const opacity = Number.isFinite(numericOpacity)
      ? `${numericOpacity * 100}%`
      : `calc(${opacityValue} * 100%)`
    return `color-mix(in srgb, var(${name}) ${opacity}, transparent)`
  }
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: cssVarColor('--color-bg-primary'),
          secondary: cssVarColor('--color-bg-secondary'),
          tertiary: cssVarColor('--color-bg-tertiary'),
          hover: cssVarColor('--color-bg-hover'),
          elevated: cssVarColor('--color-bg-elevated'),
          input: cssVarColor('--color-input-bg')
        },
        text: {
          primary: cssVarColor('--color-text-primary'),
          secondary: cssVarColor('--color-text-secondary'),
          muted: cssVarColor('--color-text-muted'),
          placeholder: cssVarColor('--color-text-placeholder')
        },
        accent: {
          blue: cssVarColor('--color-accent-blue'),
          green: cssVarColor('--color-accent-green'),
          yellow: cssVarColor('--color-accent-yellow'),
          red: cssVarColor('--color-accent-red'),
          purple: cssVarColor('--color-accent-purple'),
          orange: cssVarColor('--color-accent-orange'),
          cyan: cssVarColor('--color-accent-cyan'),
          pink: cssVarColor('--color-accent-pink')
        },
        border: {
          DEFAULT: cssVarColor('--color-border'),
          subtle: cssVarColor('--color-border-subtle')
        }
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
