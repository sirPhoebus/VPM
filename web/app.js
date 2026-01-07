import init, { Network } from './pkg/rusty_brain.js';

// Configuration
const VISUAL_ROWS = 48;
const VISUAL_COLS = 48;
const VISUAL_SIZE = VISUAL_ROWS * VISUAL_COLS; // 2304

const AUDIO_SIZE = 1024;
const SEMANTIC_SIZE = 768; // Char buffer
const TOTAL_SIZE = 4096;

let network = null;
let clampedState = null;
let step = 0;
let patternsStored = 0;

// Current Input Buffers (separate from network state)
const inputState = {
    visual: new Float64Array(VISUAL_SIZE),   // default 0
    semantic: new Float64Array(SEMANTIC_SIZE),
    audio: new Float64Array(AUDIO_SIZE)
};

// UI Elements
const visualCanvas = document.getElementById('visualCanvas');
const visualCtx = visualCanvas.getContext('2d');
const audioCanvas = document.getElementById('audioCanvas');
const audioCtx = audioCanvas.getContext('2d');
const semanticInput = document.getElementById('semanticInput');
const textStatus = document.getElementById('textStatus');
const modeStatus = document.getElementById('modeStatus');
const stepCount = document.getElementById('stepCount');

// Controls
const storeBtn = document.getElementById('storeBtn');
const shakeBtn = document.getElementById('shakeBtn');
const clearMemBtn = document.getElementById('clearMemBtn');
const strengthSlider = document.getElementById('strengthSlider');
const strengthValue = document.getElementById('strengthValue');

async function start() {
    await init();
    network = new Network(TOTAL_SIZE, 5);
    network.shake();

    setupUI();
    animate();
}

function setupUI() {
    // 1. Visual Cortex: Upload
    const imageUpload = document.getElementById('imageUpload');
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = VISUAL_COLS;
                tempCanvas.height = VISUAL_ROWS;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0, VISUAL_COLS, VISUAL_ROWS);

                const imgData = tempCtx.getImageData(0, 0, VISUAL_COLS, VISUAL_ROWS);

                // Encode
                for (let i = 0; i < VISUAL_SIZE; i++) {
                    const r = imgData.data[i * 4];
                    const g = imgData.data[i * 4 + 1];
                    const b = imgData.data[i * 4 + 2];
                    const bright = (r + g + b) / 3.0 / 255.0;
                    inputState.visual[i] = (1.0 - bright) * Math.PI; // White=0, Black=PI
                }

                activateClamp();
                updateStatus("Visual Input Processed");
                storeBtn.disabled = false;
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });

    // 2. Semantic Cortex: Typing
    semanticInput.addEventListener('input', (e) => {
        const text = e.target.value;
        // Clear buffer
        inputState.semantic.fill(0.0);
        // Encode: Map ASCII 32-126 to Phase 0.2 ... 6.0
        // We use almost full circle but avoid the wrap-around point (0/2PI) to prevent flip errors.
        for (let i = 0; i < Math.min(text.length, SEMANTIC_SIZE); i++) {
            let charCode = text.charCodeAt(i);
            if (charCode < 32 || charCode > 126) charCode = 32; // Clamp to printable

            // Normalize 0..1
            const ratio = (charCode - 32) / 94.0;
            // Map to 0.2 .. 6.0 (approx)
            const phase = 0.2 + ratio * 5.8;

            inputState.semantic[i] = phase;
        }

        activateClamp();
        textStatus.innerText = "Encoding...";
    });

    // ... (In addToLibrary)
    // Extract text
    let text = "";
    for (let i = 0; i < 30; i++) {
        const val = inputState.semantic[i];
        if (val > 0.1) {
            const ratio = (val - 0.2) / 5.8;
            const code = Math.round(ratio * 94.0 + 32);
            if (code >= 32 && code <= 126) text += String.fromCharCode(code);
        }
    }

    // ... (In decodeSemantic)
    function decodeSemantic(data) {
        if (step % 10 !== 0) return;

        let str = "";
        for (let i = 0; i < data.length; i++) {
            let val = data[i];
            // Normalize phase to 0..2PI
            val = val % (2.0 * Math.PI);
            if (val < 0) val += 2.0 * Math.PI;

            // Threshold for "Empty" (0.0 usually means empty)
            if (val < 0.1) continue;

            const ratio = (val - 0.2) / 5.8;
            const code = Math.round(ratio * 94.0 + 32);

            if (code >= 32 && code <= 126) {
                str += String.fromCharCode(code);
            } else {
                // str += "?"; // Simple noise filter
            }
        }

        textStatus.innerText = "Recalled: " + str.substring(0, 50) + "...";
    }
    document.getElementById('recordBtn').addEventListener('click', () => {
        // Generate a random waveform "signature"
        for (let i = 0; i < AUDIO_SIZE; i++) {
            // Structured noise (sine composition)
            const t = i * 0.1;
            inputState.audio[i] = (Math.sin(t) * Math.sin(t * 0.5) + 1.0) / 2.0 * Math.PI;
        }
        activateClamp();
        updateStatus("Audio Recorded");
        storeBtn.disabled = false;
    });

    // Global Actions
    storeBtn.addEventListener('click', () => {
        const strength = parseFloat(strengthSlider.value);
        network.imprint(strength);

        // Add to library (simplified visualization)
        addToLibrary();

        clampedState = null; // Release Physics
        updateStatus("Memory Stored!");
        storeBtn.disabled = true;

        // Clear inputs visually
        semanticInput.value = '';
        inputState.visual.fill(0);
        inputState.semantic.fill(0);
        inputState.audio.fill(0);
    });

    shakeBtn.addEventListener('click', () => {
        clampedState = null;
        network.shake();
        updateStatus("Chaos Shake!");
    });

    clearMemBtn.addEventListener('click', () => {
        network.clear_patterns();
        document.getElementById('patternLibrary').innerHTML = '<p class="empty-library">Empty.</p>';
        updateStatus("Memory Cleared");
    });

    strengthSlider.addEventListener('input', (e) => strengthValue.innerText = e.target.value);
}

