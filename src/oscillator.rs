use std::collections::VecDeque;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

use crate::curriculum;

/// Represents a connection to another oscillator.
/// The delay_steps simulates axonal delay (Polychronicity).
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct Synapse {
    pub target_idx: usize,
    pub strength: f64,      // Can be negative for inhibition
    pub phase_offset: f64,  // Learned harmonic relationship
    pub delay_steps: usize, // Physical distance/time delay
}

/// A single node in the resonance network.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct Oscillator {
    pub phase: f64,
    pub frequency: f64,
    pub(crate) couplings: Vec<Synapse>,
    pub(crate) external_drive_phase: Option<f64>,
    pub external_drive_strength: f64,
}

impl Oscillator {
    pub fn new(frequency: f64) -> Self {
        Self {
            phase: rand::random::<f64>() * 2.0 * PI,
            frequency,
            couplings: Vec::new(),
            external_drive_phase: None,
            external_drive_strength: 0.0,
        }
    }

    pub fn set_external_drive(&mut self, phase: f64, strength: f64) {
        self.external_drive_phase = Some(phase);
        self.external_drive_strength = strength;
    }

    pub fn clear_external_drive(&mut self) {
        self.external_drive_phase = None;
        self.external_drive_strength = 0.0;
    }

    /// Calculates the next phase based on neighbors.
    /// `neighbors_history` is a slice where index `i` correspond to the history of oscillator `i`.
    pub fn update_phase(&mut self, neighbors_history: &[VecDeque<f64>], dt: f64, damping: f64) {
        let mut force = 0.0;
        
        for synapse in &self.couplings {
            // Access the target's history at the specific delay
            if let Some(history) = neighbors_history.get(synapse.target_idx) {
                if let Some(past_phase) = history.get(synapse.delay_steps) {
                     // Interaction: strength * sin(theta_j(t-tau) - theta_i(t) - phase_offset)
                    force += synapse.strength * (past_phase - self.phase - synapse.phase_offset).sin();
                }
            }
        }

        self.phase += (self.frequency + force - damping * self.phase.sin()) * dt;
        self.phase %= 2.0 * PI;
        if self.phase < 0.0 {
            self.phase += 2.0 * PI;
        }
    }

    /// Updates the synaptic weights (plasticity) based on Hebbian learning.
    pub fn learn(&mut self, neighbors_history: &[VecDeque<f64>], effective_lr: f64, stiffness: f64) {
        for synapse in &mut self.couplings {
             if let Some(history) = neighbors_history.get(synapse.target_idx) {
                if let Some(past_phase) = history.get(synapse.delay_steps) {
                    // Correlation: Are they vibrating in the expected relationship?
                    let base = (past_phase - self.phase - synapse.phase_offset).cos();
                    let correlation = base.signum() * base.abs().powf(stiffness);
                    
                    // Hebbian Update: dK = (correlation - decay) * rate
                    let decay = 0.01 * synapse.strength; 
                    synapse.strength += (correlation - decay) * effective_lr;

                    let phase_err = past_phase - self.phase - synapse.phase_offset;
                    synapse.phase_offset += effective_lr * phase_err.sin();
                    synapse.phase_offset %= 2.0 * PI;
                    if synapse.phase_offset < 0.0 {
                        synapse.phase_offset += 2.0 * PI;
                    }
                }
             }
        }
    }

    /// prevents runaway excitation by scaling weights so their sum equals a constant.
    pub fn normalize_weights(&mut self, target_total: f64) {
        let total_strength: f64 = self.couplings.iter().map(|s| s.strength.abs()).sum();
        
        if total_strength > 0.0001 {
            let scale = target_total / total_strength;
            for synapse in &mut self.couplings {
                synapse.strength *= scale;
            }
        }
    }
}
