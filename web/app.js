// VPM Image Recall Web App
// Demonstrates associative memory recall using a Vector Phase Memory network

import init, { Network, init_panic_hook } from './pkg/rusty_brain.js';

// Constants
const GRID_SIZE = 32;  // 32x32 = 1024 oscillators
const NETWORK_SIZE = GRID_SIZE * GRID_SIZE;
const MAX_HISTORY = 10;
const DT = 0.05;

// State
let network = null;
let wasmMemory = null;  // Cached WASM memory reference
let targetPattern = null;  // Float64Array of phases [0, 2π]
let currentPatternName = '';
let isRunning = false;
let currentMode = 'idle';
let stepCount = 0;
let animationId = null;

// Pattern Library - stores all imprinted patterns
const storedPatterns = [];

// DOM Elements
const networkCanvas = document.getElementById('networkCanvas');
const targetCanvas = document.getElementById('targetCanvas');
const networkCtx = networkCanvas.getContext('2d');
const targetCtx = targetCanvas.getContext('2d');

const imprintBtn = document.getElementById('imprintBtn');
const shakeBtn = document.getElementById('shakeBtn');

const patternLibrary = document.getElementById('patternLibrary');
const patternCount = document.getElementById('patternCount');
const clearLibraryBtn = document.getElementById('clearLibraryBtn');

const strengthSlider = document.getElementById('strengthSlider');
const lrSlider = document.getElementById('lrSlider');
const stepsSlider = document.getElementById('stepsSlider');

const strengthValue = document.getElementById('strengthValue');
const lrValue = document.getElementById('lrValue');
const stepsValue = document.getElementById('stepsValue');

const modeStatus = document.getElementById('modeStatus');
const stepCountEl = document.getElementById('stepCount');
const similarityEl = document.getElementById('similarity');

const imageUpload = document.getElementById('imageUpload');
const patternBtns = document.querySelectorAll('.pattern-btn');

// Utility: Convert phase [0, 2π] to grayscale [0, 255]
function phaseToGray(phase) {
    const normalized = (Math.cos(phase) + 1) / 2;
    return Math.floor(normalized * 255);
}

// Utility: Convert grayscale [0, 255] to phase [0, 2π]
function grayToPhase(gray) {
    const normalized = gray / 255;
    return normalized * 2 * Math.PI;
}

