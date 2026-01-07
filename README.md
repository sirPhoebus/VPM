# VPM Image Recall

A web application demonstrating **associative memory recall** using a Vector Phase Memory (VPM) oscillator network compiled to WebAssembly.

![Demo Screenshot](web/screenshot.png)

## Features

- 🧠 **1024 coupled oscillators** arranged in a 32×32 grid
- 💾 **Imprint patterns** using Hebbian learning
- 🌀 **Chaos shake** to randomize network state
- 🔮 **Recall patterns** from chaos through learned connections
- 📷 **Upload custom images** or use built-in patterns

## Quick Start

# Start local server
cd web
python -m http.server 8080

# Open in browser
start http://localhost:8080
```

## How It Works

1. **Select a pattern** (checkerboard, cross, circle, etc.) or upload an image
2. **Imprint** - Network learns the pattern via Hebbian plasticity
3. **Shake** - Randomizes all oscillator phases (destroys visible pattern)
4. **Recall** - Let the network settle; learned weights restore the pattern

### Architecture

```
web/
├── index.html      # Main UI
├── style.css       # Dark theme styling
├── app.js          # WASM integration & animation
└── pkg/            # Generated WASM package
```

## Parameters

| Setting | Default | Description |
|---------|---------|-------------|
| Imprint Strength | 5.0 | External drive force during learning |
| Learning Rate | 0.05 | Hebbian plasticity coefficient |
| Imprint Steps | 200 | Training duration |

## License

MIT