function activateClamp() {
    // Assemble the full 4096 vector from the 3 cortex buffers
    const fullState = new Float64Array(TOTAL_SIZE);

    // Copy Visual (0 - 2304)
    fullState.set(inputState.visual, 0);

    // Copy Audio (2304 - 3328)
    fullState.set(inputState.audio, VISUAL_SIZE);

    // Copy Semantic (3328 - 4096)
    fullState.set(inputState.semantic, VISUAL_SIZE + AUDIO_SIZE);

    clampedState = fullState;

    // Apply immediate
    if (network.set_state_from_array) {
        network.set_state_from_array(fullState);
    }
}

function addToLibrary() {
    const lib = document.getElementById('patternLibrary');
    const thumb = document.createElement('canvas');
    thumb.width = 48;
    thumb.height = 48;
    thumb.className = 'mini-thumb';
    const ctx = thumb.getContext('2d');

    // Draw visual part
    const imgData = ctx.createImageData(48, 48);
    for (let i = 0; i < VISUAL_SIZE; i++) {
        const val = inputState.visual[i];
        const intensity = Math.cos(val) * 127 + 128;
        imgData.data[i * 4] = intensity;
        imgData.data[i * 4 + 1] = intensity;
        imgData.data[i * 4 + 2] = intensity;
        imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Add text preview
    const div = document.createElement('div');
    div.className = 'memory-item';
    div.appendChild(thumb);

    // Extract text
    let text = "";
    for (let i = 0; i < 30; i++) { // First 30 chars
        const val = inputState.semantic[i];
        if (val > 0.1) {
            const charCode = Math.floor((val - 0.1) / Math.PI * 128);
            text += String.fromCharCode(charCode);
        }
    }
    const span = document.createElement('span');
    span.innerText = text || "(Data)";
    div.appendChild(span);

    // Click to recall
    div.onclick = () => {
        // We can't easily reconstruct the *exact* inputState here without storing it,
        // but for now let's just trigger the network to this state if we had it.
        // Actually, better: We don't have the data here.
        // Let's just rely on the network's own memory.
        // But for "Cueing", we need to set the state.
        // Let's reconstruct it from the VISUAL part (since that's what we drew).
        // This is a limitation of this Quick Demo. 
        // Real app would store the full vector in JS.
    };

    lib.appendChild(div);
}

function animate() {
    if (clampedState) {
        if (network.set_state_from_array) network.set_state_from_array(clampedState);
    } else {
        network.step(0.1, 0.0);
    }

    step++;
    if (step % 10 === 0) stepCount.innerText = step;

    // READ STATE
    const phasesPtr = network.phases_ptr();
    const memory = network.memory();
    const allPhases = new Float64Array(memory.buffer, phasesPtr, TOTAL_SIZE);

    // 1. Decode Visual
    drawVisual(allPhases.subarray(0, VISUAL_SIZE));

    // 2. Decode Audio
    drawAudio(allPhases.subarray(VISUAL_SIZE, VISUAL_SIZE + AUDIO_SIZE));

    // 3. Decode Semantic
    decodeSemantic(allPhases.subarray(VISUAL_SIZE + AUDIO_SIZE, TOTAL_SIZE));

    requestAnimationFrame(animate);
}

function drawVisual(data) {
    const imgData = visualCtx.createImageData(VISUAL_COLS, VISUAL_ROWS);
    // Scale up for 300x300 canvas (CSS handles verification)

    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        // Cosine map
        const c = Math.cos(val) * 127 + 128;
        imgData.data[i * 4] = c;             // R
        imgData.data[i * 4 + 1] = c * 0.8;       // G (sepia)
        imgData.data[i * 4 + 2] = 255 - c;       // B
        imgData.data[i * 4 + 3] = 255;
    }

    // Draw to temp small canvas then scale up? 
    // Or just putImageData (it will be small) and CSS scales it.
    // CSS "image-rendering: pixelated" handles the scaling.
    visualCtx.putImageData(imgData, 0, 0); // Put in top-left corner
    // We can use drawImage to scale it up if we want smoothness, but raw pixels is fine.
    // Actually, let's scale it in JS.
    // No, index.html canvas is 300x300. putImageData fills only 48x48.
    // We need to scale manually.

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 48;
    tempCanvas.height = 48;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

    visualCtx.imageSmoothingEnabled = false;
    visualCtx.drawImage(tempCanvas, 0, 0, 300, 300);
}

