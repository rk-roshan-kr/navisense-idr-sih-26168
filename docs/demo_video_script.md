# Navisense IDR — 2-Minute SIH Demonstration Video Script

> **Video Title:** Navisense IDR: Seamless Vehicular Navigation Through Complete GNSS Outages  
> **Problem Statement ID:** PS 26168 (ISRO / Ministry of Space)  
> **Target Duration:** 2 Minutes (120 seconds)  
> **Screen Setup:** Fullscreen browser at `http://127.0.0.1:8000`

---

## Timeline & Narration

### **0:00 – 0:20 | Hook & Problem Statement**
* **Visual:** Fullscreen camera of speaker / slide showing a car entering a tunnel, followed by a smartphone screen showing "Searching for GPS..." with a frozen arrow.
* **Audio / Voiceover:**  
  *"Every day, millions of drivers lose satellite signal in tunnels, underpasses, and urban canyons. When GPS disappears, navigation apps freeze, leaving drivers blind at critical highway forks and exits. Standard smartphone sensors drift by hundreds of metres within seconds due to sensor noise double-integration. We built Navisense IDR to solve this problem permanently."*

---

### **0:20 – 0:45 | The Core Innovation (Live Demo Begins)**
* **Visual:** Switch to live prototype at `http://127.0.0.1:8000`. The map shows the vehicle cruising at 57 km/h ($082^\circ$). The green GNSS trail draws smoothly along the road.
* **Audio / Voiceover:**  
  *"This is Navisense IDR running on real recorded vehicle IMU data from the IO-VNBD dataset. Notice that our frontend isn't a mock animation—it is streaming at 10 Hz directly from our PyTorch neural backend. While GNSS is active, our Personalization Adapter calibrates the phone's 3D mounting angle in the cradle, as well as the vehicle's forward speed scale and chassis yaw response."*

---

### **0:45 – 1:15 | The Climax: Simulating GNSS Loss**
* **Visual:** The presenter moves the mouse and clicks the large central button: `[ ⚠️ SIMULATE GNSS LOSS ]`.
  - The green GNSS trail instantly freezes.
  - The alert banner flashes: `⚠️ GNSS SIGNAL LOST — NAVISENSE IDR ACTIVE — NAVIGATION CONTINUES`.
  - The electric blue IDR trail continues driving forward smoothly along the road network.
  - The drift indicator shows `2.6%`.
* **Audio / Voiceover:**  
  *"Now, watch what happens when satellite signal drops. I click 'Simulate GNSS Loss.' The green GPS line stops dead in its tracks. But look at the car—the electric blue line continues driving forward along the road without a single glitch! Navisense has seamlessly engaged its learned inertial motion model. Speed reads 57 km/h, heading reads 082 degrees, and cumulative drift is held to just 2.6% over a full 1-kilometre blackout!"*

---

### **1:15 – 1:35 | Technical Rigor & Road Graph Safety**
* **Visual:** Presenter clicks `[ ⚙ TECHNICAL PROOF ]` in the bottom right corner. The drawer expands to reveal live 10 Hz accelerometer and gyroscope gauges, PyTorch predicted velocity, and the map hypothesis card showing `Candidate Probability: 92% • ACCEPTED`.
* **Audio / Voiceover:**  
  *"For the technical judges: our model doesn't blindly snap to roads. Navisense maintains an ultra-compact vector road corridor cache requiring under 30 kilobytes of RAM. Our probabilistic gating computes candidate edge probabilities and strictly rejects updates if the road is ambiguous, preventing the car from snapping onto wrong side-branches."*

---

### **1:35 – 1:50 | Smooth Reconvergence**
* **Visual:** Presenter clicks `[ ✓ RESTORE GNSS SIGNAL ]`. The green GNSS trail resumes, and the vehicle state smoothly aligns with satellite coordinates without any sudden teleportation.
* **Audio / Voiceover:**  
  *"When the vehicle emerges from the tunnel, GNSS signal is restored. Our exponential reconvergence filter smoothly fuses the satellite position with the dead-reckoning state, eliminating jarring visual jumps."*

---

### **1:50 – 2:00 | Conclusion & Impact**
* **Visual:** Final slide showing Navisense IDR branding, key metrics (2.6% Highway drift, <30 KB RAM, zero extra hardware), and ISRO / NavIC logo alignment.
* **Audio / Voiceover:**  
  *"Navisense IDR requires zero OBD dongles, zero external sensors, and runs efficiently on standard smartphone CPUs in under 2 milliseconds. It brings military-grade dead-reckoning to everyday drivers and NavIC navigation. Thank you!"*