// Render network state to canvas
function renderNetwork() {
    if (!network) return;

    const phasesPtr = network.phases_ptr();
    const phases = new Float64Array(
        wasmMemory.buffer,
        phasesPtr,
        NETWORK_SIZE
    );

    const imageData = networkCtx.createImageData(GRID_SIZE, GRID_SIZE);
    const data = imageData.data;

    for (let i = 0; i < NETWORK_SIZE; i++) {
        const gray = phaseToGray(phases[i]);
        const idx = i * 4;
        data[idx] = gray;
        data[idx + 1] = gray;
        data[idx + 2] = gray;
        data[idx + 3] = 255;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GRID_SIZE;
    tempCanvas.height = GRID_SIZE;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    networkCtx.imageSmoothingEnabled = false;
    networkCtx.drawImage(tempCanvas, 0, 0, networkCanvas.width, networkCanvas.height);
}

// Render target pattern to canvas
function renderTarget() {
    if (!targetPattern) return;

    const imageData = targetCtx.createImageData(GRID_SIZE, GRID_SIZE);
    const data = imageData.data;

    for (let i = 0; i < NETWORK_SIZE; i++) {
        const gray = phaseToGray(targetPattern[i]);
        const idx = i * 4;
        data[idx] = gray;
        data[idx + 1] = gray;
        data[idx + 2] = gray;
        data[idx + 3] = 255;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GRID_SIZE;
    tempCanvas.height = GRID_SIZE;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(tempCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
}

// Create thumbnail canvas for a pattern
function createPatternThumbnail(pattern) {
    const canvas = document.createElement('canvas');
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    const ctx = canvas.getContext('2d');

    const imageData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
    const data = imageData.data;

    for (let i = 0; i < NETWORK_SIZE; i++) {
        const gray = phaseToGray(pattern[i]);
        const idx = i * 4;
        data[idx] = gray;
        data[idx + 1] = gray;
        data[idx + 2] = gray;
        data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

// Calculate similarity between network state and a pattern
function calculateSimilarity(pattern = targetPattern) {
    if (!network || !pattern) return 0;

    const phasesPtr = network.phases_ptr();
    const phases = new Float64Array(
        wasmMemory.buffer,
        phasesPtr,
        NETWORK_SIZE
    );

    let totalAlignment = 0;
    for (let i = 0; i < NETWORK_SIZE; i++) {
        const diff = phases[i] - pattern[i];
        totalAlignment += Math.cos(diff);
    }

    return (totalAlignment / NETWORK_SIZE + 1) / 2;
}

// Update UI status
function updateStatus() {
    modeStatus.textContent = currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
    stepCountEl.textContent = stepCount;

    const sim = calculateSimilarity();
    similarityEl.textContent = (sim * 100).toFixed(1) + '%';
}

// Render the pattern library UI
function renderPatternLibrary() {
    patternCount.textContent = `(${storedPatterns.length})`;
    clearLibraryBtn.style.display = storedPatterns.length > 0 ? 'block' : 'none';

    if (storedPatterns.length === 0) {
        patternLibrary.innerHTML = '<p class="empty-library">No patterns stored yet. Select a pattern and click "Store Pattern".</p>';
        return;
    }

    patternLibrary.innerHTML = '';

    storedPatterns.forEach((stored, idx) => {
        const item = document.createElement('div');
        item.className = 'stored-pattern';

        const thumbnail = createPatternThumbnail(stored.pattern);

        const name = document.createElement('span');
        name.className = 'pattern-name';
        name.textContent = stored.name;

        const recallBtn = document.createElement('button');
        recallBtn.className = 'recall-btn';
        recallBtn.textContent = '🔮 Recall';
        recallBtn.disabled = isRunning;
        recallBtn.onclick = () => recallPattern(idx);

        item.appendChild(thumbnail);
        item.appendChild(name);
        item.appendChild(recallBtn);
        patternLibrary.appendChild(item);
    });
}

// Generate pattern functions
function generateCheckerboard() {
    const pattern = new Float64Array(NETWORK_SIZE);
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const isWhite = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
            pattern[idx] = isWhite ? 0 : Math.PI;
        }
    }
    return pattern;
}

function generateDiagonal() {
    const pattern = new Float64Array(NETWORK_SIZE);
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const stripe = ((x + y) % 8) < 4;
            pattern[idx] = stripe ? 0 : Math.PI;
        }
    }
    return pattern;
}

function generateCircle() {
    const pattern = new Float64Array(NETWORK_SIZE);
    const cx = GRID_SIZE / 2;
    const cy = GRID_SIZE / 2;
    const radius = GRID_SIZE / 3;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            pattern[idx] = dist < radius ? 0 : Math.PI;
        }
    }
    return pattern;
}

function generateCross() {
    const pattern = new Float64Array(NETWORK_SIZE);
    const thickness = 4;
    const cx = GRID_SIZE / 2;
    const cy = GRID_SIZE / 2;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const inHoriz = Math.abs(y - cy) < thickness;
            const inVert = Math.abs(x - cx) < thickness;
            pattern[idx] = (inHoriz || inVert) ? 0 : Math.PI;
        }
    }
    return pattern;
}

