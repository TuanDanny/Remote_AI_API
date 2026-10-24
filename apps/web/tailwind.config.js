/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        card: '#161b22',
        border: '#30363d',
        primary: '#58a6ff',
      }
    },
  },
  plugins: [],
}
