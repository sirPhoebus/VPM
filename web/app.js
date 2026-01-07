import init, { Network } from './pkg/rusty_brain.js';

let network = null;
let animationId = null;
let isRunning = true;

// UI Elements
const canvas = document.getElementById('networkCanvas');
const ctx = canvas.getContext('2d');
const targetCanvas = document.getElementById('targetCanvas');
const targetCtx = targetCanvas.getContext('2d');

const modeStatus = document.getElementById('modeStatus');
const stepCountDisplay = document.getElementById('stepCount');
const similarityDisplay = document.getElementById('similarity');
const patternCountDisplay = document.getElementById('patternCount');

// Controls
const imprintBtn = document.getElementById('imprintBtn');
const shakeBtn = document.getElementById('shakeBtn');
const strengthSlider = document.getElementById('strengthSlider');
const strengthValue = document.getElementById('strengthValue');
const lrSlider = document.getElementById('lrSlider');
const lrValue = document.getElementById('lrValue');
const stepsSlider = document.getElementById('stepsSlider');
const stepsValue = document.getElementById('stepsValue');

// State
let step = 0;
let patternsStored = 0;
let currentTargetPattern = null;

// Configuration
const SIZE = 1000;
const ROW_LEN = 50; // Visualizing as 50x20 grid? Or maybe just circle. 
// Let's assume a grid for visualization if possible, or just a ring/cloud.
// The Rust code doesn't specify topology, it's just a reservoir. 
// Visualizing 1000 nodes: 32x32 = 1024. 
const VIS_COLS = 32;
const VIS_ROWS = 32;
// Adjust Sizing: 320x320 canvas => 10px per cell.

async function start() {
    await init();

    // Initialize Network: 1000 nodes, history 5
    network = new Network(VIS_COLS * VIS_ROWS, 5);

    // Initial Pattern (Random)
    network.shake();

    setupUI();
    animate();
}

function setupUI() {
    // Pattern Selection
    document.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.target.dataset.pattern;
            generatePattern(type);
            imprintBtn.disabled = false;
        });
    });

    // Actions
    imprintBtn.addEventListener('click', () => {
        if (!currentTargetPattern) return;

        const strength = parseFloat(strengthSlider.value);
        // Call the new ONE-SHOT imprint method
        network.imprint(strength);

        patternsStored++;
        patternCountDisplay.innerText = `(${patternsStored})`;
        updateStatus("Pattern Imprinted!");

        // Visual feedback
        imprintBtn.innerText = "Stored!";
        setTimeout(() => imprintBtn.innerText = "Store Pattern", 1000);

        addStoredPatternToLibrary(currentTargetPattern);
    });

    shakeBtn.addEventListener('click', () => {
        network.shake();
        updateStatus("Chaos Shake!");
    });

    // Sliders
    strengthSlider.addEventListener('input', (e) => strengthValue.innerText = e.target.value);
    lrSlider.addEventListener('input', (e) => lrValue.innerText = e.target.value);
    stepsSlider.addEventListener('input', (e) => stepsValue.innerText = e.target.value);

    // Image Upload
    const imageUpload = document.getElementById('imageUpload');
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Resize to grid size (32x32)
                const offCanvas = document.createElement('canvas');
                offCanvas.width = VIS_COLS;
                offCanvas.height = VIS_ROWS;
                const offCtx = offCanvas.getContext('2d');
                offCtx.drawImage(img, 0, 0, VIS_COLS, VIS_ROWS);

                // Process pixels
                const imageData = offCtx.getImageData(0, 0, VIS_COLS, VIS_ROWS);
                const pixels = new Float64Array(VIS_COLS * VIS_ROWS);

                for (let i = 0; i < pixels.length; i++) {
                    // Simple grayscale: (R+G+B)/3
                    const r = imageData.data[i * 4 + 0];
                    const g = imageData.data[i * 4 + 1];
                    const b = imageData.data[i * 4 + 2];
                    const brightness = (r + g + b) / 3.0 / 255.0;

                    // Map brightness to phase:
                    // 1.0 (White) -> 0 (Phase 0)
                    // 0.0 (Black) -> PI (Phase PI)
                    // using Cosine mapping logic: Cos(0)=1 (White), Cos(PI)=-1 (Black)
                    // So we want phase = arccos(2*brightness - 1) ?
                    // Actually simpler: 
                    // Brightness 1 -> Phase 0
                    // Brightness 0 -> Phase PI
                    // Linear map: phase = (1.0 - brightness) * Math.PI;

                    // Let's check our draw logic:
                    // intensity = cos(phase) * 127 + 128
                    // if phase=0, intensity=255 (White)
                    // if phase=PI, intensity=0 (Black)
                    // So yes, phase 0 is White.

                    pixels[i] = (1.0 - brightness) * Math.PI;
                }

                currentTargetPattern = pixels;
                drawPattern(targetCtx, pixels);

                // Set Network State
                for (let i = 0; i < pixels.length; i++) {
                    network.set_phase(i, pixels[i]);
                }
                network.clear_drives();

                imprintBtn.disabled = false;
                shakeBtn.disabled = false;
                updateStatus(`Uploaded Image Processed`);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function addStoredPatternToLibrary(patternData) {
    const library = document.getElementById('patternLibrary');

    // Remove empty message if present
    const emptyMsg = library.querySelector('.empty-library');
    if (emptyMsg) {
        emptyMsg.remove();
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.margin = '5px';
    wrapper.style.textAlign = 'center';
    wrapper.style.cursor = 'pointer';
    wrapper.title = "Click to Cue (Recall) this pattern";

    wrapper.onclick = () => {
        // Cue the network with this pattern
        for (let i = 0; i < patternData.length; i++) {
            network.set_phase(i, patternData[i]);
        }
        network.clear_drives();
        updateStatus("Cued Stored Pattern");
    };

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 64;
    thumbCanvas.height = 64;
    thumbCanvas.className = 'pattern-thumbnail';
    thumbCanvas.style.border = '1px solid #444';
    thumbCanvas.style.borderRadius = '4px';

    const thumbCtx = thumbCanvas.getContext('2d');

    // Re-use logic from drawPattern but scaled
    const imgData = thumbCtx.createImageData(64, 64);
    const scale = 64 / VIS_COLS; // 2

    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const py = Math.floor(y / scale);
            const px = Math.floor(x / scale);
            const idx = py * VIS_COLS + px;

            let phase = patternData[idx];
            if (phase < 0) phase += 2 * Math.PI;

            const intensity = Math.cos(phase) * 127 + 128;

            const cellIdx = (y * 64 + x) * 4;
            imgData.data[cellIdx + 0] = intensity;
            imgData.data[cellIdx + 1] = intensity * 0.8;
            imgData.data[cellIdx + 2] = 255 - intensity;
            imgData.data[cellIdx + 3] = 255;
        }
    }
    thumbCtx.putImageData(imgData, 0, 0);

    wrapper.appendChild(thumbCanvas);
    library.appendChild(wrapper);
}