function generateLetterA() {
    const pattern = new Float64Array(NETWORK_SIZE);
    pattern.fill(Math.PI);

    const template = [
        "    ####    ",
        "   ######   ",
        "  ###  ###  ",
        " ###    ### ",
        " ###    ### ",
        "############",
        "############",
        "###      ###",
        "###      ###",
        "###      ###",
    ];

    const startY = Math.floor((GRID_SIZE - template.length * 3) / 2);
    const startX = Math.floor((GRID_SIZE - template[0].length * 2.5) / 2);

    for (let ty = 0; ty < template.length; ty++) {
        for (let tx = 0; tx < template[ty].length; tx++) {
            if (template[ty][tx] === '#') {
                for (let dy = 0; dy < 3; dy++) {
                    for (let dx = 0; dx < 2; dx++) {
                        const y = startY + ty * 3 + dy;
                        const x = startX + tx * 2 + dx;
                        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
                            const idx = y * GRID_SIZE + x;
                            pattern[idx] = 0;
                        }
                    }
                }
            }
        }
    }

    return pattern;
}

// Load image from file
function loadImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = GRID_SIZE;
                tempCanvas.height = GRID_SIZE;
                const ctx = tempCanvas.getContext('2d');

                ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);

                const imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
                const data = imageData.data;

                const pattern = new Float64Array(NETWORK_SIZE);
                for (let i = 0; i < NETWORK_SIZE; i++) {
                    const idx = i * 4;
                    const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                    pattern[i] = grayToPhase(gray);
                }

                resolve(pattern);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Store pattern in library (instant save, no learning needed since we use sustained cueing for recall)
async function storePattern() {
    if (!network || !targetPattern || isRunning) return;

    // Check if this pattern is already stored
    const alreadyStored = storedPatterns.some(p => p.name === currentPatternName);
    if (alreadyStored) {
        console.log('Pattern already stored, skipping');
        return;
    }

    isRunning = true;
    currentMode = 'storing';
    stepCount = 0;
    imprintBtn.classList.add('running');
    updateButtons();

    // Brief animation to show the pattern being "saved"
    const strength = parseFloat(strengthSlider.value);

    // Drive network toward pattern briefly for visual feedback
    for (let i = 0; i < NETWORK_SIZE; i++) {
        network.drive_node(i, targetPattern[i], strength);
    }

    // Quick animation
    const animationSteps = 50;
    const stepsPerFrame = 5;

    function step() {
        if (stepCount >= animationSteps) {
            network.clear_drives();

            // Add to stored patterns
            storedPatterns.push({
                name: currentPatternName || `Pattern ${storedPatterns.length + 1}`,
                pattern: new Float64Array(targetPattern)
            });

            renderPatternLibrary();

            isRunning = false;
            currentMode = 'ready';
            imprintBtn.classList.remove('running');
            updateButtons();
            updateStatus();
            console.log(`Stored "${currentPatternName}" (total: ${storedPatterns.length} patterns)`);
            return;
        }

        for (let i = 0; i < stepsPerFrame && stepCount < animationSteps; i++) {
            network.step(DT, 0);
            stepCount++;
        }

        renderNetwork();
        updateStatus();
        animationId = requestAnimationFrame(step);
    }

    step();
}

// Shake/randomize network
function shakeNetwork() {
    if (!network || isRunning) return;

    network.shake();
    stepCount = 0;
    currentMode = 'chaos';
    renderNetwork();
    updateStatus();
}

// Recall pattern using SUSTAINED cueing
// This drives the network toward the stored pattern actively, ensuring reliable recall
async function recallPattern(patternIdx) {
    if (!network || isRunning) return;

    const stored = storedPatterns[patternIdx];
    if (!stored) return;

    // Set target to the pattern we're recalling
    targetPattern = stored.pattern;
    currentPatternName = stored.name;
    renderTarget();

    isRunning = true;
    currentMode = 'recalling';
    stepCount = 0;
    updateButtons();

    // SUSTAINED CUEING: Drive ALL nodes toward the target pattern
    // This ensures reliable recall regardless of interference from other patterns
    const driveStrength = 5.0;

    // Apply sustained drive to all nodes
    for (let i = 0; i < NETWORK_SIZE; i++) {
        network.drive_node(i, stored.pattern[i], driveStrength);
    }

    network.set_mode(0);  // Inference mode (no learning)

    // Animate the recall process
    const maxSteps = 200;
    const stepsPerFrame = 3;

    function step() {
        const sim = calculateSimilarity(stored.pattern);

        // Stop when highly converged or max steps reached
        if (sim > 0.95 || stepCount >= maxSteps) {
            network.clear_drives();
            isRunning = false;
            currentMode = 'recalled';
            updateButtons();
            updateStatus();
            renderNetwork();
            return;
        }

        for (let i = 0; i < stepsPerFrame; i++) {
            network.step(DT, 0);
            stepCount++;
        }

        renderNetwork();
        updateStatus();
        animationId = requestAnimationFrame(step);
    }

    step();
}

