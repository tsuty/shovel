/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        // コンソールの面。チャットと取り違えないよう、ライトでもダークでも
        // 周りよりはっきり暗い色にする。
        terminal: {
          DEFAULT: 'hsl(var(--terminal))',
          foreground: 'hsl(var(--terminal-foreground))',
          muted: 'hsl(var(--terminal-muted))'
        }
      },
      // 設定「トランスクリプトの文字サイズ」（--transcript-font-size）を基準に
      // した相対サイズ。本文=1、ラベル・ツール行=0.85、その補足=0.78。
      fontSize: {
        transcript: ['var(--transcript-font-size)', { lineHeight: '1.6' }],
        'transcript-sm': ['calc(var(--transcript-font-size) * 0.85)', { lineHeight: '1.5' }],
        'transcript-xs': ['calc(var(--transcript-font-size) * 0.78)', { lineHeight: '1.5' }]
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      }
    }
  },
  plugins: []
}
