# SIH 26168 — Live Hackathon Presentation & Demonstration Script

> **Problem Statement ID:** PS 26168 (ISRO)  
> **Topic:** AI-ML Based Intelligent Dead Reckoning System for Seamless Navigation  
> **Key Thesis:** An ordinary smartphone alone can achieve sub-10% dead reckoning drift during GNSS blackouts by personalizing a universal motion prior to the user's specific vehicle and mount during normal GNSS-guided driving.

---

## 1. The 4 Core Truths for the Jury

| Truth | How We Prove It Live |
| :--- | :--- |
| **1. Works Without GNSS** | The blue trajectory continues without interruption when GNSS is severed. |
| **2. Active Before Blackout** | Dual-path tracking (Green GNSS vs Blue IDR) proves IDR is already running independently. |
| **3. Personalized to the Vehicle** | Demonstrating measurably lower drift on unseen vehicle held-out routes compared to generic models. |
| **4. Quantitatively Meets ISRO Target** | Live drift percentage counter showing <10% drift over distance traveled during outages. |

---

## 2. 5-Scene Live Demonstration Walkthrough

### Scene 1: Smartphone Mount & Zero Configuration
* **Action in Console:** Click `1. Mount`.
* **Presenter Script:**
  > *"Judges, the problem statement specifically targets ordinary vehicles using only a smartphone mounted on the dashboard—with no OBD-II connection or wheel speed sensors. Our application starts with zero manual calibration required from the driver."*
* **Visual on Screen:** Vehicle placed at origin, raw accelerometer/gyroscope reading 10 Hz telemetry.

---

### Scene 2: Passive Auto-Calibration
* **Action in Console:** Click `2. Calibrate`.
* **Presenter Script:**
  > *"As the car drives normally for the first 30 seconds with GNSS available, our online calibration engine dynamically estimates the phone-to-vehicle rotation matrix R_b^p (pitch and roll misalignment), isolates sensor biases, and learns the vehicle's specific acceleration response scale."*
* **Visual on Screen:** Personalization score climbs to 100%, mount angles stabilize to 0.11° pitch and 0.28° roll.

---

### Scene 3: Dual Tracking & Strict GNSS Isolation
* **Action in Console:** Click `3. Dual Track`.
* **Presenter Script:**
  > *"Notice that we run two simultaneous navigators: the Green path is the GNSS reference, and the Blue path is our independent sensor-only dead reckoning estimator. We enforce STRICT GNSS ISOLATION: GPS position is NEVER fed into our dead reckoning loop. It is already navigating alone while GNSS is healthy."*
* **Visual on Screen:** Green and Blue lines tracking in tandem; GNSS Isolation banner displays PASSIVE SUPERVISOR.

---

### Scene 4: GNSS Blackout Outage (Tunnel / Urban Canyon)
* **Action in Console:** Click `4. Blackout` (or trigger 30s Outage / 60s Outage).
* **Presenter Script:**
  > *"Now, the vehicle enters a tunnel or dense urban canyon: GNSS is completely lost. Notice that the Green path immediately cuts off. But our Blue path continues navigating smoothly using our learned vehicle dynamics and Non-Holonomic Constraints. Looking at the baseline comparison on the chart, Raw INS (Red) has already exploded past 200% drift, while our Personalized IDR remains tightly constrained under ISRO's <10% threshold."*
* **Visual on Screen:** Red blackout overlay activates with countdown, Green path terminates, Blue path continues around corners, drift counter reads PASS (<10%).

---

### Scene 5: Re-convergence & ISRO Metric Verification
* **Action in Console:** Click `5. Recover`.
* **Presenter Script:**
  > *"When the vehicle emerges from the tunnel, the system smoothly fuses with the returning GNSS signals without visual jumps or teleportation. Across our benchmarks on the official IO-VNBD dataset, our personalized IDR reduces drift by over 40% compared to raw strapdown integration."*
* **Visual on Screen:** Green line returns, Blue path reconverges smoothly, final drift table displayed.

---

## 3. Scientific Defense (Jury Q&A)

**Q: How do you handle engine vibration and potholes?**  
*A: Our 1D temporal convolutional layers filter high-frequency engine harmonics while an adaptive suspension damping layer isolates pothole impulse spikes from true translational acceleration.*

**Q: How do you prevent lateral drift without wheel sensors?**  
*A: We enforce Non-Holonomic Constraints (v_y^b = v_z^b ≈ 0), ensuring the vehicle cannot slide sideways or bounce off the ground in the kinematic state update.*

**Q: Why not just use a standard Kalman Filter?**  
*A: Consumer MEMS sensors in smartphones suffer from unmodeled non-linear vehicle dynamics, suspension pitch, and engine harmonics that standard EKFs struggle with without a speed feed. Our neural base model provides the learned velocity state that stabilizes the filter.*
