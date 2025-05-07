// Tool Library
const toolLibrary = {
    tools: {},
    
    addTool(toolNumber, toolType, toolMaterial, diameter, teeth, additionalParams = {}) {
        this.tools[toolNumber] = {
            type: toolType,
            material: toolMaterial,
            diameter: diameter,
            teeth: teeth,
            description: this.generateToolDescription(toolType, toolMaterial, diameter, additionalParams),
            ...additionalParams
        };
        this.updateToolTable();
    },
    
    generateToolDescription(type, material, diameter, additionalParams) {
        const typeNames = {
            'end_mill': 'End Mill',
            'face_mill': 'Face Mill',
            'drill': 'Drill',
            'tap': 'Tap',
            'thread_mill': 'Thread Mill'
        };
        
        const materialNames = {
            'hss': 'HSS',
            'carbide': 'Carbide'
        };
        
        let description = `${typeNames[type]} ${diameter}" ${materialNames[material]}`;
        
        if (type === 'tap') {
            const tpi = Math.round(1 / additionalParams.pitch);
            description += ` ${tpi} TPI`;
        } else if (type === 'thread_mill') {
            description += ` ${additionalParams.threadDirection} hand`;
        }
        
        return description;
    },
    
    updateToolTable() {
        const tbody = document.getElementById('tool-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        for (const [toolNumber, tool] of Object.entries(this.tools)) {
            const row = document.createElement('tr');
            
            row.innerHTML = `
            <td>${toolNumber}</td>
            <td>${tool.type}</td>
            <td>${tool.material}</td>
            <td>${tool.diameter}"</td>
            <td>${tool.teeth}</td>
            <td>${tool.description}</td>
            `;

            
            tbody.appendChild(row);
        }
    },
    
    getTool(toolNumber) {
        return this.tools[toolNumber];
    }
};

// G-code generator class with automatic speed/feed calculation
class HaasGCodeGenerator {
    constructor(programNumber = '0020', programName = 'Project Number') {
        this.gCode = [];
        this.programNumber = programNumber;
        this.programName = programName;
        this.currentTool = 1;
        this.currentSpindleSpeed = 2000;
        this.currentFeedRate = 10;
        this.safeZ = 2.0;
        this.rapidPlane = 0.1;
        this.toolOffset = 1;
        this.workOffset = 'G54';
        this.coolantMode = 'M8'; // Default to flood coolant
        this.spindleOverride = 100; // 100% by default
        this.decimalPlaces = 4;
        const tool = toolLibrary.getTool('1');
        const material = tool?.material || 'aluminum';
        const toolType = tool?.type || 'end_mill';
        
        // Track current tool position
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
        
        // Speed and feed data based on provided charts (all materials)
        
    }
        
    getMachiningData(material, toolType, diameter = 0.125) {
        const baseProfiles = {
            aluminum: { sfm: 150, chipload: 0.002 },
            brass: { sfm: 125, chipload: 0.0025 },
            tool_steel: { sfm: 50, chipload: 0.001 },
            stainless_steel: { sfm: 60, chipload: 0.0015 },
            cast_iron: { sfm: 70, chipload: 0.002 },
            delrin: { sfm: 600, chipload: 0.003 },
            abs: { sfm: 500, chipload: 0.0025 },
            nylon: { sfm: 400, chipload: 0.002 },
            peek: { sfm: 300, chipload: 0.0015 }
        };

        const toolModifiers = {
            end_mill:     { sfm: 1.0, chipload: 1.0 },
            drill:        { sfm: 0.8, chipload: 0.75 },
            tap:          { sfm: 0.6, chipload: 0.6 },
            thread_mill:  { sfm: 0.5, chipload: 0.5 }
        };

        const base = baseProfiles[material] || { sfm: 100, chipload: 0.001 };
        const mod = toolModifiers[toolType] || { sfm: 1.0, chipload: 1.0 };

        const adjustedChipload = this.getDiameterAdjustedChipload(base.chipload * mod.chipload, diameter);

        return {
            sfm: base.sfm * mod.sfm,
            chipload: adjustedChipload
        };
    }

    
    getDiameterAdjustedChipload(baseChipload, diameter) {
        if (diameter <= 0.0625) return baseChipload * 0.75;
        if (diameter <= 0.125)  return baseChipload;
        if (diameter <= 0.25)   return baseChipload * 1.25;
        if (diameter <= 0.375)  return baseChipload * 1.75;
        if (diameter <= 0.5)    return baseChipload * 2.25;
        if (diameter <= 0.75)   return baseChipload * 2.5;
        return baseChipload * 3;
    }
    
