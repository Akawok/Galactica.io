import gifFrames from "gif-frames";
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "client/static/assets");
mkdirSync(outDir, { recursive: true });

const ships = ["ship1", "ship2", "ship3", "ship4", "ship5"];

for (const ship of ships) {
  try {
    const frames = await gifFrames({
      url: join(__dirname, `media/${ship}.gif`),
      frames: 0,
      outputType: "png",
    });

    const outPath = join(outDir, `${ship}.png`);
    frames[0].getImage().pipe(createWriteStream(outPath));
    console.log(`✅ ${ship}.png extrait`);
  } catch (err) {
    console.error(`❌ ${ship} : ${err.message}`);
  }
}
