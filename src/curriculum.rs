use std::f64;

pub struct Curriculum {
    pub stiffness: f64,
    pub damping: f64,
    pub plasticity: f64,
    pub target_total_strength: f64,
    pub energy_ema: f64,
    pub energy_init: bool,
    pub var_window: usize,
    pub var_sum: f64,
    pub var_sumsq: f64,
    pub var_buf: Vec<f64>,
    pub var_idx: usize,
    pub energy_n: usize,
    pub stable_count: usize,
    pub unstable_count: usize,
    pub stage: usize,
    pub mode: usize,
    pub mode_timer: usize,
    pub jitter_pending: bool,
    
    // Constants
    pub variance_eps: f64,
    pub variance_scale: f64,
    pub tighten_stable_steps: usize,
    pub relax_unstable_steps: usize,
    pub consolidate_steps: usize,
    pub release_steps: usize,
    pub release_jitter: f64,
}

pub const MODE_DISCOVER: usize = 0;
pub const MODE_CONSOLIDATE: usize = 1;
pub const MODE_RELEASE: usize = 2;

impl Curriculum {
    pub fn new() -> Self {
        let var_window = 50;
        Self {
            stiffness: 1.0,
            damping: 0.0,
            plasticity: 0.05,
            target_total_strength: 10.0,
            energy_ema: 0.0,
            energy_init: false,
            var_window,
            var_sum: 0.0,
            var_sumsq: 0.0,
            var_buf: vec![0.0; var_window], // Pre-allocate!
            var_idx: 0,
            energy_n: 0,
            stable_count: 0,
            unstable_count: 0,
            stage: 0,
            mode: MODE_DISCOVER,
            mode_timer: 0,
            jitter_pending: false,
            
            variance_eps: 50.0,
            variance_scale: 0.35,
            tighten_stable_steps: 150,
            relax_unstable_steps: 400,
            consolidate_steps: 80,
            release_steps: 20,
            release_jitter: 0.05,
        }
    }

    pub fn update_from_energy(&mut self, energy: f64) {
        let alpha = 0.02;

        if !self.energy_init {
            self.energy_ema = energy;
            self.energy_init = true;
        } else {
            self.energy_ema = (1.0 - alpha) * self.energy_ema + alpha * energy;
        }

        // NO ALLOCATIONS HERE ANYMORE
        let cap = self.var_buf.len();
        if cap == 0 { return; } // Safety

        if self.energy_n < cap {
            self.var_buf[self.energy_n] = energy;
            self.var_sum += energy;
            self.var_sumsq += energy * energy;
            self.energy_n += 1;
        } else {
            let old = self.var_buf[self.var_idx];
            self.var_buf[self.var_idx] = energy;
            self.var_sum += energy - old;
            self.var_sumsq += energy * energy - old * old;
            self.var_idx = (self.var_idx + 1) % cap;
        }

        let n = self.energy_n as f64;
        if n < 1.0 { return; }
        
        let mean = self.var_sum / n;
        let variance = (self.var_sumsq / n) - mean * mean;
        let variance_eps = self.variance_eps + self.variance_scale * mean.abs();
        let is_stable = variance < variance_eps;

        if is_stable {
            self.stable_count += 1;
            self.unstable_count = 0;
        } else {
            self.unstable_count += 1;
            if self.unstable_count > 50 {
                self.stable_count = 0;
            }
        }

        if self.stable_count > self.tighten_stable_steps {
            self.stage += 1;
            self.stable_count = 0;

            self.stiffness = (self.stiffness + 0.25).min(8.0);
            self.damping = (self.damping + 0.001).min(0.05);
            self.plasticity = (self.plasticity * 0.85).max(0.001);

            self.mode = MODE_CONSOLIDATE;
            self.mode_timer = self.consolidate_steps;
        }

        if self.unstable_count > self.relax_unstable_steps {
            self.stage = self.stage.saturating_sub(1);
            self.unstable_count = 0;

            self.stiffness = (self.stiffness * 0.95).max(1.0);
            self.damping = (self.damping * 0.9).max(0.0);
            self.plasticity = (self.plasticity * 1.1).min(0.05);

            self.mode = MODE_DISCOVER;
            self.mode_timer = 0;
        }

        if self.mode == MODE_CONSOLIDATE {
            if self.mode_timer > 0 {
                self.mode_timer -= 1;
            } else {
                self.mode = MODE_RELEASE;
                self.mode_timer = self.release_steps;
                self.jitter_pending = true;
            }
        } else if self.mode == MODE_RELEASE {
            if self.mode_timer > 0 {
                self.mode_timer -= 1;
            } else {
                self.mode = MODE_DISCOVER;
                self.mode_timer = 0;
            }
        }
    }
}
