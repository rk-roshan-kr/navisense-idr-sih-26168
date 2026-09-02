# SIH 26168 — Scientific Experiment & Evaluation Protocol

This protocol defines the rigorous testing methodology to validate the **Intelligent Dead Reckoning (IDR)** system on the **IO-VNBD dataset** for ISRO PS 26168 screening and evaluation.

---

## 1. Train / Calibration vs. Held-Out Route Splitting

To prevent overfitting or route memorization, sequences are divided into strictly separated sets:

```
[ Dataset: IO-VNBD ]
  ├── Train / Personalization Routes (GNSS + IMU available for online adapter):
  │   ├── Driver A: Sequence S1, S3a
  │   ├── Driver B: Sequence M1, M2
  │   └── Driver E: Sequence Vf1
  │
  └── HELD-OUT Evaluation Routes (Strict GNSS Blackout Testing):
      ├── Driver A: Sequence S2, S4
      ├── Driver B: Sequence M3, M4
      └── Driver E: Sequence Vf2
```

**Rule:** The held-out test routes must **never** be seen during offline model pre-training or online personalization adaptation.

---

## 2. Mathematical Metric Definitions

### 2.1 End-Point Position Drift ($E_{end}$)
$$E_{end} = \|\hat{\mathbf{p}}_{IDR}(T) - \mathbf{p}_{ref}(T)\| = \sqrt{(\hat{x}_T - x_T^{ref})^2 + (\hat{y}_T - y_T^{ref})^2}$$

### 2.2 Drift Percentage ($Drift\%$)
$$Drift\% = \frac{E_{end}}{D_{travel}} \times 100\%$$
where $D_{travel} = \sum_{k=1}^{N-1} \|\mathbf{p}_{ref}(k+1) - \mathbf{p}_{ref}(k)\|$ is the total distance traveled during the outage window.

### 2.3 Maximum Error ($E_{max}$)
$$E_{max} = \max_{t \in [T_0, T_1]} \|\hat{\mathbf{p}}_{IDR}(t) - \mathbf{p}_{ref}(t)\|$$

### 2.4 Along-Track & Cross-Track Error Decomposition
Given the instantaneous reference direction unit vector $\hat{\mathbf{u}}_{along}$ and perpendicular unit vector $\hat{\mathbf{u}}_{cross}$:
$$E_{along}(t) = |(\hat{\mathbf{p}}_{IDR}(t) - \mathbf{p}_{ref}(t)) \cdot \hat{\mathbf{u}}_{along}|$$
$$E_{cross}(t) = |(\hat{\mathbf{p}}_{IDR}(t) - \mathbf{p}_{ref}(t)) \cdot \hat{\mathbf{u}}_{cross}|$$

---

## 3. Blackout Outage Protocol

For every evaluation run:
1. **Phase 1 (GNSS Active, $t < T_0$):** Vehicle drives normally with GNSS reference to stabilize the personalization parameter state ($\boldsymbol{\theta}_{personal}$).
2. **Phase 2 (Outage Onset, $t = T_0$):** GNSS is abruptly severed.
3. **Phase 3 (Dead Reckoning, $T_0 \le t \le T_1$):** Estimator propagates state purely on MEMS Accelerometer + Gyroscope + Personalized Model.
4. **Phase 4 (Restoration, $t = T_1$):** End-point drift, maximum trajectory deviation, and along/cross track errors are computed against hidden ground truth.

---

## 4. Evaluation Cases
* **Case 1:** 10-second Urban Drop (20 randomized windows)
* **Case 2:** 30-second Urban Canyon (20 randomized windows)
* **Case 3:** 60-second Tunnel Blackout (20 randomized windows)
* **Case 4:** 500-meter / 1-kilometer Distance Outage (15 continuous windows)
