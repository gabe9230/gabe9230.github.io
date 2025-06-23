// gcodeparser.js
// Adds a global window.parseGCode function

window.parseGCode = function (gcode) {
	const lines = gcode.split('\n');
	const commands = [];
  
	let currentPos = { x: 0, y: 0, z: 0 };
	let absoluteMode = true;
  
	for (let rawLine of lines) {
	  const line = rawLine.replace(/;.*|\(.*?\)/g, '').trim().toUpperCase();
	  if (!line) continue;
  
	  if (line.includes('G90')) absoluteMode = true;
	  if (line.includes('G91')) absoluteMode = false;
  
	  const gMatch = line.match(/G0?1?/);
	  const x = extractCoord(line, 'X');
	  const y = extractCoord(line, 'Y');
	  const z = extractCoord(line, 'Z');
  
	  const nextPos = {
		x: x !== null ? (absoluteMode ? x : currentPos.x + x) : currentPos.x,
		y: y !== null ? (absoluteMode ? y : currentPos.y + y) : currentPos.y,
		z: z !== null ? (absoluteMode ? z : currentPos.z + z) : currentPos.z
	  };
  
	  if (gMatch && (gMatch[0] === 'G0' || gMatch[0] === 'G1')) {
		commands.push({
		  type: gMatch[0] === 'G0' ? 'rapid' : 'cut',
		  from: { ...currentPos },
		  to: { ...nextPos }
		});
	  }
  
	  currentPos = nextPos;
	}
  
	return commands;
  };
  
  function extractCoord(line, axis) {
	const match = line.match(new RegExp(`${axis}(-?\\d*\\.?\\d+)`));
	return match ? parseFloat(match[1]) : null;
  }