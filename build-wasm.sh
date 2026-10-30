#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="${SIMC_SOURCE_DIR:-${script_dir}/.build/simc}"
revision="$(node -p "require('${script_dir}/runtime.json').simcRevision")"
output_dir="${script_dir}/dist"
embedded_profiles_dir="${script_dir}/.build/embedded-profiles"
export EM_CACHE="${script_dir}/.build/emscripten-cache"

if ! command -v em++ >/dev/null 2>&1; then
  echo 'em++ is required. Activate an Emscripten SDK before running this script.'
  exit 1
fi

if [[ ! -f "${source_dir}/engine/simulationcraft.hpp" ]]; then
  mkdir -p "${source_dir}"
  git -C "${source_dir}" init
  git -C "${source_dir}" remote add origin \
    https://github.com/simulationcraft/simc.git
fi

if [[ -d "${source_dir}/.git" ]]; then
  if ! git -C "${source_dir}" cat-file -e "${revision}^{commit}"; then
    git -C "${source_dir}" fetch origin "${revision}" --depth 1
  fi

  git -C "${source_dir}" checkout --detach "${revision}"
  git -C "${source_dir}" restore .
fi
git -C "${source_dir}" apply \
  "${script_dir}/patches/0001-add-bounded-event-execution.patch"
git -C "${source_dir}" apply \
  "${script_dir}/patches/0002-fix-no-threading-report-build.patch"
git -C "${source_dir}" apply \
  "${script_dir}/patches/0003-allow-hero-talent-override.patch"
git -C "${source_dir}" apply \
  "${script_dir}/patches/0004-expose-rune-progress-expressions.patch"
git -C "${source_dir}" apply \
  "${script_dir}/patches/0005-consume-warrior-opening-charge.patch"

cp "${script_dir}/bridge/hoggertype_bridge.cpp" \
  "${source_dir}/engine/sc_main.cpp"

mkdir -p "${EM_CACHE}" "${embedded_profiles_dir}" "${output_dir}"

copy_profile() {
  cp "$1" "${embedded_profiles_dir}/$2"
}

copy_profile "${source_dir}/profiles/MID2/MID2_Death_Knight_Frost.simc" "death-knight-frost.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Death_Knight_Unholy.simc" "death-knight-unholy.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Demon_Hunter_Devourer.simc" "demon-hunter-devourer.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Demon_Hunter_Havoc.simc" "demon-hunter-havoc.simc"
printf '\nactions+=/fel_rush\n' >> \
  "${embedded_profiles_dir}/demon-hunter-havoc.simc"
copy_profile "${source_dir}/profiles/MID1/MID1_Druid_Balance.simc" "druid-balance.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Druid_Feral.simc" "druid-feral.simc"
copy_profile "${script_dir}/profiles/evoker-augmentation-chronowarden.simc" "evoker-augmentation-chronowarden.simc"
copy_profile "${script_dir}/profiles/evoker-augmentation-scalecommander.simc" "evoker-augmentation-scalecommander.simc"
copy_profile "${source_dir}/profiles/MID1/MID1_Evoker_Devastation.simc" "evoker-devastation.simc"
copy_profile "${source_dir}/profiles/MID1/MID1_Evoker_Devastation_FS.simc" "evoker-devastation-flameshaper.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Hunter_Beast_Mastery.simc" "hunter-beast-mastery.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Hunter_Marksmanship.simc" "hunter-marksmanship.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Hunter_Survival.simc" "hunter-survival.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Mage_Arcane.simc" "mage-arcane.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Mage_Arcane_Sunfury.simc" "mage-arcane-sunfury.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Mage_Fire.simc" "mage-fire.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Mage_Fire_Frostfire.simc" "mage-fire-frostfire.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Mage_Frost.simc" "mage-frost.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Monk_Windwalker.simc" "monk-windwalker.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Paladin_Retribution.simc" "paladin-retribution.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Paladin_Retribution_Templar.simc" "paladin-retribution-templar.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Priest_Shadow.simc" "priest-shadow.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Priest_Shadow_Archon.simc" "priest-shadow-archon.simc"
copy_profile "${script_dir}/profiles/rogue-assassination.simc" "rogue-assassination.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Rogue_Outlaw.simc" "rogue-outlaw.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Rogue_Subtlety.simc" "rogue-subtlety.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Shaman_Elemental.simc" "shaman-elemental.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Shaman_Enhancement.simc" "shaman-enhancement.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Warlock_Affliction.simc" "warlock-affliction.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Warlock_Demonology.simc" "warlock-demonology.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Warlock_Destruction.simc" "warlock-destruction.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Warrior_Arms.simc" "warrior-arms.simc"
copy_profile "${source_dir}/profiles/MID2/MID2_Warrior_Fury.simc" "warrior-fury.simc"

make -C "${source_dir}/engine" mostlyclean \
  CXX=em++ \
  FLAVOR=WebAssembly \
  LINK_LIBS=

make -C "${source_dir}/engine" -j4 release \
  CXX=em++ \
  FLAVOR=WebAssembly \
  LINK_LIBS= \
  MODULE="${output_dir}/hoggertype-simc.mjs" \
  NO_DEBUG=1 \
  OPTS='-DSC_NO_THREADING -fexceptions' \
  SC_NO_NETWORKING=1 \
  LINK_FLAGS="-fexceptions -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=['ccall'] -sEXPORTED_FUNCTIONS=['_hoggertype_start','_hoggertype_advance_to','_hoggertype_cast','_hoggertype_get_metadata','_hoggertype_get_state','_hoggertype_reset'] --embed-file ${embedded_profiles_dir}@/profiles"

echo "Built ${output_dir}/hoggertype-simc.mjs and hoggertype-simc.wasm"

node "${script_dir}/stage.mjs"