    calculateRPM(tool) {
        if (!tool || !tool.diameter || tool.diameter <= 0) {
            console.warn("Invalid tool diameter. Defaulting RPM to 1000.");
            return 1000;
        }
    
        const materialSelect = document.getElementById('material-select');
        let material = 'aluminum';
        if (materialSelect && materialSelect.value) {
            material = materialSelect.value.toLowerCase();
            if (!['aluminum','brass','tool_steel','stainless_steel','cast_iron','delrin','abs','nylon','peek'].includes(material)) {
                alert("Invalid or unsupported material selected.");
                material = 'aluminum';
            }
        }
        const machining = this.getMachiningData(material, tool.type);
        const sfm = machining?.sfm || 100;
        const rpm = (sfm * 3.82) / tool.diameter;
    
        return Math.round(rpm * (this.spindleOverride / 100));
    }
    
    calculateFeedRate(tool) {
        if (!tool || !tool.teeth || tool.teeth <= 0) {
            console.warn("Invalid tool teeth. Defaulting feed rate to 10.");
            return 10;
        }
    
        const materialSelect = document.getElementById('material-select');
        let material = 'aluminum';
        if (materialSelect && materialSelect.value) {
            material = materialSelect.value.toLowerCase();
            if (!['aluminum','brass','tool_steel','stainless_steel','cast_iron','delrin','abs','nylon','peek'].includes(material)) {
                alert("Invalid or unsupported material selected.");
                material = 'aluminum';
            }
        }
        const machining = this.getMachiningData(material, tool.type);
        const chipload = machining?.chipload || 0.001;
        const rpm = this.calculateRPM(tool);
    
        return Number((chipload * tool.teeth * rpm).toFixed(3));
    }    
  
    // Core formatting methods
    addLine(line = '') {
        this.gCode.push(line);
    }

    comment(text) {
        this.addLine(`(${text})`);
    }

    midpoint(p1, p2) { return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; }

    // Program structure
    programStart() {
        this.addLine('%');
        this.addLine(`O${this.programNumber}_ (${this.programName})`);
        this.addLine('G17 G40 G80 G54 G20');
        this.addLine('G28 G91 G0 X0 Y0 Z0');
        this.addLine('G90');
        // Reset position tracking
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
    }

    toolChange(toolNumber) {
        this.currentTool = toolNumber;
        const tool = toolLibrary.getTool(toolNumber.toString());
        if (tool) {
            const material = tool.material || 'aluminum';
            const toolType = tool.type || 'end_mill';
            this.machiningData = this.getMachiningData(material, toolType);
            if (tool) {
                this.currentFeedRate = this.calculateFeedRate(tool);
            }            
            this.addLine(`M06 T${toolNumber} (${tool.description})`);
        } else {
            this.addLine(`M06 T${toolNumber} (Tool ${toolNumber})`);
        }
        
    }
    

