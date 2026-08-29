import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = "plugins/k3s-context/ai.agenon.k3s-context.sdPlugin/imgs";

/** Kubernetes-blue rounded tile with an optional glyph. */
function tile(size, background, glyph) {
	const radius = Math.round(size * 0.18);
	const fontSize = Math.round(size * 0.5);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Helvetica, Arial, sans-serif" font-weight="bold"
        font-size="${fontSize}" fill="#ffffff">${glyph}</text>
</svg>`;
}

/** Transparent glyph for list icons, which sit on the Stream Deck app chrome. */
function glyphOnly(size, glyph) {
	const fontSize = Math.round(size * 0.8);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Helvetica, Arial, sans-serif" font-weight="bold"
        font-size="${fontSize}" fill="#ffffff">${glyph}</text>
</svg>`;
}

const targets = [
	["plugin/marketplace", 288, () => tile(288, "#326ce5", "k8s")],
	["plugin/category-icon", 28, (s) => glyphOnly(s, "k")],
	["actions/cycle/icon", 20, (s) => glyphOnly(s, "↻")],
	["actions/cycle/key", 72, (s) => tile(s, "#326ce5", "↻")],
	["actions/pin/icon", 20, (s) => glyphOnly(s, "◉")],
	["actions/pin/key-inactive", 72, (s) => tile(s, "#3b4351", "○")],
	["actions/pin/key-active", 72, (s) => tile(s, "#326ce5", "◉")],
];

for (const [name, size, render] of targets) {
	const out = join(root, name);
	await mkdir(dirname(out), { recursive: true });
	for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
		const px = size * scale;
		const png = await sharp(Buffer.from(render(px))).resize(px, px).png().toBuffer();
		await writeFile(`${out}${suffix}.png`, png);
		console.log(`wrote ${out}${suffix}.png (${px}x${px})`);
	}
}
