import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import createModule from './dist/hoggertype-simc.mjs';

const runtime = await createModule({
  locateFile: (file) =>
    fileURLToPath(new URL(`./dist/${file}`, import.meta.url)),
  print: () => {},
  printErr: () => {}
});

function call(name, payload) {
  const response = JSON.parse(
    runtime.ccall(
      name,
      'string',
      payload === undefined ? [] : ['string'],
      payload === undefined ? [] : [JSON.stringify(payload)]
    )
  );

  assert.equal(response.ok, true, response.error);

  return response.result;
}

const source = readFileSync(
  new URL('./bridge/hoggertype_bridge.cpp', import.meta.url),
  'utf8'
);
const specs = source.matchAll(
  /specialization_t\{ "([^"]+)", "[^"]+", "([^"]+)", "([^"]+)" \}/g
);
let checked = 0;

for (const [, specializationId, ...heroes] of specs) {
  for (const heroTalentId of heroes) {
    const label = `${specializationId}/${heroTalentId}`;

    call('hoggertype_start', {
      durationMs: 60000,
      seed: 42,
      specializationId,
      heroTalentId
    });

    const state = call('hoggertype_get_state');
    const metadata = call('hoggertype_get_metadata');

    assert.equal(
      state.targetHealthPercent,
      100,
      `${label}: initial target health`
    );

    for (const ability of metadata.abilities) {
      assert.equal(
        typeof state.abilityReadiness?.[ability.id],
        'boolean',
        `${label}: missing readiness for ${ability.id}`
      );
    }

    if (specializationId === 'demon-hunter.devourer') {
      assert.equal(state.abilityReadiness.metamorphosis, false, label);
      assert.equal(state.abilityReadiness.collapsing_star, false, label);
      assert.equal(
        call('hoggertype_cast', { spellId: 'metamorphosis' }).status,
        'rejected',
        `${label}: Meta bypassed collected-soul requirement`
      );
      call('hoggertype_cast', { spellId: 'soul_immolation' });
      assert.ok(
        call('hoggertype_get_state').dots.soul_immolation > 0,
        `${label}: missing self-effect duration`
      );
    }

    // Permanent pets can attack as soon as combat begins.
    const hasPermanentPet = /^(hunter|warlock|death-knight)\./.test(
      specializationId
    );

    if (!hasPermanentPet) {
      assert.equal(state.damage.total, 0, `${label}: damage before input`);
    }

    const setupCooldowns = new Set([
      'prowl',
      'stealth',
      'summon_pet',
      'summon_water_elemental',
      'raise_dead',
      'grimoire_of_sacrifice'
    ]);

    for (const [abilityId, remaining] of Object.entries(state.cooldowns)) {
      if (!setupCooldowns.has(abilityId)) {
        assert.equal(remaining, 0, `${label}: ${abilityId} used before input`);
      }
    }

    if (specializationId === 'mage.arcane') {
      assert.equal(state.abilityReadiness.arcane_missiles, false, label);
      assert.equal(state.abilityReadiness.prismatic_bolt, false, label);
      assert.equal(
        state.resources.mana.current,
        state.resources.mana.max,
        `${label}: mana spent before input`
      );
      assert.equal(state.buffs.arcane_surge, undefined, label);
      assert.equal(state.cooldowns.arcane_surge, 0, label);

      call('hoggertype_cast', { spellId: 'arcane_missiles' });
      call('hoggertype_advance_to', { timeMs: 3000 });

      assert.equal(
        call('hoggertype_get_state').buffs.arcane_surge,
        undefined,
        `${label}: Missiles activated Surge`
      );
    }

    call('hoggertype_advance_to', { timeMs: 30000 });
    assert.equal(
      call('hoggertype_get_state').targetHealthPercent,
      50,
      `${label}: target health at halfway`
    );

    checked++;
  }
}

assert.equal(checked, 54);
console.log(`Startup checks passed for ${checked} spec/hero combinations.`);