function generatePattern(type) {
    const pixels = new Float64Array(VIS_COLS * VIS_ROWS);

    for (let y = 0; y < VIS_ROWS; y++) {
        for (let x = 0; x < VIS_COLS; x++) {
            let val = 0;
            const idx = y * VIS_COLS + x;

            switch (type) {
                case 'checkerboard':
                    val = ((x + y) % 2) * Math.PI; // 0 or PI
                    break;
                case 'diagonal':
                    val = ((x + y) % 8 < 4) ? 0 : Math.PI;
                    break;
                case 'circle':
                    const cx = VIS_COLS / 2;
                    const cy = VIS_ROWS / 2;
                    const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                    val = (r < 10) ? Math.PI : 0;
                    break;
                case 'cross':
                    const midX = VIS_COLS / 2;
                    const midY = VIS_ROWS / 2;
                    val = (Math.abs(x - midX) < 3 || Math.abs(y - midY) < 3) ? Math.PI : 0;
                    break;
                case 'letter-a':
                    // Rough A shape
                    val = 0;
                    if (y > 5 && y < 25) {
                        if (Math.abs(x - VIS_COLS / 2) < (y - 5) * 0.6 + 1 && Math.abs(x - VIS_COLS / 2) > (y - 5) * 0.6 - 1) val = Math.PI;
                        if (y === 18 && Math.abs(x - VIS_COLS / 2) < 8) val = Math.PI;
                    }
                    break;
            }
            pixels[idx] = val;
        }
    }

    currentTargetPattern = pixels;
    drawPattern(targetCtx, pixels);

    // Force phase setting for instant and accurate imprinting
    for (let i = 0; i < pixels.length; i++) {
        network.set_phase(i, pixels[i]);
    }

    // Ensure no competing drives
    network.clear_drives();

    // For this demo, we just set the phases directly.
    shakeBtn.disabled = false;
    updateStatus(`Selected: ${type}`);
}

function drawPattern(context, data) {
    const imgData = context.createImageData(320, 320);
    const scale = 320 / VIS_COLS; // 10

    for (let y = 0; y < 320; y++) {
        for (let x = 0; x < 320; x++) {
            const py = Math.floor(y / scale);
            const px = Math.floor(x / scale);
            const idx = py * VIS_COLS + px;

            // Phase to Color
            // 0 -> Blue/Black, PI -> Yellow/White
            // Continuous phase 0..2PI
            let phase = data[idx];
            if (phase < 0) phase += 2 * Math.PI;

            // Simple grayscale or heatmap using Cosine for 0 vs PI contrast
            const intensity = Math.cos(phase) * 127 + 128;

            const cellIdx = (y * 320 + x) * 4;
            imgData.data[cellIdx + 0] = intensity;     // R
            imgData.data[cellIdx + 1] = intensity * 0.8; // G
            imgData.data[cellIdx + 2] = 255 - intensity; // B
            imgData.data[cellIdx + 3] = 255; // Alpha
        }
    }
    context.putImageData(imgData, 0, 0);
}

function updateStatus(msg) {
    modeStatus.innerText = msg;
}

function animate() {
    if (!isRunning) return;

    const dt = 0.1;
    const lr = parseFloat(lrSlider.value);

    // Step network
    network.step(dt, lr);
    step++;
    stepCountDisplay.innerText = step;

    // Get phases from WASM memory
    const size = network.size();
    const phasesPtr = network.phases_ptr();
    const memory = network.memory();
    const phases = new Float64Array(memory.buffer, phasesPtr, size);

    // Draw Network State
    drawPattern(ctx, phases);

    // Turn off drives after a short while if we were driving
    // (Optional logic if we used drive_node)

    requestAnimationFrame(animate);
}

start().catch(console.error);
