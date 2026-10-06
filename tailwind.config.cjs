/** @type {import('tailwindcss').Config} */

// DietBridge tasarım sistemi belirteci: styles.css içindeki --db-* kanal değişkenini okur.
const token = (name) => `rgb(var(--db-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
    './features/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Faz 1 öncesi sayfa renkleri: ekranlar yeni sisteme taşınana kadar korunur.
        primary: '#10B981',
        'primary-dark': '#059669',
        'diet-green': '#509F42',
        'background-light': '#F8FAFC',
        'card-light': '#FFFFFF',
        'text-main': '#334155',
        'text-muted': '#64748B',

        // Faz 1 tasarım sistemi (prototip :root değişkenleri).
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          alt: token('surface-alt'),
          hover: token('surface-hover'),
        },
        sunk: token('sunk'),
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
          3: token('ink-3'),
        },
        brand: {
          DEFAULT: token('brand'),
          hi: token('brand-hi'),
          tint: token('brand-tint'),
          soft: token('brand-soft'),
          lime: token('brand-lime'),
          'lime-ink': token('brand-lime-ink'),
        },
        ok: { DEFAULT: token('ok'), bg: token('ok-bg'), ink: token('ok-ink') },
        warn: { DEFAULT: token('warn'), bg: token('warn-bg'), ink: token('warn-ink') },
        bad: { DEFAULT: token('bad'), bg: token('bad-bg'), line: token('bad-line') },
        info: { DEFAULT: token('info'), bg: token('info-bg') },
        vio: { DEFAULT: token('vio'), bg: token('vio-bg') },
        water: token('water'),
        scrim: 'rgb(24 34 29 / 0.38)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        inter: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // Prototipin piksel ölçeği: text-11 … text-28.
        10: ['10px', { lineHeight: '1.4' }],
        11: ['11px', { lineHeight: '1.4' }],
        11.5: ['11.5px', { lineHeight: '1.4' }],
        12: ['12px', { lineHeight: '1.45' }],
        12.5: ['12.5px', { lineHeight: '1.45' }],
        13: ['13px', { lineHeight: '1.5' }],
        13.5: ['13.5px', { lineHeight: '1.5' }],
        14: ['14px', { lineHeight: '1.5' }],
        15: ['15px', { lineHeight: '1.45' }],
        16: ['16px', { lineHeight: '1.4' }],
        17: ['17px', { lineHeight: '1.35' }],
        19: ['19px', { lineHeight: '1.3' }],
        20: ['20px', { lineHeight: '1.3' }],
        22: ['22px', { lineHeight: '1.25' }],
        24: ['24px', { lineHeight: '1.25' }],
        26: ['26px', { lineHeight: '1.2' }],
        28: ['28px', { lineHeight: '1.15' }],
        30: ['30px', { lineHeight: '1.15' }],
      },
      borderRadius: {
        tag: '6px',
        control: '9px',
        db: '10px',
        card: '14px',
        modal: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(24, 34, 29, 0.04)',
        seg: '0 1px 2px rgba(0, 0, 0, 0.06)',
        pop: '0 18px 40px rgba(0, 0, 0, 0.16)',
        modal: '0 24px 60px rgba(24, 34, 29, 0.25)',
        drawer: '-12px 0 40px rgba(24, 34, 29, 0.12)',
        focus: '0 0 0 3px rgb(var(--db-brand-tint))',
        'focus-bad': '0 0 0 3px rgb(var(--db-bad-bg))',
      },
      spacing: {
        sidebar: '248px',
      },
    },
  },
  plugins: [],
};
