import sys
sys.path.insert(0, '.')
from src.data.iovnbd_loader import find_all_s_csvs, load_sequence, build_datasets

csvs = find_all_s_csvs()
print(f"Total sequences found: {len(csvs)}")
for p in csvs[:8]:
    driver = p.parent.parent.name.split()[0]
    seq    = p.parent.name
    print(f"  {driver}/{seq}  ->  {p.name}")

print()
print("Loading Driver A / S1...")
seq = load_sequence(csvs[0])
N = len(seq["time_ms"])
dur_s = seq["time_ms"][-1] / 1000.0
print(f"  Samples : {N}")
print(f"  Duration: {dur_s:.1f}s  ({dur_s/60:.1f} min)")
print(f"  Accel shape : {seq['accel'].shape}")
print(f"  Gyro  shape : {seq['gyro'].shape}")
spd = seq["gps_speed_ms"]
print(f"  GPS speed   : {spd.min():.2f} – {spd.max():.2f} m/s")
e = seq["pos_enu"]
print(f"  ENU E range : {e[:,0].min():.1f} – {e[:,0].max():.1f} m")
print(f"  ENU N range : {e[:,1].min():.1f} – {e[:,1].max():.1f} m")
total_dist = ((e[1:] - e[:-1])**2).sum(axis=1)**0.5
print(f"  Total dist  : {total_dist.sum()/1000:.2f} km")

print()
print("Building train/val split (this scans all sequences)...")
train_ds, val_ds = build_datasets(window=100, stride=20)
print(f"  Train windows : {len(train_ds)}")
print(f"  Val   windows : {len(val_ds)}")

b = train_ds[0]
print(f"  Sample IMU shape : {b['imu'].shape}")
print(f"  Sample speed     : {b['speed']:.3f} m/s")
print(f"  Sample delta_pos : {b['delta_pos']}")
print()
print("Dataset loader OK — ready to train.")
