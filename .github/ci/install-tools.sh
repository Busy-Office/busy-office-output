#!/usr/bin/env bash
# Installs the three external binaries the corpus gates shell out to, on an
# Ubuntu runner (GAP-12, docs/STANDARDS.md rule 1: "no compliance claim
# without a validator passing in CI").
#
#   typst 0.15.1      — renderer (same tarball pattern as ./Dockerfile)
#   veraPDF 1.30.2    — PDF/A-2b validator (matches local Homebrew 1.30.x)
#   poppler-utils     — pdftotext for `bo-output diff` (apt; version logged)
#
# Idempotent; safe to re-run. Needs sudo unless already root.
set -euo pipefail

TYPST_VERSION="0.15.1"
VERAPDF_VERSION="1.30.2"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq --no-install-recommends \
  curl ca-certificates tar xz-utils unzip poppler-utils >/dev/null

# --- typst (pinned GitHub release tarball, arch-aware like the Dockerfile) ---
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "arm64" ]; then TYPST_ARCH=aarch64-unknown-linux-musl; else TYPST_ARCH=x86_64-unknown-linux-musl; fi
TMP=$(mktemp -d)
curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_ARCH}.tar.xz" -o "$TMP/typst.tar.xz"
tar -xJf "$TMP/typst.tar.xz" -C "$TMP"
$SUDO install -m 0755 "$TMP/typst-${TYPST_ARCH}/typst" /usr/local/bin/typst

# --- veraPDF (IzPack installer, unattended) ---
# A JRE is required; GitHub's ubuntu-latest image ships JDKs, a bare
# container does not — install one only when `java` is missing.
if ! command -v java >/dev/null 2>&1; then
  $SUDO apt-get install -y -qq --no-install-recommends default-jre-headless >/dev/null
fi
curl -fsSL "https://software.verapdf.org/releases/1.30/verapdf-greenfield-${VERAPDF_VERSION}-installer.zip" -o "$TMP/verapdf.zip"
unzip -q "$TMP/verapdf.zip" -d "$TMP/verapdf"
JAR=$(find "$TMP/verapdf" -name 'verapdf-izpack-installer-*.jar' | head -n1)
cat > "$TMP/verapdf-auto.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>/opt/verapdf</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Corpus" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
$SUDO java -jar "$JAR" "$TMP/verapdf-auto.xml" >/dev/null
$SUDO ln -sf /opt/verapdf/verapdf /usr/local/bin/verapdf
rm -rf "$TMP"

echo "== installed tool versions =="
typst --version
verapdf --version | head -n1
pdftotext -v 2>&1 | head -n1
java -version 2>&1 | head -n1
