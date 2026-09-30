import os
import sys
import zipfile
import subprocess
import shutil

ROOT_DIR = r"d:\SIH prototype"
SRC_APK = os.path.join(ROOT_DIR, "Navisense_SIH_Vehicle_App_STANDALONE.apk")
BUNDLE_FILE = os.path.join(ROOT_DIR, "Navisense Application", "android", "app", "src", "main", "assets", "index.android.bundle")
KEYSTORE = os.path.join(ROOT_DIR, "Navisense Application", "android", "app", "debug.keystore")
ZIPALIGN = r"C:\Users\Admin\AppData\Local\Android\Sdk\build-tools\35.0.0\zipalign.exe"
APKSIGNER = r"C:\Users\Admin\AppData\Local\Android\Sdk\build-tools\35.0.0\apksigner.bat"

UNALIGNED_APK = os.path.join(ROOT_DIR, "temp_unaligned.apk")
ALIGNED_APK = os.path.join(ROOT_DIR, "temp_aligned.apk")

print(f"Reading new bundle from: {BUNDLE_FILE} ({os.path.getsize(BUNDLE_FILE)} bytes)")
with open(BUNDLE_FILE, "rb") as f:
    new_bundle_data = f.read()

print(f"Opening source APK: {SRC_APK}")
with zipfile.ZipFile(SRC_APK, "r") as zin:
    with zipfile.ZipFile(UNALIGNED_APK, "w") as zout:
        for item in zin.infolist():
            # Skip META-INF signature files so we can sign cleanly
            if item.filename.startswith("META-INF/"):
                continue
            if item.filename == "assets/index.android.bundle":
                print("Replacing assets/index.android.bundle...")
                # Write with normal compression
                zout.writestr(item, new_bundle_data, compress_type=zipfile.ZIP_DEFLATED)
            else:
                data = zin.read(item.filename)
                zout.writestr(item, data, compress_type=item.compress_type)

print("Running zipalign...")
subprocess.run([ZIPALIGN, "-p", "-f", "4", UNALIGNED_APK, ALIGNED_APK], check=True)

print("Signing APK with apksigner...")
subprocess.run([
    APKSIGNER, "sign",
    "--ks", KEYSTORE,
    "--ks-pass", "pass:android",
    "--key-pass", "pass:android",
    "--ks-key-alias", "androiddebugkey",
    ALIGNED_APK
], check=True)

print("Verifying APK signature...")
verify_proc = subprocess.run([APKSIGNER, "verify", "--verbose", ALIGNED_APK], capture_output=True, text=True)
print(verify_proc.stdout)
if verify_proc.returncode != 0:
    print(verify_proc.stderr)
    sys.exit(1)

# Copy to final destinations
target_standalone = os.path.join(ROOT_DIR, "Navisense_SIH_Vehicle_App_STANDALONE.apk")
target_standard = os.path.join(ROOT_DIR, "Navisense_SIH_Vehicle_App.apk")

shutil.copyfile(ALIGNED_APK, target_standalone)
shutil.copyfile(ALIGNED_APK, target_standard)

# Cleanup
if os.path.exists(UNALIGNED_APK):
    os.remove(UNALIGNED_APK)
if os.path.exists(ALIGNED_APK):
    os.remove(ALIGNED_APK)

print(f"SUCCESS: Updated {target_standalone} and {target_standard}")