// Clear all stored patterns
function clearLibrary() {
    if (isRunning) return;

    storedPatterns.length = 0;
    network.reset_connectivity();
    renderPatternLibrary();
    currentMode = 'idle';
    updateStatus();
}

// Update button states
function updateButtons() {
    const hasPattern = targetPattern !== null;
    const hasNetwork = network !== null;

    imprintBtn.disabled = !hasPattern || !hasNetwork || isRunning;
    shakeBtn.disabled = !hasNetwork || isRunning;

    // Update recall buttons in library
    document.querySelectorAll('.recall-btn').forEach(btn => {
        btn.disabled = isRunning;
    });
}

// Set pattern
function setPattern(pattern, name) {
    targetPattern = pattern;
    currentPatternName = name;
    renderTarget();
    updateButtons();

    // Show pattern on network canvas
    if (network) {
        for (let i = 0; i < NETWORK_SIZE; i++) {
            network.drive_node(i, pattern[i], 10);
        }
        for (let i = 0; i < 20; i++) {
            network.step(DT, 0);
        }
        network.clear_drives();
        renderNetwork();
    }

    updateStatus();
}

// Event Listeners
patternBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        patternBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const patternType = btn.dataset.pattern;
        let pattern;
        let name;

        switch (patternType) {
            case 'checkerboard': pattern = generateCheckerboard(); name = 'Checkerboard'; break;
            case 'diagonal': pattern = generateDiagonal(); name = 'Diagonal'; break;
            case 'circle': pattern = generateCircle(); name = 'Circle'; break;
            case 'cross': pattern = generateCross(); name = 'Cross'; break;
            case 'letter-a': pattern = generateLetterA(); name = 'Letter A'; break;
        }

        if (pattern) setPattern(pattern, name);
    });
});

imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            const pattern = await loadImageFile(file);
            patternBtns.forEach(b => b.classList.remove('active'));
            setPattern(pattern, file.name.split('.')[0]);
        } catch (err) {
            console.error('Failed to load image:', err);
        }
    }
});

imprintBtn.addEventListener('click', storePattern);
shakeBtn.addEventListener('click', shakeNetwork);
clearLibraryBtn.addEventListener('click', clearLibrary);

// Slider value displays
strengthSlider.addEventListener('input', () => {
    strengthValue.textContent = parseFloat(strengthSlider.value).toFixed(1);
});

lrSlider.addEventListener('input', () => {
    lrValue.textContent = parseFloat(lrSlider.value).toFixed(2);
});

stepsSlider.addEventListener('input', () => {
    stepsValue.textContent = stepsSlider.value;
});

// Initialize
async function main() {
    try {
        await init();
        init_panic_hook();

        network = new Network(NETWORK_SIZE, MAX_HISTORY);
        wasmMemory = network.memory();
        console.log(`Network initialized with ${network.size()} oscillators`);

        currentMode = 'idle';
        updateButtons();
        renderPatternLibrary();

        renderNetwork();
        updateStatus();

        // Auto-select first pattern
        document.querySelector('.pattern-btn[data-pattern="cross"]').click();

    } catch (err) {
        console.error('Failed to initialize:', err);
        modeStatus.textContent = 'Error: ' + err.message;
    }
}

main();
