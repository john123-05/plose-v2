/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'scroll': 'scroll-left 20s linear infinite',
        'bounce-smooth': 'bounce-smooth 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
