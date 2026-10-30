// SPDX-License-Identifier: GPL-3.0-only
const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
  type: 'module'
});
const form = document.querySelector('#command');
const method = document.querySelector('#method');
const payload = document.querySelector('#payload');
const output = document.querySelector('#output');
let nextId = 1;

const examples = {
  start: {
    specializationId: 'rogue.assassination',
    heroTalentId: 'deathstalker',
    durationMs: 60000,
    seed: 42
  },
  cast: { spellId: 'mutilate' },
  advanceTo: { timeMs: 1000 }
};

method.addEventListener('change', () => {
  payload.value = examples[method.value]
    ? JSON.stringify(examples[method.value], null, 2)
    : '';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();

  try {
    worker.postMessage({
      id: nextId++,
      method: method.value,
      payload: payload.value.trim() ? JSON.parse(payload.value) : undefined
    });
    output.textContent = 'Running…';
  } catch (error) {
    output.textContent = error.message;
  }
});

worker.onmessage = ({ data }) => {
  output.textContent = JSON.stringify(data, null, 2);
};
worker.onerror = (error) => {
  output.textContent = error.message || 'Runtime worker failed.';
};
