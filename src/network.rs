use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

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
    
    // State
    phases: Vec<f64>,
    next_phases: Vec<f64>,
    
    // Dense Memory (Dual Formulation)
    // We store the raw pattern vectors.
    // Memory usage: N * P * 8 bytes.
    // For N=4096, P=100, this is ~3.2 MB. Trivial.
    patterns: Vec<Vec<f64>>,
    
    rng: Lcg,
    
    // Evaluation metrics
    pub global_overlap: f64,
}

#[wasm_bindgen]
impl Network {
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize, _unused_history: usize) -> Self {
        let mut rng = Lcg::new(12345);
        
        let mut phases = vec![0.0; size];
        for i in 0..size {
            phases[i] = rng.next_f64() * 2.0 * PI;
        }

        Self {
            size,
            phases: phases.clone(),
            next_phases: phases,
            patterns: Vec::new(),
            rng,
            global_overlap: 0.0,
        }
    }

    #[wasm_bindgen]
    pub fn step(&mut self, dt: f64, _lr_unused: f64) {
        let n_inv = 1.0 / (self.size as f64);
        
        // 1. Calculate Overlaps (Order parameter m_mu)
        // m_mu = (1/N) * sum_j cos(theta_j - xi_j^mu)
        // This represents how close the current state is to each stored pattern.
        let mut overlaps = vec![0.0; self.patterns.len()];
        
        for (p_idx, pattern) in self.patterns.iter().enumerate() {
            let mut sum_cos = 0.0;
            // Optimization: Unrolling or SIMD would be better, but loop is fine for WASM < 10k nodes
            for i in 0..self.size {
                let diff = self.phases[i] - pattern[i];
                sum_cos += diff.cos(); // Real part of alignment
            }
            overlaps[p_idx] = sum_cos * n_inv;
        }
        
        // Store max overlap for UI
        self.global_overlap = overlaps.iter().cloned().fold(0.0, f64::max);

        // 2. Calculate Forces and Update
        // d(theta_i)/dt = sum_mu ( m_mu * sin(xi_i^mu - theta_i) )
        // This pulls the state towards patterns with high overlap.
        
        for i in 0..self.size {
            let mut force = 0.0;
            let theta_i = self.phases[i];
            
            for (p_idx, pattern) in self.patterns.iter().enumerate() {
                let m_mu = overlaps[p_idx];
                
                // Modern Hopfield Network (Dense Associative Memory)
                // Energy function E = -1/beta * log(sum(exp(beta * m_mu)))
                // Update rule uses softmax-like weighting.
                // Beta determines the "sharpness" of the attention.
                let beta = 30.0;
                let weight = (beta * (m_mu - self.global_overlap)).exp(); 
                
                let weight = (beta * (m_mu - self.global_overlap)).exp() * m_mu.max(0.0).powi(2);
                
                let diff = pattern[i] - theta_i;
                force += weight * diff.sin();
            }
            
            // Normalize force to prevent numerical explosion
            // (Optional, but good for stability)
            // force = force.tanh(); 
            
            let mut next = theta_i + force * dt;
            
            // Wrap to 0..2PI
            next = next % (2.0 * PI);
            if next < 0.0 { next += 2.0 * PI; }
            
            self.next_phases[i] = next;
        }
        
        // Swap buffers
        self.phases.copy_from_slice(&self.next_phases);
    }

    #[wasm_bindgen]
    pub fn imprint(&mut self, _strength: f64) {
        // In Dual Formulation, "imprinting" is just storing the pattern vector.
        // We clone the current state.
        self.patterns.push(self.phases.clone());
    }
    
    #[wasm_bindgen]
    pub fn clear_patterns(&mut self) {
        self.patterns.clear();
    }
    
    #[wasm_bindgen]
    pub fn shake(&mut self) {
        for i in 0..self.size {
            self.phases[i] = self.rng.next_f64() * 2.0 * PI;
        }
    }

    #[wasm_bindgen]
    pub fn size(&self) -> usize { self.size }
    
    #[wasm_bindgen]
    pub fn phases_ptr(&self) -> *const f64 { self.phases.as_ptr() }
    
    #[wasm_bindgen]
    pub fn memory(&self) -> wasm_bindgen::JsValue {
        wasm_bindgen::memory()
    }
    
    #[wasm_bindgen]
    pub fn get_phase(&self, idx: usize) -> f64 {
        if idx < self.size { self.phases[idx] } else { 0.0 }
    }
    
    #[wasm_bindgen]
    pub fn set_phase(&mut self, idx: usize, val: f64) {
        if idx < self.size {
             self.phases[idx] = val;
             self.next_phases[idx] = val;
        }
    }

    #[wasm_bindgen]
    pub fn set_state_from_array(&mut self, data: &[f64]) {
        if data.len() == self.size {
            for (i, val) in data.iter().enumerate() {
                self.phases[i] = *val;
                self.next_phases[i] = *val;
            }
        }
    }
    
    // Legacy support (stubs)
    #[wasm_bindgen]
    pub fn clear_drives(&mut self) {}
    #[wasm_bindgen]
    pub fn get_frustration(&self) -> f64 { 0.0 }
    #[wasm_bindgen]
    pub fn reset_connectivity(&mut self) { self.clear_patterns(); }
}
