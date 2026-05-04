/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',

  content: [
    './src/views/**/*.ejs',
    './src/public/js/**/*.js',
  ],

  theme: {
    extend: {
      colors: {
        primary: '#1a1a2e',
        accent: {
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f0a500',
          600: '#d97706',
        },
      },

      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },

      animation: {
        'slide-in-up': 'slideInUp 0.4s ease-out',
      },

      keyframes: {
        slideInUp: {
          '0%': {
            transform: 'translateY(20px)',
            opacity: '0',
          },
          '100%': {
            transform: 'translateY(0)',
            opacity: '1',
          },
        },
      },
    },
  },

  plugins: [],
};