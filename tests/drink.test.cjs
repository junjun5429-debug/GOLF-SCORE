'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const members = ['A', 'B', 'C', 'D'];
const context = vm.createContext({
  members,
  window: { ScorebookDatabase: { create: () => ({}) } },
  document: { addEventListener() {} },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context);
vm.runInContext('state = { members }', context);

const amounts = ({ result }) => members.map((m) => {
  const { share, advance, balance } = result[m];
  return [share, advance, balance];
});

test('keeps legacy drink splits without advances', () => {
  const drink = context.computeDrink({ drink: { total: 30000, nearpinLosers: ['C', 'D'] } });
  assert.deepEqual(amounts(drink), [
    [6500, 0, -6500],
    [6500, 0, -6500],
    [8500, 0, -8500],
    [8500, 0, -8500],
  ]);
});

test('credits each advance and balances receipts and payments for a paid bill', () => {
  const drink = context.computeDrink({
    drink: { total: 30000, nearpinLosers: ['C', 'D'], advances: { A: 18000, B: 12000 } },
  });
  assert.deepEqual(amounts(drink), [
    [6500, 18000, 11500],
    [6500, 12000, 5500],
    [8500, 0, -8500],
    [8500, 0, -8500],
  ]);
  assert.equal(drink.advanceTotal, drink.total);
});

test('allocates odd yen and keeps the balance equal to the unpaid portion', () => {
  const drink = context.computeDrink({
    drink: { total: 10003, nearpinLosers: ['C'], advances: { A: 4000, D: 2000 } },
  });
  assert.deepEqual(amounts(drink), [
    [2001, 4000, 1999],
    [2001, 0, -2001],
    [4001, 0, -4001],
    [2000, 2000, 0],
  ]);
  assert.equal(amounts(drink).reduce((sum, [, , balance]) => sum + balance, 0), -4003);
});
