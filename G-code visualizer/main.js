// Simple 2.5D visualization engine
class GCodeViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) {
            console.error('Failed to get 2D context');
            return;
        }
        console.log('Canvas context initialized');
        
        this.paths = [];
        this.camera = {
            distance: 300,
            rotation: { 
                x: -Math.PI / 4,  // -45 degrees from horizontal
                y: -Math.PI / 4,  // -45 degrees from front
                z: 0 
            },
            fov: 45
        };
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.scale = 1;
        this.isMetric = true;  // Default to metric
        this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        this.stockBounds = {
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            minZ: Infinity, maxZ: -Infinity
        };

        this.stock = null;
        this.toolDiameter = 0.25;
        this.stockBuffer = 1.0; // 1 unit buffer for X and Y
        this.stockZBuffer = 0.1; // 0.1 unit buffer for Z (vertical)
        this.tools = new Map(); // Store tool information
        this.currentTool = 1; // Default to tool 1
        this.needsRender = true; // Flag to track if rendering is needed

        this.setupEventListeners();
        this.resize();
        this.render();
    }

    setupEventListeners() {
        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camera.distance *= e.deltaY > 0 ? 0.95 : 1.05;
            this.needsRender = true;
            this.render();
        });

        // Mouse drag for rotation
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            const deltaX = e.clientX - this.lastMouseX;
            const deltaY = e.clientY - this.lastMouseY;
            
            const sensitivity = 0.003;
            
            // Rotate around Y axis for horizontal movement
            this.camera.rotation.y += deltaX * sensitivity;
            
            // Rotate around X axis for vertical movement (inverted)
            this.camera.rotation.x -= deltaY * sensitivity;
            
            // Clamp vertical rotation to prevent flipping
            this.camera.rotation.x = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, this.camera.rotation.x));
            
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            
            this.needsRender = true;
            this.render();
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.resize();
            this.needsRender = true;
            this.render();
        });
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        console.log('Canvas resized:', this.canvas.width, this.canvas.height);
    }

    // Project 3D point to 2D screen coordinates
    projectPoint(x, y, z) {
        // Apply camera rotation
        const cosX = Math.cos(this.camera.rotation.x);
        const sinX = Math.sin(this.camera.rotation.x);
        const cosY = Math.cos(this.camera.rotation.y);
        const sinY = Math.sin(this.camera.rotation.y);
        
        // Rotate point around Y axis (horizontal rotation)
        let rx = x * cosY - z * sinY;
        let ry = y;
        let rz = x * sinY + z * cosY;
        
        // Rotate point around X axis (vertical rotation)
        let rrx = rx;
        let rry = ry * cosX - rz * sinX;
        let rrz = ry * sinX + rz * cosX;
        
        // Move point away from camera
        rrz += this.camera.distance;
        
        if (rrz <= 0) return null; // Point is behind camera
        
        // Apply perspective
        const f = this.camera.fov;
        const scale = this.scale * (this.canvas.width / 2) / Math.tan(f * Math.PI / 360);
        
        const px = (rrx * scale / rrz) + this.canvas.width / 2;
        const py = (-rry * scale / rrz) + this.canvas.height / 2;
        
        return { x: px, y: py, depth: rrz };
    }

    // Draw a line in 3D space
    drawLine(x1, y1, z1, x2, y2, z2, color) {
        const p1 = this.projectPoint(x1, y1, z1);
        const p2 = this.projectPoint(x2, y2, z2);

        if (!p1 || !p2) return;

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    // Draw a point in 3D space
    drawPoint(x, y, z, color, size = 4) {
        const p = this.projectPoint(x, y, z);
        if (!p) return;

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    // Draw coordinate system
    drawCoordinateSystem() {
        const size = 50;
        this.ctx.lineWidth = 3;
        this.drawLine(0, 0, 0, size, 0, 0, '#ff0000'); // X axis (red) - left/right
        this.drawLine(0, 0, 0, 0, size, 0, '#0000ff'); // Z axis (blue) - vertical
        this.drawLine(0, 0, 0, 0, 0, size, '#00ff00'); // Y axis (green) - depth
        this.ctx.lineWidth = 2;
    }

    // Draw grid
    drawGrid() {
        // Calculate grid size based on part bounds
        const margin = 2; // Add 2 units of margin
        const minX = Math.floor(this.bounds.minX - margin);
        const maxX = Math.ceil(this.bounds.maxX + margin);
        const minZ = Math.floor(this.bounds.minZ - margin);
        const maxZ = Math.ceil(this.bounds.maxZ + margin);
        
        const color = '#444444';
        this.ctx.lineWidth = 1;

        // Draw major grid lines (every 5 units)
        for (let i = minX; i <= maxX; i++) {
            if (i % 1 === 0) {
                this.ctx.strokeStyle = '#666666';
            } else {
                this.ctx.strokeStyle = color;
            }
            this.drawLine(i, 0, minZ, i, 0, maxZ, this.ctx.strokeStyle);
        }

        for (let i = minZ; i <= maxZ; i++) {
            if (i % 1 === 0) {
                this.ctx.strokeStyle = '#666666';
            } else {
                this.ctx.strokeStyle = color;
            }
            this.drawLine(minX, 0, i, maxX, 0, i, this.ctx.strokeStyle);
        }

        this.ctx.lineWidth = 2;
    }

    createStock() {
        const xyBuffer = this.stockBuffer;
        const zBuffer = this.stockZBuffer;
        const b = this.stockBounds;

        return {
            minX: b.minX - xyBuffer,
            maxX: b.maxX + xyBuffer,
            minY: b.minY - zBuffer,
            maxY: b.maxY + zBuffer,
            minZ: b.minZ - xyBuffer,
            maxZ: b.maxZ + xyBuffer
        };
    }

    // Draw stock
    drawStock() {
        if (!this.stock) return;

        const color = '#666666';
        const alpha = 0.3;

        // Draw top face
        this.ctx.fillStyle = `rgba(102, 102, 102, ${alpha})`;
        this.drawQuad(
            this.stock.minX, this.stock.maxY, this.stock.minZ,
            this.stock.maxX, this.stock.maxY, this.stock.minZ,
            this.stock.maxX, this.stock.maxY, this.stock.maxZ,
            this.stock.minX, this.stock.maxY, this.stock.maxZ,
            color
        );

        // Draw front face
        this.drawQuad(
            this.stock.minX, this.stock.minY, this.stock.minZ,
            this.stock.maxX, this.stock.minY, this.stock.minZ,
            this.stock.maxX, this.stock.maxY, this.stock.minZ,
            this.stock.minX, this.stock.maxY, this.stock.minZ,
            color
        );

        // Draw right face
        this.drawQuad(
            this.stock.maxX, this.stock.minY, this.stock.minZ,
            this.stock.maxX, this.stock.minY, this.stock.maxZ,
            this.stock.maxX, this.stock.maxY, this.stock.maxZ,
            this.stock.maxX, this.stock.maxY, this.stock.minZ,
            color
        );
    }

    // Draw a quadrilateral face
    drawQuad(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, color) {
        const p1 = this.projectPoint(x1, y1, z1);
        const p2 = this.projectPoint(x2, y2, z2);
        const p3 = this.projectPoint(x3, y3, z3);
        const p4 = this.projectPoint(x4, y4, z4);

        if (!p1 || !p2 || !p3 || !p4) return;

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    // Draw tool path with material removal
    drawToolPath() {
        for (const path of this.paths) {
            const color = path.type === 'cut' ? '#ff0000' : '#00ff00';
            
            // Draw the tool path
            this.drawLine(
                path.from.x, path.from.y, path.from.z,
                path.to.x, path.to.y, path.to.z,
                color
            );

            // Draw tool position indicators
            this.drawPoint(path.from.x, path.from.y, path.from.z, color);
            this.drawPoint(path.to.x, path.to.y, path.to.z, color);

            // If it's a cutting move, draw the material removal
            if (path.type === 'cut') {
                const toolRadius = this.toolDiameter / 2;
                this.drawCylinder(
                    path.from.x, path.from.y, path.from.z,
                    path.to.x, path.to.y, path.to.z,
                    toolRadius,
                    '#ff000033'  // Semi-transparent red
                );
            }
        }
    }

    // Draw a cylinder between two points with proper 3D orientation
    drawCylinder(x1, y1, z1, x2, y2, z2, radius, color) {
        const segments = 8; // Reduced from 12 to 8 for better performance
        const angleStep = (Math.PI * 2) / segments;

        // Calculate the direction vector
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Skip if length is too small
        if (length < 0.001) return;

        // Calculate the rotation matrix to align cylinder with direction
        const axis = [dx, dy, dz];
        const up = [0, 1, 0]; // World up vector
        const right = this.crossProduct(axis, up);
        this.normalizeVector(right);
        const newUp = this.crossProduct(right, axis);
        this.normalizeVector(newUp);

        // Create points around the circle at both ends
        const startPoints = [];
        const endPoints = [];
        
        for (let i = 0; i < segments; i++) {
            const angle = i * angleStep;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Calculate points on the circle using the rotation matrix
            const startPoint = {
                x: x1 + radius * (cos * right[0] + sin * newUp[0]),
                y: y1 + radius * (cos * right[1] + sin * newUp[1]),
                z: z1 + radius * (cos * right[2] + sin * newUp[2])
            };
            const endPoint = {
                x: x2 + radius * (cos * right[0] + sin * newUp[0]),
                y: y2 + radius * (cos * right[1] + sin * newUp[1]),
                z: z2 + radius * (cos * right[2] + sin * newUp[2])
            };

            startPoints.push(startPoint);
            endPoints.push(endPoint);
        }

        // Draw the cylinder faces
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            
            // Draw the side face
            this.drawQuad(
                startPoints[i].x, startPoints[i].y, startPoints[i].z,
                startPoints[next].x, startPoints[next].y, startPoints[next].z,
                endPoints[next].x, endPoints[next].y, endPoints[next].z,
                endPoints[i].x, endPoints[i].y, endPoints[i].z,
                color
            );

            // Only draw end caps if the cylinder is long enough
            if (length > radius * 2) {
                this.drawTriangle(
                    x1, y1, z1,
                    startPoints[i].x, startPoints[i].y, startPoints[i].z,
                    startPoints[next].x, startPoints[next].y, startPoints[next].z,
                    color
                );
                this.drawTriangle(
                    x2, y2, z2,
                    endPoints[i].x, endPoints[i].y, endPoints[i].z,
                    endPoints[next].x, endPoints[next].y, endPoints[next].z,
                    color
                );
            }
        }
    }

    // Helper function to draw a triangle
    drawTriangle(x1, y1, z1, x2, y2, z2, x3, y3, z3, color) {
        const p1 = this.projectPoint(x1, y1, z1);
        const p2 = this.projectPoint(x2, y2, z2);
        const p3 = this.projectPoint(x3, y3, z3);

        if (!p1 || !p2 || !p3) return;

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    // Vector math helper functions
    crossProduct(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    normalizeVector(v) {
        const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (length > 0) {
            v[0] /= length;
            v[1] /= length;
            v[2] /= length;
        }
    }

    parseToolInfo(line) {
        // Match formats like:
        // (Tool: 1/8 BME)
        // (Tool: 0.125 BME)
        // (Tool: T1 1/8 BME)
        const toolMatch = line.match(/\(Tool:\s*T?(\d+)?\s+((\d+(\.\d+)?|\d+\/\d+))\s+([A-Z]+)/i);

        if (toolMatch) {
            const toolNum = parseInt(toolMatch[1] || "1");
            const dimStr = toolMatch[2].trim();
            const description = toolMatch[5].trim();

            const diameter = this.parseDimension(dimStr);
            if (!isNaN(diameter)) {
                this.tools.set(toolNum, {
                    diameter: diameter,
                    description: description
                });
                console.log(`Parsed tool ${toolNum}: ${diameter} units diameter - ${description}`);
            } else {
                console.warn(`Invalid diameter string "${dimStr}" on line: ${line}`);
            }
        }
    }




    // Parse dimension string (e.g., "1/8" or "0.125")
    parseDimension(dimStr) {
        if (dimStr.includes('/')) {
            const [num, denom] = dimStr.split('/');
            return parseFloat(num) / parseFloat(denom);
        }
        return parseFloat(dimStr);
    }

    // Calculate arc points with proper 3D orientation
    calculateArcPoints(start, end, center, clockwise) {
        const points = [];
        
        // Calculate radius in XZ plane
        const radius = Math.sqrt(
            Math.pow(start.x - center.x, 2) +
            Math.pow(start.z - center.z, 2)
        );

        // Calculate start and end angles in XZ plane
        const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
        let endAngle = Math.atan2(end.z - center.z, end.x - center.x);

        // Adjust end angle based on direction
        if (clockwise && endAngle >= startAngle) {
            endAngle -= Math.PI * 2;
        } else if (!clockwise && endAngle <= startAngle) {
            endAngle += Math.PI * 2;
        }

        // Calculate number of segments based on arc length and radius
        const arcLength = Math.abs(endAngle - startAngle) * radius;
        const minSegments = 16; // Reduced from 32 to 16 for better performance
        const maxSegments = 32; // Added maximum segments to prevent excessive detail
        const segments = Math.min(maxSegments, Math.max(minSegments, Math.ceil(arcLength / (radius * 0.1))));

        // Generate points along the arc
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = startAngle + (endAngle - startAngle) * t;
            
            // Calculate position in XZ plane
            const x = center.x + radius * Math.cos(angle);
            const z = center.z + radius * Math.sin(angle);
            
            // Linear interpolation for Y
            const y = start.y + (end.y - start.y) * t;

            points.push({ x, y, z });
        }

        return points;
    }

    render() {
        // Only render if something has changed
        if (!this.needsRender) return;
        this.needsRender = false;

        // Clear canvas
        this.ctx.fillStyle = '#111111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid and coordinate system
        this.drawGrid();
        this.drawCoordinateSystem();

        // Draw stock
        this.drawStock();

        // Draw tool paths with material removal
        this.drawToolPath();

        // Debug: Draw a test point at origin
        this.drawPoint(0, 0, 0, '#ffffff', 8);
    }

    // Parse G-code
    parseGCode(gcode) {
        console.log('Parsing G-code');
        const lines = gcode.split('\n');
        this.paths = [];
        let currentPos = { x: 0, y: 0, z: 0 };
        let absoluteMode = true;
        this.isMetric = true;
        this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

        for (let rawLine of lines) {
            console.log('\nProcessing line:', rawLine);

            // Parse tool information from comments
            this.parseToolInfo(rawLine);

            // Remove comments but preserve the original line for logging
            const commentMatch = rawLine.match(/;.*|\(.*?\)/);
            const comment = commentMatch ? commentMatch[0] : '';
            const line = rawLine.replace(/;.*|\(.*?\)/g, '').trim().toUpperCase();
            
            if (!line) {
                console.log('Empty line after comment removal');
                continue;
            }

            console.log('Parsed line:', {
                original: rawLine,
                cleaned: line,
                comment: comment
            });

            // Check for unit mode
            if (line.includes('G20')) {
                this.isMetric = false;
                console.log('Switching to Imperial units');
            }
            if (line.includes('G21')) {
                this.isMetric = true;
                console.log('Switching to Metric units');
            }

            if (line.includes('G90')) {
                absoluteMode = true;
                console.log('Switching to Absolute mode');
            }
            if (line.includes('G91')) {
                absoluteMode = false;
                console.log('Switching to Relative mode');
            }

            // Check for tool change
            const toolMatch = line.match(/T(\d+)/);
            if (toolMatch) {
                this.currentTool = parseInt(toolMatch[1]);
                const toolInfo = this.tools.get(this.currentTool);
                if (toolInfo) {
                    this.toolDiameter = toolInfo.diameter/2;
                    console.log(`Switched to tool ${this.currentTool}: ${this.toolDiameter} units diameter`);
                }
            }

            // Improved G-code command detection
            const gMatch = line.match(/G([0-3])/);
            if (gMatch) {
                console.log('Found G-code command:', gMatch[0]);
            }

            // Extract all coordinates
            const x = this.extractCoord(line, 'X');
            const y = this.extractCoord(line, 'Y');
            const z = this.extractCoord(line, 'Z');
            const i = this.extractCoord(line, 'I');
            const j = this.extractCoord(line, 'J');

            // Log raw coordinates
            if (x !== null || y !== null || z !== null || i !== null || j !== null) {
                console.log('Raw coordinates:', {
                    line: rawLine,
                    x, y, z,
                    i, j,
                    absoluteMode
                });
            }

            // Swap Y and Z coordinates to match world system
            const nextPos = {
                x: x !== null ? (absoluteMode ? x : currentPos.x + x) : currentPos.x,
                y: z !== null ? (absoluteMode ? z : currentPos.y + z) : currentPos.y,
                z: y !== null ? (absoluteMode ? y : currentPos.z + y) : currentPos.z
            };

            if (gMatch) {
                const gCode = gMatch[0];
                console.log('Processing G-code:', {
                    command: gCode,
                    currentPos,
                    nextPos,
                    i, j,
                    hasIJ: i !== null || j !== null
                });

                if (gCode === 'G0' || gCode === 'G1') {
                    // Linear move
                    const path = {
                        type: gCode === 'G0' ? 'rapid' : 'cut',
                        from: { ...currentPos },
                        to: { ...nextPos }
                    };
                    this.paths.push(path);
                    console.log('Linear move:', {
                        gCode,
                        from: path.from,
                        to: path.to,
                        distance: Math.sqrt(
                            Math.pow(path.to.x - path.from.x, 2) +
                            Math.pow(path.to.y - path.from.y, 2) +
                            Math.pow(path.to.z - path.from.z, 2)
                        )
                    });
                    if (gCode === 'G1') {
                        this.stockBounds.minX = Math.min(this.stockBounds.minX, nextPos.x);
                        this.stockBounds.maxX = Math.max(this.stockBounds.maxX, nextPos.x);
                        this.stockBounds.minY = Math.min(this.stockBounds.minY, nextPos.y);
                        this.stockBounds.maxY = Math.max(this.stockBounds.maxY, nextPos.y);
                        this.stockBounds.minZ = Math.min(this.stockBounds.minZ, nextPos.z);
                        this.stockBounds.maxZ = Math.max(this.stockBounds.maxZ, nextPos.z);
                    }

                } else if (gCode === 'G2' || gCode === 'G3') {
                    console.log('Processing arc move');
                    
                    // For arcs where X/Y are omitted, use current position
                    const endPos = {
                        x: x !== null ? (absoluteMode ? x : currentPos.x + x) : currentPos.x,
                        y: z !== null ? (absoluteMode ? z : currentPos.y + z) : currentPos.y,
                        z: y !== null ? (absoluteMode ? y : currentPos.z + y) : currentPos.z
                    };

                    // For arcs where I is omitted, use 0
                    const center = {
                        x: currentPos.x + (i !== null ? i : 0),
                        y: currentPos.y,
                        z: currentPos.z + (j !== null ? j : 0)
                    };

                    // If this is a full circle (X/Y omitted), calculate end position
                    if (x === null && y === null) {
                        endPos.x = currentPos.x;
                        endPos.z = currentPos.z;
                    }
                    
                    console.log('Arc move details:', {
                        gCode,
                        from: currentPos,
                        to: endPos,
                        center: center,
                        i: i !== null ? i : 0,
                        j: j !== null ? j : 0,
                        clockwise: gCode === 'G2',
                        radius: Math.sqrt(
                            Math.pow(center.x - currentPos.x, 2) +
                            Math.pow(center.z - currentPos.z, 2)
                        )
                    });

                    const points = this.calculateArcPoints(
                        currentPos,
                        endPos,
                        center,
                        gCode === 'G2'
                    );

                    console.log(`Generated ${points.length} points for arc`);

                    // Add segments of the arc
                    for (let i = 0; i < points.length - 1; i++) {
                        const path = {
                            type: 'cut',
                            from: points[i],
                            to: points[i + 1]
                        };
                        this.paths.push(path);
                        console.log(`Arc segment ${i + 1}/${points.length - 1}:`, {
                            from: path.from,
                            to: path.to,
                            distance: Math.sqrt(
                                Math.pow(path.to.x - path.from.x, 2) +
                                Math.pow(path.to.y - path.from.y, 2) +
                                Math.pow(path.to.z - path.from.z, 2)
                            )
                        });
                    }
                    for (let i = 0; i < points.length; i++) {
                        const pt = points[i];
                        this.stockBounds.minX = Math.min(this.stockBounds.minX, pt.x);
                        this.stockBounds.maxX = Math.max(this.stockBounds.maxX, pt.x);
                        this.stockBounds.minY = Math.min(this.stockBounds.minY, pt.y);
                        this.stockBounds.maxY = Math.max(this.stockBounds.maxY, pt.y);
                        this.stockBounds.minZ = Math.min(this.stockBounds.minZ, pt.z);
                        this.stockBounds.maxZ = Math.max(this.stockBounds.maxZ, pt.z);
                    }

                }
                
            }

            // Update bounds
            this.bounds.minX = Math.min(this.bounds.minX, nextPos.x);
            this.bounds.maxX = Math.max(this.bounds.maxX, nextPos.x);
            this.bounds.minY = Math.min(this.bounds.minY, nextPos.y);
            this.bounds.maxY = Math.max(this.bounds.maxY, nextPos.y);
            this.bounds.minZ = Math.min(this.bounds.minZ, nextPos.z);
            this.bounds.maxZ = Math.max(this.bounds.maxZ, nextPos.z);

            currentPos = nextPos;
        }

        console.log('Parsing complete:');
        console.log('Found paths:', this.paths.length);
        console.log('Units:', this.isMetric ? 'Metric (mm)' : 'Imperial (inches)');
        console.log('Bounds:', this.bounds);
        console.log('Tools:', Object.fromEntries(this.tools));
        
        // Create stock based on bounds
        this.stock = this.createStock();
        
        // Adjust camera to fit the part
        this.fitCameraToBounds();
        this.render();
    }

    extractCoord(line, axis) {
        const match = line.match(new RegExp(`${axis}(-?\\d*\\.?\\d+)`));
        return match ? parseFloat(match[1]) : null;
    }

    fitCameraToBounds() {
        // Calculate the size of the part
        const sizeX = this.bounds.maxX - this.bounds.minX;
        const sizeY = this.bounds.maxY - this.bounds.minY;
        const sizeZ = this.bounds.maxZ - this.bounds.minZ;
        
        // Calculate the maximum dimension
        const maxSize = Math.max(sizeX, sizeY, sizeZ);
        
        // Set camera distance based on part size
        this.camera.distance = maxSize * 2;
        
        // Center the view on the part
        const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
        const centerY = (this.bounds.minY + this.bounds.maxY) / 2;
        const centerZ = (this.bounds.minZ + this.bounds.maxZ) / 2;
        
        // Adjust camera position to look at the center
        this.camera.rotation.x = -Math.PI / 4;
        this.camera.rotation.y = -Math.PI / 4;
    }

    resetView() {
        this.camera.rotation.x = -Math.PI / 4;  // -45 degrees from horizontal
        this.camera.rotation.y = -Math.PI / 4;  // -45 degrees from front
        this.camera.rotation.z = 0;
        this.camera.distance = 300;
        this.scale = 1;
        this.render();
    }
}

// Initialize viewer
const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.zIndex = '1';
document.body.appendChild(canvas);
console.log('Canvas element created and added to body');

const viewer = new GCodeViewer(canvas);

// Add loading indicator
function showLoading(show) {
    const controls = document.getElementById('controls');
    if (show) {
        const loading = document.createElement('div');
        loading.id = 'loading';
        loading.textContent = 'Processing G-code...';
        loading.style.color = '#fff';
        loading.style.marginLeft = '10px';
        controls.appendChild(loading);
    } else {
        const loading = document.getElementById('loading');
        if (loading) loading.remove();
    }
}

// Handle file input
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showLoading(true);

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            viewer.parseGCode(e.target.result);
        } catch (error) {
            console.error('Error processing G-code:', error);
            alert('Error processing G-code file. Please check the console for details.');
        } finally {
            showLoading(false);
        }
    };
    reader.onerror = () => {
        alert('Error reading file');
        showLoading(false);
    };
    reader.readAsText(file);
});

// Handle reset view button
document.getElementById('resetViewBtn').addEventListener('click', () => {
    viewer.resetView();
});
