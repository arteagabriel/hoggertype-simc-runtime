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
  const result = JSON.parse(
    runtime.ccall(
      `hoggertype_${name}`,
      'string',
      payload === undefined ? [] : ['string'],
      payload === undefined ? [] : [JSON.stringify(payload)]
    )
  );

  assert.equal(result.ok, true, result.error);

  return result.result;
}

for (const [spec, heroes] of [
  ['arms', ['slayer', 'colossus']],
  ['fury', ['slayer', 'mountain_thane']]
]) {
  for (const hero of heroes) {
    const label = `${spec}/${hero}`;
    const start = () =>
      call('start', {
        specializationId: `warrior.${spec}`,
        heroTalentId: hero,
        durationMs: 60000,
        seed: 42
      });

    start();
    const initial = call('get_state');

    assert.equal(
      initial.damage.total,
      0,
      `${label}: no swings before advancing`
    );
    assert.equal(
      initial.resources.rage.current,
      0,
      `${label}: Charge was not automatic`
    );
    assert.equal(
      initial.abilityReadiness.charge,
      true,
      `${label}: opener unavailable`
    );
    assert.ok(call('get_metadata').abilities.some((a) => a.id === 'charge'));

    call('advance_to', { timeMs: 10000 });
    const passive = call('get_state');

    assert.ok(passive.resources.rage.gained > 0, `${label}: no passive Rage`);
    assert.ok(passive.damage.total > 0, `${label}: no auto-attack damage`);
    assert.equal(
      passive.cooldowns.charge,
      0,
      `${label}: Charge activated itself`
    );

    start();
    assert.equal(call('cast', { spellId: 'charge' }).status, 'executed', label);
    assert.ok(
      call('get_state').resources.rage.current > 0,
      `${label}: Charge gave no Rage`
    );
    call('advance_to', { timeMs: 30000 });
    assert.equal(
      call('get_state').abilityReadiness.charge,
      false,
      `${label}: Charge reused at melee range`
    );

    if (spec === 'fury' && hero === 'mountain_thane') {
      start();
      const ids = call('get_metadata').abilities.map((ability) => ability.id);

      for (const id of ['avatar', 'thunder_clap', 'thunder_blast']) {
        assert.ok(ids.includes(id), `${label}: missing ${id}`);
      }

      assert.ok(!ids.includes('bladestorm'), `${label}: Slayer cooldown retained`);
      assert.equal(call('cast', { spellId: 'thunder_clap' }).status, 'executed');
      assert.equal(call('cast', { spellId: 'avatar' }).status, 'executed');
      const empowered = call('get_state');

      assert.ok(empowered.buffs.avatar, `${label}: Avatar buff missing`);
      assert.ok(empowered.buffs.thunder_blast, `${label}: empowerment missing`);
      assert.equal(empowered.abilityReadiness.thunder_clap, false);
      assert.equal(empowered.abilityReadiness.thunder_blast, true);
      assert.equal(call('cast', { spellId: 'thunder_blast' }).status, 'executed');
      const used = call('get_state');

      assert.ok(
        used.damage.total > empowered.damage.total,
        `${label}: no Blast damage`
      );
      assert.equal(
        used.buffs.thunder_blast?.stacks ?? 0,
        empowered.buffs.thunder_blast.stacks - 1,
        `${label}: empowerment not consumed`
      );
      assert.ok(
        used.cooldowns.thunder_clap > 0,
        `${label}: shared cooldown missing`
      );
      assert.equal(used.cooldowns.thunder_clap, used.cooldowns.thunder_blast);

      console.log(
        `${label}: Clap, Avatar, Blast damage and shared cooldown passed.`
      );
    }

    if (spec === 'arms') {
      start();
      call('cast', { spellId: 'charge' });
      assert.equal(call('cast', { spellId: 'rend' }).status, 'executed', label);
      const applied = call('get_state');
      const duration = applied.dots.rend;

      assert.ok(duration > 0, `${label}: Rend duration missing`);
      assert.equal(
        applied.refreshableDots.rend,
        false,
        `${label}: new Rend refreshable`
      );
      call('advance_to', { timeMs: Math.ceil(duration * 0.8) });
      const refresh = call('get_state');
      assert.ok(refresh.dots.rend > 0 && refresh.dots.rend < duration, label);
      assert.equal(
        refresh.refreshableDots.rend,
        true,
        `${label}: missing Pandemic window`
      );
      call('advance_to', { timeMs: duration + 1000 });
      assert.equal(
        call('get_state').dots.rend,
        0,
        `${label}: Rend did not expire`
      );

      start();
      call('advance_to', { timeMs: 10000 });

      if (call('get_state').abilityReadiness.cleave) {
        assert.equal(
          call('cast', { spellId: 'cleave' }).status,
          'executed',
          label
        );
        assert.ok(
          call('get_state').dots.rend > 0,
          `${label}: Cleave-applied Rend missing`
        );
      }
    }

    console.log(
      `${label}: passive Rage, manual Charge and applicable Rend checks passed.`
    );
  }
}
