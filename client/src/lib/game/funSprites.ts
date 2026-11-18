import { Graphics } from 'pixi.js';

// En partie, tous les vaisseaux et tous les tirs sont redessinés ici ; le lobby et la boutique gardent les vrais designs.

const SKIN = 0xf2b8a0;
const SKIN_SHADE = 0xd99682;
const SKIN_LIGHT = 0xffd9c9;
const TIP = 0xe58a8a;
const TIP_SHADE = 0xc96b6f;
const VEIN = 0xa77bb0;
const HAIR = 0x4a2c20;
const OUTLINE = 0x8a4b3a;

// Pointe vers le haut (-y), comme les images de vaisseaux, dans une boîte de 64 de haut.
export function drawFunShip(): Graphics {
	const line = { width: 2, color: OUTLINE };
	const thin = { width: 1, color: OUTLINE, alpha: 0.6 };
	const g = new Graphics();

	// Bourses : ombre en bas, reflet, pli au milieu
	for (const side of [-1, 1]) {
		const cx = side * 9;
		g.circle(cx, 20, 11).fill(SKIN).stroke(line);
		g.ellipse(cx + side * 2, 25, 7, 4).fill({ color: SKIN_SHADE, alpha: 0.7 });
		g.ellipse(cx - side * 3, 15, 3, 2).fill({ color: SKIN_LIGHT, alpha: 0.8 });
	}
	g.moveTo(0, 13).quadraticCurveTo(1, 21, 0, 30).stroke(thin);

	// Poils à la base
	for (const [x, y, dx] of [
		[-17, 11, -3],
		[-13, 9, -1],
		[13, 9, 1],
		[17, 11, 3],
		[-5, 10, -2],
		[5, 10, 2]
	]) {
		g.moveTo(x, y)
			.quadraticCurveTo(x + dx, y - 3, x + dx * 1.5, y - 6)
			.stroke({ width: 1, color: HAIR });
	}

	// Tige : ombre sur un côté, reflet de l'autre, deux veines
	g.roundRect(-9, -22, 18, 40, 9).fill(SKIN).stroke(line);
	g.roundRect(3, -18, 5, 33, 3).fill({ color: SKIN_SHADE, alpha: 0.6 });
	g.roundRect(-6, -16, 3, 26, 2).fill({ color: SKIN_LIGHT, alpha: 0.7 });
	g.moveTo(-2, 14)
		.bezierCurveTo(-5, 6, 1, 0, -3, -8)
		.bezierCurveTo(-5, -12, -2, -15, -3, -18)
		.stroke({ width: 1.5, color: VEIN, alpha: 0.8 });
	g.moveTo(3, 10).bezierCurveTo(5, 4, 2, -2, 4, -10).stroke({ width: 1, color: VEIN, alpha: 0.7 });

	// Gland : bourrelet, ombre, reflet, méat
	g.ellipse(0, -24, 12, 10).fill(TIP).stroke(line);
	g.ellipse(4, -21, 6, 5).fill({ color: TIP_SHADE, alpha: 0.6 });
	g.ellipse(-4, -28, 3.5, 2.5).fill({ color: 0xffffff, alpha: 0.55 });
	g.moveTo(-11, -18).quadraticCurveTo(0, -13, 11, -18).stroke({ width: 1.5, color: TIP_SHADE });
	g.moveTo(0, -34).lineTo(0, -28).stroke({ width: 1.5, color: TIP_SHADE });

	return g;
}

// Goutte orientée vers +x (sens du tir), la traîne derrière.
export function drawFunBullet(special: boolean): Graphics {
	const g = new Graphics()
		.poly([-9, 0, 0, -3.5, 0, 3.5])
		.fill(0xfdfdf0)
		.circle(1, 0, 4)
		.fill(0xfdfdf0)
		.circle(2.5, -1.5, 1.2)
		.fill({ color: 0xffffff, alpha: 0.9 });
	if (special) g.scale.set(1.8);
	return g;
}
