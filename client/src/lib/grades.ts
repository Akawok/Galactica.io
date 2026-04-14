export const GRADES = [
	{ minLevel: 1,  label: 'Recrue',      color: '#a0a8c0' },
	{ minLevel: 3,  label: 'Cadet',       color: '#78d6ff' },
	{ minLevel: 5,  label: 'Pilote',      color: '#a8ff78' },
	{ minLevel: 8,  label: 'Sergent',     color: '#ffd700' },
	{ minLevel: 12, label: 'Lieutenant',  color: '#ff9c38' },
	{ minLevel: 17, label: 'Capitaine',   color: '#ff5f87' },
	{ minLevel: 23, label: 'Commandant',  color: '#c084fc' },
	{ minLevel: 30, label: 'Amiral',      color: '#38bdf8' },
	{ minLevel: 40, label: 'Grand Amiral',color: '#f97316' },
	{ minLevel: 50, label: 'Légende',     color: '#e11d48' },
];

export function getGrade(level: number) {
	let grade = GRADES[0];
	for (const g of GRADES) {
		if (level >= g.minLevel) grade = g;
	}
	return grade;
}
