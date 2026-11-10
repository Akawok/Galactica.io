export const GRADES = [
	{ minLevel: 1,  label: 'Recrue',       color: '#a0a8c0' },
	{ minLevel: 3,  label: 'Cadet',        color: '#78d6ff' },
	{ minLevel: 6,  label: 'Aspirant',     color: '#a8ff78' },
	{ minLevel: 10, label: 'Sergent',      color: '#ffd700' },
	{ minLevel: 15, label: 'Lieutenant',   color: '#ff9c38' },
	{ minLevel: 20, label: 'Capitaine',    color: '#ff5f87' },
	{ minLevel: 26, label: 'Commandant',   color: '#c084fc' },
	{ minLevel: 33, label: 'Commodore',    color: '#2dd4bf' },
	{ minLevel: 40, label: 'Amiral',       color: '#38bdf8' },
	{ minLevel: 48, label: 'Grand Amiral', color: '#f97316' },
	{ minLevel: 55, label: 'Maréchal',     color: '#e2e8f0' },
	{ minLevel: 60, label: 'Légende',      color: '#e11d48' },
];

export function getGrade(level: number) {
	let grade = GRADES[0];
	for (const g of GRADES) {
		if (level >= g.minLevel) grade = g;
	}
	return grade;
}
