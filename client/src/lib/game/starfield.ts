import { Application, Graphics, Container } from 'pixi.js';

interface Star {
	x: number;
	y: number;
	speed: number;
	size: number;
	alpha: number;
	graphic: Graphics;
}

export class Starfield {
	private layers: Star[][] = [];
	private container: Container;
	private width: number;
	private height: number;

	constructor(app: Application, width: number, height: number) {
		this.container = new Container();
		this.width = width;
		this.height = height;

		const layerConfigs = [
			{ count: 80, speedRange: [0.1, 0.3], sizeRange: [0.5, 1], alphaRange: [0.3, 0.5] },
			{ count: 50, speedRange: [0.3, 0.6], sizeRange: [1, 1.5], alphaRange: [0.5, 0.7] },
			{ count: 25, speedRange: [0.6, 1.0], sizeRange: [1.5, 2.5], alphaRange: [0.7, 1.0] }
		];

		for (const config of layerConfigs) {
			const layer: Star[] = [];
			for (let i = 0; i < config.count; i++) {
				const g = new Graphics();
				const size = random(config.sizeRange[0], config.sizeRange[1]);
				const alpha = random(config.alphaRange[0], config.alphaRange[1]);
				g.circle(0, 0, size).fill({ color: 0xffffff, alpha });
				const star: Star = {
					x: Math.random() * width,
					y: Math.random() * height,
					speed: random(config.speedRange[0], config.speedRange[1]),
					size,
					alpha,
					graphic: g
				};
				g.x = star.x;
				g.y = star.y;
				this.container.addChild(g);
				layer.push(star);
			}
			this.layers.push(layer);
		}

		app.stage.addChildAt(this.container, 0);
	}

	update(dt: number = 1) {
		for (const layer of this.layers) {
			for (const star of layer) {
				star.y += star.speed * dt;
				if (star.y > this.height + 5) {
					star.y = -5;
					star.x = Math.random() * this.width;
				}
				star.graphic.x = star.x;
				star.graphic.y = star.y;
			}
		}
	}

	destroy() {
		this.container.destroy({ children: true });
	}
}

function random(min: number, max: number) {
	return min + Math.random() * (max - min);
}
