mod network;
mod curriculum;

use network::Network;
use std::f64::consts::PI;

fn main() {
    let size = 500; // Larger size for better stats
    let max_history = 5;
    
    println!("--- VPM Resonance Network Verification ---");

    let mut net = Network::new(size, max_history);
    println!("Network initialized with {} nodes.", net.size());
    
    // 1. Create Pattern A
    net.shake();
    let pat_a: Vec<f64> = (0..size).map(|i| net.get_phase(i)).collect();
    println!("Pattern A generated.");
    
    // 2. Imprint Pattern A
    net.imprint(2.0); // Strength 2.0
    println!("Pattern A imprinted.");
    
    // 3. Create Pattern B
    net.shake();
    let pat_b: Vec<f64> = (0..size).map(|i| net.get_phase(i)).collect();
    println!("Pattern B generated.");
    
    // 4. Imprint Pattern B
    net.imprint(2.0); // Strength 2.0
    println!("Pattern B imprinted.");

    // 5. Create Pattern C (to push it)
    net.shake();
    let pat_c: Vec<f64> = (0..size).map(|i| net.get_phase(i)).collect();
    net.imprint(2.0);
    println!("Pattern C imprinted.");

    // TEST: Measure Energy
    
    // State A
    for i in 0..size { net.set_phase(i, pat_a[i]); }
    let energy_a = net.calculate_energy();
    println!("Energy at Pattern A: {:.4}", energy_a);
    
    // State B
    for i in 0..size { net.set_phase(i, pat_b[i]); }
    let energy_b = net.calculate_energy();
    println!("Energy at Pattern B: {:.4}", energy_b);

    // State C
    for i in 0..size { net.set_phase(i, pat_c[i]); }
    let energy_c = net.calculate_energy();
    println!("Energy at Pattern C: {:.4}", energy_c);
    
    // Random State
    net.shake();
    let energy_rand = net.calculate_energy();
    println!("Energy at Random State: {:.4}", energy_rand);
    
    if energy_a < -0.5 && energy_b < -0.5 && energy_c < -0.5 {
         if energy_rand > -0.1 {
             println!("SUCCESS: Patterns A, B, and C are deep energy minima compared to random noise.");
         } else {
             println!("WARNING: Random state energy is unexpectedly low ({:.4}). Check frustration.", energy_rand);
         }
    } else {
        println!("FAILURE: One or more patterns are not stable (Energy > -0.5).");
    }
}
