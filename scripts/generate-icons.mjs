import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
const resources = new URL('../resources/', import.meta.url);
const svg = fs.readFileSync(new URL('icon.svg', resources), 'utf8');
for (const [name, width] of [['icon.png', 256], ['tray.png', 32], ['tray@1.5x.png', 48], ['tray@2x.png', 64]]) {
  fs.writeFileSync(new URL(name, resources), new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
fs.writeFileSync(new URL('icon.ico', resources), await pngToIco(fs.readFileSync(new URL('icon.png', resources))));