    startPosition(x, y) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.currentSpindleSpeed = this.calculateRPM(tool);
        }
        
        this.addLine(`G0 G90 ${this.workOffset} X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} S${this.currentSpindleSpeed} M3`);
        
        // Apply coolant mode from UI
        const coolantSelect = document.getElementById('coolant-mode');
        this.coolantMode = coolantSelect ? coolantSelect.value : 'M8';
        this.addLine(`G43 H${this.toolOffset} Z${this.rapidPlane.toFixed(this.decimalPlaces)} ${this.coolantMode}`);
        
        // Update position
        this.currentX = x;
        this.currentY = y;
        this.currentZ = this.rapidPlane;
    }

    getPosition() {
        return {
            x: this.currentX,
            y: this.currentY,
            z: this.currentZ
        };
    }

    // Movement commands
    rapidMove(x = null, y = null, z = null) {
        if (x === null) x = this.currentX;
        if (y === null) y = this.currentY;
        if (z === null) z = this.currentZ;
    
        this.addLine(`G0 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${z.toFixed(this.decimalPlaces)}`);
        this.currentX = x;
        this.currentY = y;
        this.currentZ = z;
    }
    

    linearMove(x = null, y = null, z = null, feedRate = null) {
        if (x === null) x = this.currentX;
        if (y === null) y = this.currentY;
        if (z === null) z = this.currentZ;
        if (feedRate !== null) this.currentFeedRate = feedRate;
    
        this.addLine(`G1 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${z.toFixed(this.decimalPlaces)} F${this.currentFeedRate}`);
        this.currentX = x;
        this.currentY = y;
        this.currentZ = z;
    }
    

    polygonalFaceMill(boundaryPoints, depth, stepDown, overlap = 0.2) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Polygonal facing with ${tool.description}`);
        } else {
            this.comment(`Polygonal facing`);
        }

        // Validate boundary points
        if (!boundaryPoints || boundaryPoints.length < 3) {
            console.error("Invalid boundary points - need at least 3 points to define a milling area");
            return;
        }

        // Close the boundary if not already closed
        if (boundaryPoints[0].x !== boundaryPoints[boundaryPoints.length-1].x || 
            boundaryPoints[0].y !== boundaryPoints[boundaryPoints.length-1].y) {
            boundaryPoints.push({...boundaryPoints[0]});
        }

        const toolRadius = tool ? tool.diameter / 2 : 0.25;
        const passes = Math.ceil(Math.abs(depth) / Math.abs(stepDown));
        const stepOver = (tool ? tool.diameter : 0.5) * (1 - overlap);

        // Calculate the bounding box of the area
        const bounds = this.calculateBounds(boundaryPoints);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        const maxRadius = Math.max(
            Math.sqrt(Math.pow(bounds.maxX - centerX, 2) + Math.pow(bounds.maxY - centerY, 2)),
            Math.sqrt(Math.pow(bounds.minX - centerX, 2) + Math.pow(bounds.minY - centerY, 2))
        );

        for (let pass = 1; pass <= passes; pass++) {
            const currentDepth = Math.min(pass * stepDown, depth);
            this.comment(`Pass ${pass} at depth ${currentDepth.toFixed(this.decimalPlaces)}`);

            // Start at center
            this.rapidMove(centerX, centerY, this.rapidPlane);
            this.linearMove(centerX, centerY, currentDepth);

            // Spiral out with offset passes
            for (let radius = stepOver; radius <= maxRadius + stepOver; radius += stepOver) {
                // Generate points along the boundary offset by current radius
                const offsetPoints = this.offsetPolygon(boundaryPoints, -radius);
                
                if (offsetPoints.length > 0) {
                    // Move to first point
                    this.linearMove(offsetPoints[0].x, offsetPoints[0].y, currentDepth);
                    
                    // Mill along offset boundary
                    for (let i = 1; i < offsetPoints.length; i++) {
                        this.linearMove(offsetPoints[i].x, offsetPoints[i].y, currentDepth);
                    }
                }
            }

            this.rapidMove(centerX, centerY, this.rapidPlane);
        }
    }

    // Helper function to calculate bounding box of points
    calculateBounds(points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        for (const point of points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        
        return { minX, maxX, minY, maxY };
    }

    // Helper function to offset a polygon inward
    offsetPolygon(points, offset) {
        if (points.length < 3) return [];
        
        const offsetPoints = [];
        const n = points.length;
        
        for (let i = 0; i < n - 1; i++) {
            const prev = points[(i - 1 + n) % (n - 1)];
            const curr = points[i];
            const next = points[(i + 1) % (n - 1)];
            
            // Calculate edge vectors
            const e1x = prev.x - curr.x;
            const e1y = prev.y - curr.y;
            const e2x = next.x - curr.x;
            const e2y = next.y - curr.y;
            
            // Normalize edge vectors
            const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
            const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
            
            if (len1 === 0 || len2 === 0) continue;
            
            const n1x = -e1y / len1;
            const n1y = e1x / len1;
            const n2x = -e2y / len2;
            const n2y = e2x / len2;
            
            // Calculate bisector
            const bisectorX = n1x + n2x;
            const bisectorY = n1y + n2y;
            const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);
            
            if (bisectorLen === 0) continue;
            
            // Calculate offset point
            const angle = Math.atan2(bisectorY, bisectorX);
            const offsetX = curr.x + offset * Math.cos(angle);
            const offsetY = curr.y + offset * Math.sin(angle);
            
            offsetPoints.push({ x: offsetX, y: offsetY });
        }
        
        // Close the polygon
        if (offsetPoints.length > 0) {
            offsetPoints.push({...offsetPoints[0]});
        }
        
        return offsetPoints;
    }


    // Corrected helical movement with position tracking
    helicalMove(endX, endY, endZ, clockwise = true) {
        const direction = clockwise ? 'G02' : 'G03';
        
        // Calculate center point relative to current position
        const centerX = this.midpoint([this.currentX,this.currentY],[endX,endY])[0];
        const centerY = this.midpoint([this.currentX,this.currentY],[endX,endY])[1];
        
        // Calculate I and J (relative to current position)
        const i = centerX - this.currentX;
        const j = centerY - this.currentY;
        
        // Validate calculations
        if (isNaN(i) || isNaN(j)) {
            console.error("Invalid I/J calculations in helicalMove");
            return;
        }
        
        this.addLine(`${direction} X${endX.toFixed(this.decimalPlaces)} Y${endY.toFixed(this.decimalPlaces)} Z${endZ.toFixed(this.decimalPlaces)} I${i.toFixed(this.decimalPlaces)} J${j.toFixed(this.decimalPlaces)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}`);
        
        // Update position
        this.currentX = endX;
        this.currentY = endY;
        this.currentZ = endZ;
    }

    // Helical milling operation using position tracking
    helicalMill(x, y, startZ, endZ, diameter, pitch, clockwise = true) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Helical milling at X${x} Y${y} with ${tool.description}`);
        } else {
            this.comment(`Helical milling at X${x} Y${y}`);
        }
        
        const radius = diameter / 2;
        const direction = clockwise ? 'G02' : 'G03';
        
        this.rapidMove(x, y, this.rapidPlane);
        this.plungeIntoPart(startZ);
        
        let currentZ = startZ;
        while (currentZ > endZ) {
            const nextZ = Math.max(currentZ - pitch, endZ);
            
            // Calculate I and J for full circle (relative to current position)
            const i = 0; // Center is directly to left/right of current position
            const j = clockwise ? -radius : radius;
            
            this.addLine(`${direction} X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${nextZ.toFixed(this.decimalPlaces)} I${i.toFixed(this.decimalPlaces)} J${j.toFixed(this.decimalPlaces)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}`);
            
            currentZ = nextZ;
        }
        
        this.rapidMove(x, y, this.rapidPlane);
    }

    plungeIntoPart(z) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.currentFeedRate = this.calculateFeedRate(tool)/2;
            this.addLine(`G1 Z${z.toFixed(this.decimalPlaces)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}`);
        } else {
            this.addLine(`(WARNING: No tool data for T${this.currentTool})`);
            this.addLine(`G1 Z${z.toFixed(this.decimalPlaces)} F${(this.currentFeedRate/2).toFixed(this.decimalPlaces)}`);
        }
    }

    programEnd() {
        this.addLine('G40 G80');
        this.addLine(`G0 Z${this.safeZ.toFixed(this.decimalPlaces)} M9`);
        this.addLine('G28 G91 G0 X0 Y0 Z0 M5');
        this.addLine('M30');
        this.addLine('%');
        return this.getGCode();
    }

    // Movement commands
    

    // Advanced movement
    

    // Work offset control
    setWorkOffset(offset) {
        this.workOffset = offset;
        this.addLine(offset);
    }

    resetWorkOffset() {
        this.workOffset = 'G54';
    }

    // Coolant control
    setCoolant(mode) {
        let code;
        switch(mode.toLowerCase()) {
            case 'flood': code = 'M8'; break;
            case 'mist': code = 'M7'; break;
            case 'off': code = 'M9'; break;
            default: code = 'M8';
        }
        this.coolantMode = code;
        this.addLine(code);
    }

    // Spindle control
    orientSpindle(angle) {
        this.addLine(`M19 S${angle}`);
    }

    setSpindleOverride(percent) {
        this.spindleOverride = Math.min(Math.max(percent, 0), 200);
        this.addLine(`G51 S${this.spindleOverride}`);
    }

    // Machining operations
    drillHole(x, y, startZ, depth, peckDepth = 0, dwell = 0) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Drilling hole at X${x} Y${y} with ${tool.description}`);
        } else {
            this.comment(`Drilling hole at X${x} Y${y}`);
        }
        
        this.rapidMove(x, y, this.rapidPlane);
        this.plungeIntoPart(startZ);
        
        if (peckDepth > 0) {
            this.addLine(`G83 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${depth.toFixed(this.decimalPlaces)} Q${peckDepth.toFixed(this.decimalPlaces)} R${startZ.toFixed(this.decimalPlaces)} P${dwell.toFixed(2)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}`);
        } else {
            this.addLine(`G81 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${depth.toFixed(this.decimalPlaces)} R${startZ.toFixed(this.decimalPlaces)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}${dwell > 0 ? ` P${dwell.toFixed(2)}` : ''}`);
        }
        
        this.addLine('G80');
        this.rapidMove(x, y, this.rapidPlane);
    }

    tapHole(x, y, startZ, depth, pitch, peckDepth = 0) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Tapping hole at X${x} Y${y} with ${tool.description}`);
        } else {
            this.comment(`Tapping hole at X${x} Y${y}`);
        }
        
        this.rapidMove(x, y, this.rapidPlane);
        this.plungeIntoPart(startZ);
        
        if (peckDepth > 0) {
            // Rigid tapping with peck (G84.2 on Haas)
            this.addLine(`G84.2 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${depth.toFixed(this.decimalPlaces)} Q${peckDepth.toFixed(this.decimalPlaces)} R${startZ.toFixed(this.decimalPlaces)} F${pitch.toFixed(this.decimalPlaces)}`);
        } else {
            // Standard rigid tapping
            this.addLine(`G84 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${depth.toFixed(this.decimalPlaces)} R${startZ.toFixed(this.decimalPlaces)} F${pitch.toFixed(this.decimalPlaces)}`);
        }
        
        this.addLine('G80');
        this.rapidMove(x, y, this.rapidPlane);
    }

    faceMill(startX, startY, width, length, depth, stepDown) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Facing operation with ${tool.description}`);
        } else {
            this.comment(`Facing operation`);
        }
        
        const radius = tool ? tool.diameter / 2 : 0.25;
        const passes = Math.ceil(Math.abs(depth) / Math.abs(stepDown));
        
        for (let pass = 1; pass <= passes; pass++) {
            const currentDepth = Math.min(pass * stepDown, depth);
            this.comment(`Pass ${pass} at depth ${currentDepth.toFixed(this.decimalPlaces)}`);
            
            for (let y = startY + radius; y <= startY + length - radius; y += (tool ? tool.diameter * 0.8 : 0.4)) {
                this.rapidMove(startX + radius, y, this.rapidPlane);
                this.linearMove(startX + radius, y, currentDepth);
                this.linearMove(startX + width - radius, y, currentDepth);
                this.rapidMove(startX + width - radius, y, this.rapidPlane);
            }
        }
        
        this.rapidMove(startX + radius, startY + radius, this.rapidPlane);
    }

    contourMill(contourPoints, depth, stepDown) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Contour milling with ${tool.description}`);
        } else {
            this.comment(`Contour milling`);
        }
        
        const radius = tool ? tool.diameter / 2 : 0.25;
        const passes = Math.ceil(Math.abs(depth) / Math.abs(stepDown));
        
        for (let pass = 1; pass <= passes; pass++) {
            const currentDepth = Math.min(pass * stepDown, depth);
            this.comment(`Pass ${pass} at depth ${currentDepth.toFixed(this.decimalPlaces)}`);
            
            const closedPoints = [...contourPoints];
            if (
                contourPoints[0].x !== contourPoints[contourPoints.length - 1].x ||
                contourPoints[0].y !== contourPoints[contourPoints.length - 1].y
            ) {
                closedPoints.push({...contourPoints[0]});
            }

            this.rapidMove(closedPoints[0].x + radius, closedPoints[0].y + radius, this.rapidPlane);
            this.linearMove(closedPoints[0].x + radius, closedPoints[0].y + radius, currentDepth);

            for (let i = 1; i < closedPoints.length; i++) {
                const point = closedPoints[i];
                this.linearMove(point.x + radius, point.y + radius, currentDepth);
            }
            this.rapidMove(closedPoints[0].x + radius, closedPoints[0].y + radius, this.rapidPlane);

            
            for (let i = 1; i < contourPoints.length; i++) {
                const point = contourPoints[i];
                this.linearMove(point.x + radius, point.y + radius, currentDepth);
            }
            
            this.linearMove(firstPoint.x + radius, firstPoint.y + radius, currentDepth);
            this.rapidMove(firstPoint.x + radius, firstPoint.y + radius, this.rapidPlane);
        }
    }

    pocketMill(startX, startY, width, length, depth, stepDown) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Pocket milling with ${tool.description}`);
        } else {
            this.comment(`Pocket milling`);
        }
        
        const radius = tool ? tool.diameter / 2 : 0.25;
        const passes = Math.ceil(Math.abs(depth) / Math.abs(stepDown));
        
        for (let pass = 1; pass <= passes; pass++) {
            const currentDepth = Math.min(pass * stepDown, depth);
            this.comment(`Pass ${pass} at depth ${currentDepth.toFixed(this.decimalPlaces)}`);
            
            let offset = 0;
            while (offset < width/2 - radius && offset < length/2 - radius) {
                this.rapidMove(startX + radius + offset, startY + radius + offset, this.rapidPlane);
                this.linearMove(startX + radius + offset, startY + radius + offset, currentDepth);
                
                this.linearMove(startX + width - radius - offset, startY + radius + offset, currentDepth);
                this.linearMove(startX + width - radius - offset, startY + length - radius - offset, currentDepth);
                this.linearMove(startX + radius + offset, startY + length - radius - offset, currentDepth);
                this.linearMove(startX + radius + offset, startY + radius + offset, currentDepth);
                
                offset += (tool ? tool.diameter * 0.8 : 0.4);
            }
        }
        
        this.rapidMove(startX + width/2, startY + length/2, this.rapidPlane);
    }
    

    // Thread milling operation
    millThread(x, y, startZ, pitch, length, diameter, internal = true, direction = 'right') {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.comment(`Thread milling at X${x} Y${y} with ${tool.description}`);
        } else {
            this.comment(`Thread milling at X${x} Y${y}`);
        }
        
        const radius = diameter / 2;
        const toolRadius = tool ? tool.diameter / 2 : 0.25;
        const effectiveRadius = internal ? (radius - toolRadius) : (radius + toolRadius);
        const circleDirection = (direction === 'right') ? 'G03' : 'G02';
        
        this.rapidMove(x + effectiveRadius, y, this.rapidPlane);
        this.plungeIntoPart(startZ);
        
        // Calculate number of circles needed
        const circles = Math.ceil(length / pitch);
        
        for (let i = 0; i < circles; i++) {
            const currentZ = startZ - (i * pitch);
            const nextZ = Math.max(currentZ - pitch, startZ - length);
            
            // Helical interpolation
            this.addLine(`${circleDirection} X${x + effectiveRadius} Y${y} Z${nextZ} I${-effectiveRadius} J0 F${this.currentFeedRate}`);
        }
        
        // Complete the final partial circle if needed
        if (circles * pitch < length) {
            const remaining = length - (circles * pitch);
            const finalZ = startZ - length;
            this.addLine(`${circleDirection} X${x + effectiveRadius} Y${y} Z${finalZ} I${-effectiveRadius} J0 F${this.currentFeedRate}`);
        }
        
        this.rapidMove(x + effectiveRadius, y, this.rapidPlane);
    }

    getGCode() {
        return this.gCode.join('\n');
    }
}
