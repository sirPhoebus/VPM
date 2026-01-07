mod network;

use network::Network;

fn main() {
    let size = 4096; // 64x64
    let mut net = Network::new(size, 0);
    
    println!("--- Dense Associative Memory Verification (Dual Form) ---");
    println!("Nodes: {}", size);
    
    // 1. Create Pattern A (Random)
    net.shake();
    let pat_a: Vec<f64> = (0..size).map(|i| net.get_phase(i)).collect();
    net.imprint(1.0);
    println!("Pattern A imprinted.");

    // 2. Create Pattern B (Random)
    net.shake();
    let pat_b: Vec<f64> = (0..size).map(|i| net.get_phase(i)).collect();
    net.imprint(1.0);
    println!("Pattern B imprinted.");
    
    // 3. Recall Test
    // Set state to A + Noise
    println!("Cuing with Pattern A + Noise...");
    for i in 0..size {
        // 10% Noise
        let noise = if i % 10 == 0 { 3.0 } else { 0.0 }; 
        net.set_phase(i, pat_a[i] + noise);
    }
    
    // Run dynamics
    for t in 0..50 {
        net.step(0.1, 0.0);
    }
    
    // Measure overlap with A
    let mut overlap_a = 0.0;
    for i in 0..size {
        overlap_a += (net.get_phase(i) - pat_a[i]).cos();
    }
    overlap_a /= size as f64;
    
    println!("Final Overlap with A: {:.4}", overlap_a);
    
    if overlap_a > 0.95 {
        println!("SUCCESS: Perfect Recall achieved.");
    } else {
        println!("FAILURE: Recall failed (Overlap < 0.95).");
    }
}