function drawAudio(data) {
    audioCtx.fillStyle = '#000';
    audioCtx.fillRect(0, 0, 300, 150);

    audioCtx.beginPath();
    audioCtx.strokeStyle = '#0f0';
    audioCtx.lineWidth = 2;

    const step = 300 / data.length;
    for (let i = 0; i < data.length; i++) {
        const y = 75 + Math.cos(data[i]) * 50;
        if (i === 0) audioCtx.moveTo(0, y);
        else audioCtx.lineTo(i * step, y);
    }
    audioCtx.stroke();
}

function decodeSemantic(data) {
    // Only update text occasionally to avoid flickering
    if (step % 10 !== 0) return;

    let str = "";
    for (let i = 0; i < data.length; i++) {
        const val = data[i]; // 0..2PI
        // Wait, did we use Cosine?
        // Encode: val = (code/128)*PI
        // Decode: code = (val/PI)*128
        // But val can be anything in dynamics.

        let normalized = val % (2.0 * Math.PI);
        if (normalized < 0) normalized += 2.0 * Math.PI;

        // Check "Energy" (confidence). If it's fluctuating wildly, it's noise.
        // For now, just direct map.

        const code = Math.floor((normalized / Math.PI) * 128);
        if (code >= 32 && code <= 126) {
            str += String.fromCharCode(code);
        } else {
            // str += "_"; // Noise
        }
    }

    // Update placeholder or separate display?
    // Let's update the textStatus
    textStatus.innerText = "Recalled: " + str.substring(0, 50) + "...";

    // Also update the input box if user isn't typing
    if (document.activeElement !== semanticInput && str.length > 0) {
        semanticInput.value = str;
    }
}

start().catch(console.error);

function updateStatus(msg) {
    if (modeStatus) modeStatus.innerText = msg;
    console.log("[Status]", msg);
}
