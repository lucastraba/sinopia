// Prints the dark palette for src/viewer/style.css: each Tailwind palette the viewer
// uses, mirrored (50 <-> 950, 100 <-> 900, ...). Run it again when the viewer starts
// using a new color: node scripts/dark-palette.mjs node_modules/tailwindcss/theme.css
import { readFileSync } from 'node:fs';
const theme = readFileSync(process.argv[2], 'utf8');
const palettes = ['slate', 'stone', 'sky', 'violet', 'teal', 'emerald', 'amber', 'indigo', 'orange', 'red', 'blue', 'fuchsia'];
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const value = (name) => {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(theme);
  if (!match) throw new Error(name);
  return match[1].trim();
};
const lines = [];
for (const palette of palettes) {
  for (const shade of shades) {
    const mirror = shade === 50 ? 950 : shade === 950 ? 50 : 1000 - shade;
    lines.push(`  --color-${palette}-${shade}: ${value(`${palette}-${mirror}`)};`);
  }
}
// White is the card and panel surface: a step above the page (slate-50 → slate-950).
lines.push(`  --color-white: ${value('slate-900')};`);
console.log(lines.join('\n'));
