# NaviSense IDR — Mathematical & Algorithmic Formulations
## Smart India Hackathon 2024 | Problem Statement 26168

This document provides the complete, rigorous mathematical formulations for all seven algorithms implemented in the NaviSense IDR navigation engine.

---

## 1. 3D In-Vehicle Mount Alignment ($\text{SO}(3)$ Rotation)

Smartphones placed inside a vehicle have an arbitrary orientation relative to the vehicle's body axes.

### Coordinate Systems:
* **Phone Sensor Frame ($\mathcal{S}$):** $(x_s, y_s, z_s)$ aligned with phone chassis.
* **Vehicle Body Frame ($\mathcal{V}$):** $(x_v, y_v, z_v)$ defined as **Forward ($x$)**, **Right ($y$)**, **Down ($z$)**.

### Transformation Matrix:
$$\mathbf{R}_{\mathcal{S}}^{\mathcal{V}}(\alpha, \beta, \gamma) = \mathbf{R}_z(\gamma) \mathbf{R}_y(\beta) \mathbf{R}_x(\alpha)$$

$$\mathbf{R}_x(\alpha) = \begin{bmatrix} 1 & 0 & 0 \\ 0 & \cos\alpha & -\sin\alpha \\ 0 & \sin\alpha & \cos\alpha \end{bmatrix}, \quad
\mathbf{R}_y(\beta) = \begin{bmatrix} \cos\beta & 0 & \sin\beta \\ 0 & 1 & 0 \\ -\sin\beta & 0 & \cos\beta \end{bmatrix}, \quad
\mathbf{R}_z(\gamma) = \begin{bmatrix} \cos\gamma & -\sin\gamma & 0 \\ \sin\gamma & \cos\gamma & 0 \\ 0 & 0 & 1 \end{bmatrix}$$

$$\mathbf{a}_{\text{vehicle}} = \mathbf{R}_{\mathcal{S}}^{\mathcal{V}} \cdot \mathbf{a}_{\text{phone}}, \quad \boldsymbol{\omega}_{\text{vehicle}} = \mathbf{R}_{\mathcal{S}}^{\mathcal{V}} \cdot \boldsymbol{\omega}_{\text{phone}}$$

Euler angles $(\alpha, \beta, \gamma)$ are estimated dynamically via the online `PersonalizationAdapter` using gravity vector alignment and GNSS acceleration cross-correlation.

---

## 2. Neural Motion Increments (`UniversalMotionNet`)

Instead of naively integrating raw noisy acceleration $\iint a \, dt^2$ (which blows up quadratically with bias: $E(t) = \frac{1}{2} b_a t^2$), `UniversalMotionNet` directly predicts the **forward velocity trajectory $v(t)$** and **yaw turn rate $\omega_z(t)$**.

### Input Tensor:
$$\mathbf{X} \in \mathbb{R}^{B \times 9 \times W}, \quad W = 100 \text{ samples} \quad (1.0\text{ s at } 100\text{ Hz})$$

### Forward Distance Traveled ($\Delta s$):
Physical consistency is guaranteed by trapezoidal numerical integration across the predicted sequence of velocities $\mathbf{v}_{\text{seq}} = [v_1, v_2, \dots, v_W]$:
$$\Delta s = \int_0^{W \cdot \Delta t} v(\tau) \, d\tau \approx \sum_{k=1}^{W-1} \frac{v_k + v_{k+1}}{2} \cdot \Delta t$$
$$v_t = v_W \quad (\text{endpoint instantaneous forward speed})$$

### Heteroscedastic Aleatoric Uncertainty:
The network predicts both the mean $\hat{y}$ and log-variance $s = \log(\sigma^2)$ for velocity:
$$\mathcal{L}_{\text{hetero}} = \frac{1}{2} \exp(-s) \| y - \hat{y} \|^2 + \frac{1}{2} s$$

---

## 3. Kinematic State Estimator (10-State Filter)

### State Vector:
$$\mathbf{x}_t = \begin{bmatrix} E & N & v & \psi & b_{ax} & b_{ay} & b_{az} & b_{gx} & b_{gy} & b_{gz} \end{bmatrix}^T \in \mathbb{R}^{10}$$

