/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // CaseLab design system tokens (keys match the design system README)
      colors: {
        brand: { DEFAULT: '#6A3DE8', dark: '#4A22B8', soft: '#ECE5FF', tint: '#F6F2FF' },
        ink: { DEFAULT: '#1C1636', soft: '#4B4469', mute: '#69628A' },
        sun: { DEFAULT: '#FFC53D', dark: '#C98A00', soft: '#FFF4D4' },
        paper: '#F7F5FE',
        line: '#E5E0F4',
        ok: { DEFAULT: '#1FAF6B', dark: '#11734A', soft: '#E6F8EF' },
        bad: { DEFAULT: '#E8455F', dark: '#A3213A', soft: '#FFECEF' },
        warn: { DEFAULT: '#E58A1F', dark: '#8A4B00', soft: '#FFF4E5' },
        sky: { DEFAULT: '#12B5CB', dark: '#0B6E7C', soft: '#E3F7FA' }
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,22,54,.05), 0 4px 16px rgba(28,22,54,.06)',
        lift: '0 12px 32px rgba(106,61,232,.16)',
        press: '0 3px 0 #4A22B8'
      },
      maxWidth: {
        content: '1152px',
        lesson: '768px'
      }
    },
  },
  plugins: [],
}
