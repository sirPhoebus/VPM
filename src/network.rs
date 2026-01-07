use std::f64::consts::PI;
use wasm_bindgen::prelude::*;


const CONNECTIONS_PER_OSC: usize = 40;
const VAR_WINDOW: usize = 50;

struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }
    fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.state >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[wasm_bindgen]
pub struct Network {
    size: usize,
    history_stride: usize,

    floats: Box<[f64]>,
    ints: Box<[u32]>, 

    np_off: usize,
    f_off: usize,
    ep_off: usize,
    es_off: usize,
    h_off: usize,
    s_off: usize,
    o_off: usize,
    v_off: usize,

    plasticity: f64,
    global_frustration: f64,
    
    var_sum: f64,
    var_sumsq: f64,
    var_idx: usize,
    energy_n: usize,
    pub stage: usize,
    pub mode: usize, 
    
    rng: Lcg,
}

#[wasm_bindgen]
impl Network {
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize, max_history_len: usize) -> Self {
        let mut rng = Lcg::new(9999);
        let stride = max_history_len + 1;
        let total_conn = size * CONNECTIONS_PER_OSC;

        let np_off = size;
        let f_off = 2 * size;
        let ep_off = 3 * size;
        let es_off = 4 * size;
        let h_off = 5 * size;
        let s_off = 5 * size + size * stride; 
        let o_off = s_off + total_conn;
        let v_off = o_off + total_conn;
        let total_floats = v_off + VAR_WINDOW;

        let mut floats = vec![0.0; total_floats].into_boxed_slice();
        let mut ints = vec![0u32; total_conn * 2].into_boxed_slice();

        for i in 0..size {
            floats[i] = rng.next_f64() * 2.0 * PI; 
            floats[np_off + i] = floats[i];
            // FREQUENCY SPECTRUM: 0.0 Hz forces static attractors (XY Model / Hopfield)
            floats[f_off + i] = 0.0; 
            floats[ep_off + i] = 0.0;
            floats[es_off + i] = 0.0; 
            for h in 0..stride {
                floats[h_off + i * stride + h] = floats[i];
            }
        }

        for i in 0..size {
            let base = i * CONNECTIONS_PER_OSC;
            for c in 0..CONNECTIONS_PER_OSC {
                let idx = base + c;
                let mut target = (rng.next_f64() * size as f64) as usize;
                if target >= size { target = size - 1; }
                if target == i { target = (target + 1) % size; }
                ints[idx] = target as u32;
                ints[total_conn + idx] = 2; 
                floats[s_off + idx] = 0.01; // Minimal starting bonds
                floats[o_off + idx] = 0.0; 
            }
        }

        Self {
            size,
            history_stride: stride,
            floats,
            ints,
            np_off, f_off, ep_off, es_off, h_off, s_off, o_off, v_off,
            plasticity: 0.05,
            global_frustration: 0.0,
            var_sum: 0.0,
            var_sumsq: 0.0,
            var_idx: 0,
            energy_n: 0,
            stage: 0,
            mode: 0, 
            rng,
        }
    }

    #[wasm_bindgen]
    pub fn step(&mut self, dt: f64, lr_override: f64) {
        let total_c = self.size * CONNECTIONS_PER_OSC;
        let mut local_frustration = 0.0;

        for i in 0..self.size {
            let p_i = self.floats[i];
            let mut f_int = 0.0;
            let base = i * CONNECTIONS_PER_OSC;
            for c in 0..CONNECTIONS_PER_OSC {
                let idx = base + c;
                let t_idx = self.ints[idx] as usize;
                let d_steps = self.ints[total_c + idx] as usize;
                let p_j = self.floats[self.h_off + t_idx * self.history_stride + d_steps];
                f_int += self.floats[self.s_off + idx] * (p_j - p_i - self.floats[self.o_off + idx]).sin();
            }
            let f_ext = self.floats[self.es_off + i] * (self.floats[self.ep_off + i] - p_i).sin();
            let omega = self.floats[self.f_off + i] * 2.0 * PI; // Omega is rad/s
            
            // JITTER TERM: Lowered significantly (0.02 -> 0.005) to reduce noise
            let jitter = (self.rng.next_f64() - 0.5) * 0.005;
            
            let d_p = (omega + f_int + f_ext) * dt + jitter;
            let mut next = p_i + d_p;
            
            local_frustration -= f_int; 
            next %= 2.0 * PI; 
            if next < 0.0 { next += 2.0 * PI; }
            self.floats[self.np_off + i] = next;
        }

        // Learning
        if self.mode == 1 || lr_override > 0.0 {
            let lr = if lr_override > 0.0 { lr_override } else { self.plasticity };
            for i in 0..self.size {
                let p_i = self.floats[i];
                let base = i * CONNECTIONS_PER_OSC;
                for c in 0..CONNECTIONS_PER_OSC {
                    let idx = base + c;
                    let t_idx = self.ints[idx] as usize;
                    let d_steps = self.ints[total_c + idx] as usize;
                    let p_j = self.floats[self.h_off + t_idx * self.history_stride + d_steps];
                    let diff = p_j - p_i - self.floats[self.o_off + idx];
                    self.floats[self.o_off + idx] = (self.floats[self.o_off + idx] + lr * diff.sin()) % (2.0 * PI);
                    let alignment = diff.cos();
                    // MEMORY DECAY: Lowered (3.0 -> 1.0) to give the 'X' more persistence
                    self.floats[self.s_off + idx] += (alignment - 1.0 * self.floats[self.s_off + idx]) * lr;
                    // COUPLING CLAMP: Increased (0.8 -> 1.5) to allow stronger internal bonds
                    self.floats[self.s_off + idx] = self.floats[self.s_off + idx].clamp(-1.5, 1.5);
                }
            }
        }

        for i in 0..self.size {
            self.floats[i] = self.floats[self.np_off + i];
            let start = self.h_off + i * self.history_stride;
            for h in (1..self.history_stride).rev() {
                self.floats[start + h] = self.floats[start + h - 1];
            }
            self.floats[start] = self.floats[i];
        }
    }

    #[wasm_bindgen]
    pub fn imprint(&mut self, strength: f64) {
        let total_c = self.size * CONNECTIONS_PER_OSC;
        for i in 0..self.size {
            let p_i = self.floats[i];
            let base = i * CONNECTIONS_PER_OSC;
            for c in 0..CONNECTIONS_PER_OSC {
                let idx = base + c;
                let t_idx = self.ints[idx] as usize;
                let d_steps = self.ints[total_c + idx] as usize;
                let p_j = self.floats[self.h_off + t_idx * self.history_stride + d_steps];
                
                let diff = p_j - p_i; // Desired phase offset
                
                // Vector addition of weights
                let s_old = self.floats[self.s_off + idx];
                let o_old = self.floats[self.o_off + idx];
                
                let re = s_old * o_old.cos() + strength * diff.cos();
                let im = s_old * o_old.sin() + strength * diff.sin();
                
                let mut s_new = (re * re + im * im).sqrt();
                let o_new = im.atan2(re);
                
                // Clamp strength
                s_new = s_new.clamp(0.0, 10.0);
                
                self.floats[self.s_off + idx] = s_new;
                self.floats[self.o_off + idx] = if o_new < 0.0 { o_new + 2.0 * PI } else { o_new };
            }
        }
    }

    #[wasm_bindgen]
    pub fn shake(&mut self) {
        self.clear_drives();
        for i in 0..self.size {
            self.floats[i] = self.rng.next_f64() * 2.0 * PI;
            self.floats[self.np_off + i] = self.floats[i];
            let start = self.h_off + i * self.history_stride;
            for h in 0..self.history_stride {
                self.floats[start + h] = self.floats[i];
            }
            // Also jumble frequencies slightly to break coherence, but keep in low range
            self.floats[self.f_off + i] = 0.0;
        }
    }

    #[wasm_bindgen]
    pub fn reset_connectivity(&mut self) {
        let total_conn = self.size * CONNECTIONS_PER_OSC;
        for c in 0..total_conn {
            self.floats[self.s_off + c] = 0.01;
            self.floats[self.o_off + c] = 0.0;
        }
    }

    #[wasm_bindgen]
    pub fn phases_ptr(&self) -> *const f64 { self.floats.as_ptr() }
    #[wasm_bindgen]
    pub fn get_frustration(&self) -> f64 { self.global_frustration }
    #[wasm_bindgen]
    pub fn set_mode(&mut self, m: usize) { self.mode = m; }
    #[wasm_bindgen]
    pub fn drive_node(&mut self, idx: usize, phase: f64, strength: f64) {
        if idx < self.size {
            self.floats[self.ep_off + idx] = phase % (2.0 * PI);
            self.floats[self.es_off + idx] = strength;
        }
    }

    #[wasm_bindgen]
    pub fn clear_drives(&mut self) {
        for i in 0..self.size { self.floats[self.es_off + i] = 0.0; }
    }
    #[wasm_bindgen]
    pub fn size(&self) -> usize { self.size }
    
    #[wasm_bindgen]
    pub fn calculate_energy(&self) -> f64 {
        let total_c = self.size * CONNECTIONS_PER_OSC;
        let mut energy = 0.0;
        
        for i in 0..self.size {
            let p_i = self.floats[i];
            let base = i * CONNECTIONS_PER_OSC;
            for c in 0..CONNECTIONS_PER_OSC {
                let idx = base + c;
                let t_idx = self.ints[idx] as usize;
                let d_steps = self.ints[total_c + idx] as usize;
                let p_j = self.floats[self.h_off + t_idx * self.history_stride + d_steps];
                let diff = p_j - p_i - self.floats[self.o_off + idx];
                energy -= self.floats[self.s_off + idx] * diff.cos();
            }
        }
        
        energy / (self.size as f64)
    }
    

    #[wasm_bindgen]
    pub fn memory(&self) -> wasm_bindgen::JsValue {
        wasm_bindgen::memory()
    }

    #[wasm_bindgen]
    pub fn get_phase(&self, idx: usize) -> f64 {
        self.floats[idx]
    }
    
    #[wasm_bindgen]
    pub fn set_phase(&mut self, idx: usize, val: f64) {
        if idx < self.size {
            self.floats[idx] = val;
            self.floats[self.np_off + idx] = val;
            
            let start = self.h_off + idx * self.history_stride;
            for h in 0..self.history_stride {
                self.floats[start + h] = val;
            }
        }
    }
}
