import assert from 'node:assert/strict';
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
      `hoggertype_${name}`,
      'string',
      payload === undefined ? [] : ['string'],
      payload === undefined ? [] : [JSON.stringify(payload)]
    )
  );

  assert.equal(response.ok, true, response.error);

  return response.result;
}

function start(specializationId, heroTalentId, seed = 42) {
  call('start', { specializationId, heroTalentId, seed, durationMs: 60000 });
}

function cast(spellId) {
  assert.equal(call('cast', { spellId }).status, 'executed', spellId);
}

for (const hero of ['sunfury', 'frostfire']) {
  let checkedPyroclasm = false;

  for (let seed = 1; seed <= 20 && !checkedPyroclasm; seed++) {
    start('mage.fire', hero, seed);
    cast('fire_blast');
    call('advance_to', { timeMs: 500 });
    cast('fire_blast');
    assert.ok(call('get_state').buffs.hot_streak, `${hero}: Hot Streak setup`);

    cast('pyroblast');
    let state = call('get_state');

    assert.equal(state.timeMs, 500, `${hero}: cast advanced the clock`);
    assert.equal(state.buffs.hot_streak, undefined, `${hero}: Hot Streak retained`);

    if (!state.buffs.pyroclasm || state.buffs.hyperthermia) {
      continue;
    }

    const stacks = state.buffs.pyroclasm.stacks;
    cast('pyroblast');
    state = call('get_state');
    assert.equal(state.timeMs, 500, `${hero}: hard cast was not immediate`);
    assert.equal(
      state.buffs.pyroclasm?.stacks ?? 0,
      stacks - 1,
      `${hero}: hard-cast Pyroblast retained Pyroclasm`
    );
    checkedPyroclasm = true;
  }

  assert.ok(checkedPyroclasm, `${hero}: no Pyroclasm consumption exercised`);
  console.log(`PASS mage.fire/${hero}: Hot Streak and Pyroclasm`);
}

for (const hero of ['soul_harvester', 'hellcaller']) {
  for (const consumer of ['shadow_bolt', 'malefic_grasp']) {
    start('warlock.affliction', hero);
    cast('agony');
    cast(hero === 'hellcaller' ? 'wither_direct' : 'corruption_direct');

    let checked = false;

    for (let timeMs = 500; timeMs < 50000; timeMs += 500) {
      call('advance_to', { timeMs });
      const before = call('get_state');

      if (!before.buffs.nightfall) {
        continue;
      }

      if (consumer === 'malefic_grasp') {
        cast('summon_darkglare');
      }

      const stacks = call('get_state').buffs.nightfall?.stacks ?? 0;
      assert.ok(stacks > 0, `${hero}: Nightfall setup lost`);
      cast(consumer);
      const after = call('get_state');

      assert.equal(after.timeMs, timeMs, `${hero}: ${consumer} advanced time`);
      assert.equal(
        after.buffs.nightfall?.stacks ?? 0,
        stacks - 1,
        `${hero}: ${consumer} retained Nightfall`
      );
      checked = true;
      break;
    }

    assert.ok(checked, `${hero}: no ${consumer} Nightfall consumption exercised`);
    console.log(`PASS warlock.affliction/${hero}: ${consumer} Nightfall`);
  }
}

for (const hero of ['diabolist', 'hellcaller']) {
  start('warlock.destruction', hero);
  cast('conflagrate');
  const before = call('get_state');

  assert.ok(before.buffs.backdraft, `${hero}: Backdraft setup`);
  cast('incinerate');
  const after = call('get_state');

  assert.equal(after.timeMs, before.timeMs, `${hero}: Incinerate delayed`);
  assert.equal(
    after.buffs.backdraft?.stacks ?? 0,
    before.buffs.backdraft.stacks - 1,
    `${hero}: Incinerate retained Backdraft`
  );
  console.log(`PASS warlock.destruction/${hero}: Backdraft`);
}

for (const hero of ['sentinel', 'dark_ranger']) {
  start('hunter.marksmanship', hero);
  const before = call('get_state');

  cast('aimed_shot');
  const after = call('get_state');

  assert.equal(after.timeMs, 0, `${hero}: Aimed Shot delayed`);
  assert.ok(
    after.resources.focus.current < before.resources.focus.current,
    `${hero}: Aimed Shot did not consume Focus immediately`
  );
  cast('rapid_fire');
  cast('steady_shot');
  assert.equal(call('get_state').timeMs, 0, `${hero}: ranged casts delayed`);
  call('advance_to', { timeMs: 3000 });
  console.log(`PASS hunter.marksmanship/${hero}: immediate ranged casts`);
}