### Kinematic Propagation Step:
Given window displacement $\Delta s$ and debiased yaw increment $\Delta\psi_{\text{clean}} = \Delta\psi - b_{gz} (W \cdot \Delta t)$:
$$\text{step\_ds} = \frac{\Delta s}{W}$$
$$\text{step\_dpsi} = \frac{\Delta\psi_{\text{clean}}}{W}$$
$$\psi_{\text{mid}} = \psi_{t-1} + \frac{\text{step\_dpsi}}{2}$$

$$E_t = E_{t-1} + \text{step\_ds} \cdot \sin(\psi_{\text{mid}})$$
$$N_t = N_{t-1} + \text{step\_ds} \cdot \cos(\psi_{\text{mid}})$$
$$v_t = v_{\text{pred}}$$
$$\psi_t = (\psi_{t-1} + \text{step\_dpsi}) \pmod{2\pi}$$

---

## 4. Multi-Condition Zero Velocity Updates (ZUPT)

To prevent spurious drift when a vehicle is idling at red lights or stopped in traffic, the state estimator evaluates five independent physical criteria:

1. **Neural Model Standstill Confidence:** $p_{\text{stop}} > 0.70$
2. **Kinematic Speed Threshold:** $v_t < 0.6\text{ m/s}$
3. **Recent Acceleration Variance:** $\text{Var}(\mathbf{a}_{t-10:t}) < 0.035\text{ m}^2/\text{s}^4$
4. **Recent Yaw Rate Variance:** $\text{Var}(\omega_{z, t-10:t}) < 0.001\text{ rad}^2/\text{s}^2$
5. **Gravity Vector Consistency:** $\big| \|\bar{\mathbf{a}}\| - 9.80665 \big| < 0.35\text{ m/s}^2$

### When All Conditions Are Satisfied:
* Velocity is clamped strictly to zero: $v_t \leftarrow 0$.
* Position integration is frozen: $dE = 0, dN = 0$.
* Gyroscope bias is updated via moving exponential recursive average:
  $$b_{gz} \leftarrow (1 - \alpha) b_{gz} + \alpha \, \omega_{z, \text{meas}} \quad (\alpha = 0.02)$$
  $$\mathbf{P}_{9,9} \leftarrow \max(10^{-8}, (1 - \alpha) \mathbf{P}_{9,9})$$

---

## 5. Dynamic Spatial Chunkization & Vectorized Map Matching

### Spatial Hash Cell Key:
$$c_x = \left\lfloor \frac{E}{S} \right\rfloor, \quad c_y = \left\lfloor \frac{N}{S} \right\rfloor \quad (S = 500.0\text{ m})$$

### Vectorized Orthogonal Segment Projection:
For each segment with start $\mathbf{a}_i$, end $\mathbf{b}_i$, and difference $\mathbf{d}_i = \mathbf{b}_i - \mathbf{a}_i$:
$$u_i = \text{clip}\left( \frac{(\mathbf{p} - \mathbf{a}_i) \cdot \mathbf{d}_i}{\|\mathbf{d}_i\|^2}, 0.0, 1.0 \right)$$
$$\mathbf{p}_{\text{closest}, i} = \mathbf{a}_i + u_i \mathbf{d}_i$$
$$d_{\text{perp}, i} = \| \mathbf{p} - \mathbf{p}_{\text{closest}, i} \|$$
$$\Delta\psi_i = \text{wrap\_angle}(\psi_{\text{veh}} - \psi_{\text{road}, i})$$

### Mahalanobis Match Likelihood:
$$S_i = \left(\frac{d_{\text{perp}, i}}{\sigma_{\text{lane}}}\right)^2 + \left(\frac{\Delta\psi_i}{\sigma_\psi}\right)^2 \quad (\sigma_{\text{lane}} = 5.0\text{ m}, \sigma_\psi = 12^\circ)$$
$$P(\text{match}_i) = \exp\left( -0.5 \cdot S_i \right)$$

Candidate is accepted if $S_i \le 9.0$ ($3\sigma$ confidence ellipse, $P \ge 0.011$).

---

## 6. Anti-Glitch Service Lane & Multi-Level Elevation Gating

To ensure the vehicle never jumps into parallel frontage roads or overhead flyovers, the candidate score is augmented with physical barrier penalties:

