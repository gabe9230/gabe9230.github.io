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
            description += ` ${1/additionalParams.pitch} TPI`;
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
                <td>${tool.type.replace('_', ' ').toUpperCase()}</td>
                <td>${tool.material.toUpperCase()}</td>
                <td>${tool.diameter}"</td>
                <td>${tool.teeth}</td>
                <td>${tool.material === 'hss' ? 'HSS' : 'Carbide'}</td>
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
        
        // Track current tool position
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
        
        // Speed and feed data based on provided charts (all materials)
        this.machiningData = this.getMachiningData();
    }
    

    getMachiningData() {
        return {
            aluminum: {
                hss: {
                    end_mill: { speed: 200, feed_per_tooth: 0.005 },
                    face_mill: { speed: 200, feed_per_tooth: 0.005 },
                    drill: { speed: 125, feed_per_rev: 0.010 },
                    tap: { speed: 50, feed_per_rev: 1.0 }, // Feed per rev = pitch for tapping
                    thread_mill: { speed: 150, feed_per_tooth: 0.002 }
                },
                carbide: {
                    end_mill: { speed: 800, feed_per_tooth: 0.005 },
                    face_mill: { speed: 800, feed_per_tooth: 0.005 },
                    drill: { speed: 250, feed_per_rev: 0.010 },
                    tap: { speed: 100, feed_per_rev: 1.0 },
                    thread_mill: { speed: 600, feed_per_tooth: 0.002 }
                }
            },
            brass: {
                hss: {
                    end_mill: { speed: 125, feed_per_tooth: 0.003 },
                    face_mill: { speed: 125, feed_per_tooth: 0.003 },
                    drill: { speed: 100, feed_per_rev: 0.008 }
                },
                carbide: {
                    end_mill: { speed: 500, feed_per_tooth: 0.003 },
                    face_mill: { speed: 500, feed_per_tooth: 0.003 },
                    drill: { speed: 200, feed_per_rev: 0.008 }
                }
            },
            bronze: {
                hss: {
                    end_mill: { speed: 100, feed_per_tooth: 0.002 },
                    face_mill: { speed: 100, feed_per_tooth: 0.002 },
                    drill: { speed: 80, feed_per_rev: 0.006 }
                },
                carbide: {
                    end_mill: { speed: 400, feed_per_tooth: 0.002 },
                    face_mill: { speed: 400, feed_per_tooth: 0.002 },
                    drill: { speed: 160, feed_per_rev: 0.006 }
                }
            },
            cast_iron: {
                hss: {
                    end_mill: { speed: 75, feed_per_tooth: 0.002 },
                    face_mill: { speed: 75, feed_per_tooth: 0.002 },
                    drill: { speed: 60, feed_per_rev: 0.004 }
                },
                carbide: {
                    end_mill: { speed: 300, feed_per_tooth: 0.002 },
                    face_mill: { speed: 300, feed_per_tooth: 0.002 },
                    drill: { speed: 120, feed_per_rev: 0.004 }
                }
            },
            free_machining_steel: {
                hss: {
                    end_mill: { speed: 120, feed_per_tooth: 0.003 },
                    face_mill: { speed: 120, feed_per_tooth: 0.003 },
                    drill: { speed: 100, feed_per_rev: 0.006 }
                },
                carbide: {
                    end_mill: { speed: 500, feed_per_tooth: 0.003 },
                    face_mill: { speed: 500, feed_per_tooth: 0.003 },
                    drill: { speed: 200, feed_per_rev: 0.006 }
                }
            },
            low_carbon_steel: {
                hss: {
                    end_mill: { speed: 90, feed_per_tooth: 0.003 },
                    face_mill: { speed: 90, feed_per_tooth: 0.003 },
                    drill: { speed: 80, feed_per_rev: 0.005 }
                },
                carbide: {
                    end_mill: { speed: 350, feed_per_tooth: 0.003 },
                    face_mill: { speed: 350, feed_per_tooth: 0.003 },
                    drill: { speed: 160, feed_per_rev: 0.005 }
                }
            },
            alloy_steel: {
                hss: {
                    end_mill: { speed: 60, feed_per_tooth: 0.002 },
                    face_mill: { speed: 60, feed_per_tooth: 0.002 },
                    drill: { speed: 60, feed_per_rev: 0.003 }
                },
                carbide: {
                    end_mill: { speed: 250, feed_per_tooth: 0.002 },
                    face_mill: { speed: 250, feed_per_tooth: 0.002 },
                    drill: { speed: 120, feed_per_rev: 0.003 }
                }
            },
            stainless_steel: {
                hss: {
                    end_mill: { speed: 60, feed_per_tooth: 0.001 },
                    face_mill: { speed: 60, feed_per_tooth: 0.001 },
                    drill: { speed: 60, feed_per_rev: 0.002 }
                },
                carbide: {
                    end_mill: { speed: 250, feed_per_tooth: 0.001 },
                    face_mill: { speed: 250, feed_per_tooth: 0.001 },
                    drill: { speed: 120, feed_per_rev: 0.002 }
                }
            },
            tool_steel: {
                hss: {
                    end_mill: { speed: 50, feed_per_tooth: 0.001 },
                    face_mill: { speed: 50, feed_per_tooth: 0.001 },
                    drill: { speed: 50, feed_per_rev: 0.002 }
                },
                carbide: {
                    end_mill: { speed: 200, feed_per_tooth: 0.001 },
                    face_mill: { speed: 200, feed_per_tooth: 0.001 },
                    drill: { speed: 100, feed_per_rev: 0.002 }
                }
            },
            copper: {
                hss: {
                    end_mill: { speed: 100, feed_per_tooth: 0.003 },
                    face_mill: { speed: 100, feed_per_tooth: 0.003 },
                    drill: { speed: 100, feed_per_rev: 0.006 }
                },
                carbide: {
                    end_mill: { speed: 400, feed_per_tooth: 0.003 },
                    face_mill: { speed: 400, feed_per_tooth: 0.003 },
                    drill: { speed: 200, feed_per_rev: 0.006 }
                }
            }
        };
    }
    
    calculateRPM(tool, operationType) {
        const materialSelect = document.getElementById('material-select');
        const material = materialSelect ? materialSelect.value : 'aluminum';
        const materialKey = material.replace(/-/g, '_');
        
        if (!this.machiningData[materialKey] || !this.machiningData[materialKey][tool.material] || !this.machiningData[materialKey][tool.material][operationType]) {
            console.error('Missing machining data for:', materialKey, tool.material, operationType);
            return 1000; // Default safe value
        }
        
        const data = this.machiningData[materialKey][tool.material][operationType];
        const cuttingSpeed = data.speed;
        // RPM = (4 × Cutting Speed) / Cutter Diameter
        return Math.round((4 * cuttingSpeed) / tool.diameter * (this.spindleOverride / 100));
    }
    
    // Calculate feed rate based on operation type
    calculateFeedRate(tool, operationType) {
        const materialSelect = document.getElementById('material-select');
        const material = materialSelect ? materialSelect.value : 'aluminum';
        const materialKey = material.replace(/-/g, '_');
        
        if (!this.machiningData[materialKey] || !this.machiningData[materialKey][tool.material] || !this.machiningData[materialKey][tool.material][operationType]) {
            console.error('Missing machining data for:', materialKey, tool.material, operationType);
            return 10; // Default safe value
        }
        
        const data = this.machiningData[materialKey][tool.material][operationType];
        
        if (operationType === 'drill' || operationType === 'tap') {
            // For drilling and tapping, feed is per revolution
            const rpm = this.calculateRPM(tool, operationType);
            return data.feed_per_rev * rpm;
        } else if (operationType === 'thread_mill') {
            // For thread milling, feed is per tooth but needs special handling
            const rpm = this.calculateRPM(tool, operationType);
            return data.feed_per_tooth * tool.teeth * rpm;
        } else {
            // For milling, feed is per tooth
            const rpm = this.calculateRPM(tool, operationType);
            return data.feed_per_tooth * tool.teeth * rpm;
        }
    }
    
    // Core formatting methods
    addLine(line = '') {
        this.gCode.push(line);
    }

    comment(text) {
        this.addLine(`(${text})`);
    }

    // Program structure
    programStart() {
        this.addLine('%');
        this.addLine(`O${this.programNumber}_ (${this.programName})`);
        this.addLine('G17 G40 G80 G54 G20');
        this.addLine('G28 G91 G0 X0 Y0 Z0');
        // Reset position tracking
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
    }

    toolChange(toolNumber) {
        this.currentTool = toolNumber;
        const tool = toolLibrary.getTool(toolNumber.toString());
        if (tool) {
            this.addLine(`M06 T${toolNumber} (${tool.description})`);
        } else {
            this.addLine(`M06 T${toolNumber} (Tool ${toolNumber})`);
        }
    }

    startPosition(x, y) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.currentSpindleSpeed = this.calculateRPM(tool, tool.type);
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

    // Movement commands
    rapidMove(x, y, z) {
        this.addLine(`G0 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${z.toFixed(this.decimalPlaces)}`);
        this.currentX = x;
        this.currentY = y;
        this.currentZ = z;
    }

    linearMove(x, y, z, feedRate = null) {
        if (feedRate !== null) this.currentFeedRate = feedRate;
        this.addLine(`G1 X${x.toFixed(this.decimalPlaces)} Y${y.toFixed(this.decimalPlaces)} Z${z.toFixed(this.decimalPlaces)} F${this.currentFeedRate}`);
        this.currentX = x;
        this.currentY = y;
        this.currentZ = z;
    }

    // Corrected helical movement with position tracking
    helicalMove(endX, endY, endZ, radius, angleDegrees, clockwise = true) {
        const direction = clockwise ? 'G02' : 'G03';
        const angleRad = angleDegrees * Math.PI / 180;
        
        // Calculate center point relative to current position
        const centerX = this.currentX + radius * Math.cos(angleRad);
        const centerY = this.currentY + radius * Math.sin(angleRad);
        
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
        this.plungeIntoPart(startZ, 'end_mill');
        
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

    plungeIntoPart(z, operationType) {
        const tool = toolLibrary.getTool(this.currentTool.toString());
        if (tool) {
            this.currentFeedRate = this.calculateFeedRate(tool, operationType);
            this.addLine(`G1 Z${z.toFixed(this.decimalPlaces)} F${this.currentFeedRate.toFixed(this.decimalPlaces)}`);
        } else {
            this.addLine(`(WARNING: No tool data for T${this.currentTool})`);
            this.addLine(`G1 Z${z.toFixed(this.decimalPlaces)} F${this.currentFeedRate}`);
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
        this.addLine('G54');
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
        this.plungeIntoPart(startZ, 'drill');
        
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
        this.plungeIntoPart(startZ, 'tap');
        
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
            
            const firstPoint = contourPoints[0];
            this.rapidMove(firstPoint.x + radius, firstPoint.y + radius, this.rapidPlane);
            this.linearMove(firstPoint.x + radius, firstPoint.y + radius, currentDepth);
            
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
        this.plungeIntoPart(startZ, 'thread_mill');
        
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
