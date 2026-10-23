const plugin = require("tailwindcss/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			surface: {
  				DEFAULT: 'hsl(var(--surface))',
  				'2': 'hsl(var(--surface-2))'
  			},
  			stone: 'hsl(var(--stone))',
  			ink: {
  				DEFAULT: 'hsl(var(--ink))',
  				'2': 'hsl(var(--ink-2))',
  				'3': 'hsl(var(--ink-3))'
  			},
  			placeholder: 'hsl(var(--placeholder))',
  			frame: 'hsl(var(--frame))',
  			panel: 'hsl(var(--panel))',
  			faint: {
  				DEFAULT: 'hsl(var(--faint))',
  				'2': 'hsl(var(--faint-2))'
  			},
  			line: {
  				DEFAULT: 'hsl(var(--line))',
  				'2': 'hsl(var(--line-2))',
  				'3': 'hsl(var(--line-3))',
  				'4': 'hsl(var(--line-4))'
  			},
  			'ink-hover': 'hsl(var(--ink-hover))',
  			inv: 'hsl(var(--inv))',
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				hover: 'hsl(var(--brand-hover))',
  				foreground: 'hsl(var(--brand-foreground))'
  			},
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
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		boxShadow: {
  			ring: 'var(--shadow-ring)',
  			float: 'var(--shadow-float)',
  			// Legacy names (Task 21 removes): nothing but ring and float casts a shadow now.
  			hairline: 'var(--shadow-ring)',
  			lift: 'var(--shadow-ring)',
  			hero: 'var(--shadow-float)'
  		},
  		transitionTimingFunction: {
  			iq: 'cubic-bezier(.25,1,.5,1)'
  		},
  		borderRadius: {
  			DEFAULT: 'calc(var(--radius) - 4px)',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			tile: '18px',
  			card: '24px',
  			hero: '32px'
  		},
  		fontFamily: {
  			sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  			display: ['var(--font-display)', 'var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  			mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace']
  		}
  	}
  },
  plugins: [
    require("tailwindcss-animate"),
    // `hud:` = only inside the signed-in HUD scope (class set on <html> by useHudScope).
    plugin(({ addVariant }) => addVariant("hud", ".iq-hud &")),
  ],
};