$$S_{\text{total}, i} = S_{\text{base}, i} + S_{\text{level}, i} + S_{\text{service}, i} + S_{\text{continuity}, i}$$

### 1. Multi-Level Elevation Gating:
$$S_{\text{level}, i} = \begin{cases} 0.0 & \text{if } \text{layer}_i = \text{current\_layer} \\ +80.0 & \text{if } \text{layer}_i \neq \text{current\_layer} \text{ and } |\theta_{\text{pitch}}| \le 3^\circ \end{cases}$$

### 2. Anti-Service-Lane Separation:
When vehicle is on main highway and candidate $i$ is a service lane:
$$S_{\text{service}, i} = \underbrace{\left(\frac{\max(0, v_{\text{km/h}} - 40)}{3.0}\right)^2}_{\text{Kinematic Speed Penalty}} + \underbrace{35.0}_{\text{Crash Barrier Jump Barrier}}$$

### 3. Markov Topological Continuity:
$$S_{\text{continuity}, i} = \begin{cases} -2.0 & \text{if candidate } i \text{ extends current track } \mathbf{x}_{\text{track}} \\ 0.0 & \text{otherwise} \end{cases}$$

---

## 7. 95% Bayesian Off-Road Departure Detector

When a driver steers off the road network into an open field, parking lot, or driveway:

### Likelihood & Evidence Streak:
If no valid candidate satisfies $S \le 9.0$:
$$\text{streak} \leftarrow \text{streak} + 1$$
$$P_{\text{off-road}} = 1.0 - \exp(-0.22 \cdot \text{streak})$$

* For $\text{streak} \le 13$ steps ($< 1.3\text{ s}$): $P_{\text{off-road}} < 0.95$. Road lock is maintained; vehicle is clamped to road boundary to reject noise.
* At $\text{streak} = 14$ steps ($1.4\text{ s}$ of persistent outward driving):
  $$P_{\text{off-road}} = 1.0 - \exp(-0.22 \times 14) = 1.0 - \exp(-3.08) = 0.954 \ge 95.0\%$$
  **Road constraint is released 100%.** Vehicle transitions to unconstrained inertial tracking.

---

## 8. WGS-84 Geodetic Projection Engine

Converts local tangent plane coordinates $(E, N)$ into geodetic Latitude ($\phi$) and Longitude ($\lambda$).

### WGS-84 Parameters:
* Semi-major axis: $a = 6,378,137.0\text{ m}$
* Flattening: $f = \frac{1}{298.257223563}$
* Eccentricity squared: $e^2 = 2f - f^2 \approx 0.00669437999014$

### Radii of Curvature at Latitude $\phi_0$:
$$R_N = \frac{a}{\sqrt{1 - e^2 \sin^2\phi_0}} \quad (\text{prime vertical radius})$$
$$R_M = \frac{a(1 - e^2)}{(1 - e^2 \sin^2\phi_0)^{3/2}} \quad (\text{meridian radius})$$

### Incremental Conversion:
$$\Delta\phi = \frac{N}{R_M + h_0}, \quad \Delta\lambda = \frac{E}{(R_N + h_0) \cos\phi_0}$$
$$\phi = \phi_0 + \Delta\phi \cdot \left(\frac{180^\circ}{\pi}\right), \quad \lambda = \lambda_0 + \Delta\lambda \cdot \left(\frac{180^\circ}{\pi}\right)$$

---

## 9. Reconvergence & Anti-Teleportation Exponential Blend

When GNSS signal returns after a blackout:
$$\Delta\mathbf{p}_{\text{offset}} = \mathbf{p}_{\text{IDR}}(t_{\text{restore}}) - \mathbf{p}_{\text{GNSS}}(t_{\text{restore}})$$

For $t \in [t_{\text{restore}}, t_{\text{restore}} + \tau_{\text{blend}}]$ with $\tau = 3.0\text{ s}$:
$$\mathbf{p}_{\text{display}}(t) = \mathbf{p}_{\text{GNSS}}(t) + \Delta\mathbf{p}_{\text{offset}} \cdot \exp\left(-\frac{t - t_{\text{restore}}}{\tau}\right)$$

At $t = t_{\text{restore}} + 3.0\text{ s}$, $\exp(-1) \to 0$, achieving smooth $C^1$ trajectory convergence with zero visual jumping.
