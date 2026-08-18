import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COPY,
  DEFAULT_BOUNDS,
  boundsOf,
  emptyFilters,
  filterPlaces,
  formatScore,
  markerState,
  parseFilters,
  serializeFilters,
  sortPlaces
} from '../map-logic.js';

const PLACES = [
  {
    id: 'the-curd-shack-cedarburg',
    name: 'The Curd Shack',
    city: 'Cedarburg',
    county: 'Ozaukee',
    lat: 43.29650,
    lng: -87.98740,
    order: 'Beer-battered white cheddar, ranch on the side',
    price: '$$'
  },
  {
    id: 'golden-basket-milwaukee',
    name: 'Golden Basket Tavern',
    city: 'Milwaukee',
    county: 'Milwaukee',
    lat: 43.03890,
    lng: -87.90650,
    order: 'Plain curds, no batter, salt only',
    price: '$'
  },
  {
    id: 'fry-daddys-waukesha',
    name: "Fry Daddy's",
    city: 'Waukesha',
    county: 'Waukesha',
    lat: 43.01170,
    lng: -88.23150,
    order: 'Garlic-dill curds with a maple aioli',
    price: '$$$'
  }
];

// 1
test('filterPlaces — empty query returns everything', () => {
  assert.deepEqual(filterPlaces(PLACES, emptyFilters()), PLACES);
  assert.deepEqual(filterPlaces(PLACES, {}), PLACES);
  assert.equal(filterPlaces(PLACES, { q: '   ' }).length, PLACES.length);
});

// 2
test('filterPlaces — query matches name, city, and order, case-insensitive', () => {
  const byName = filterPlaces(PLACES, { q: 'cURD sHACK' });
  assert.deepEqual(byName.map((p) => p.id), ['the-curd-shack-cedarburg']);

  const byCity = filterPlaces(PLACES, { q: 'waukesha' });
  assert.deepEqual(byCity.map((p) => p.id), ['fry-daddys-waukesha']);

  const byOrder = filterPlaces(PLACES, { q: 'MAPLE AIOLI' });
  assert.deepEqual(byOrder.map((p) => p.id), ['fry-daddys-waukesha']);
});

// 3
test('filterPlaces — price and county apply together as AND, not OR', () => {
  // Both true for one record.
  const both = filterPlaces(PLACES, { price: '$$', county: 'Ozaukee' });
  assert.deepEqual(both.map((p) => p.id), ['the-curd-shack-cedarburg']);

  // Price true, county false. OR would have returned rows here.
  const mismatch = filterPlaces(PLACES, { price: '$$', county: 'Milwaukee' });
  assert.deepEqual(mismatch, []);

  // County true, price false. Same test from the other side.
  const otherMismatch = filterPlaces(PLACES, { price: '$$$', county: 'Milwaukee' });
  assert.deepEqual(otherMismatch, []);
});

// 4
test('filterPlaces — no match returns an empty array, never null', () => {
  const result = filterPlaces(PLACES, { q: 'poutine' });
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
  assert.notEqual(result, null);
});

// 5
test('parseFilters / serializeFilters — round-trip a filter object unchanged', () => {
  const filters = { q: 'beer-battered', price: '$$', county: 'Ozaukee' };
  assert.deepEqual(parseFilters(serializeFilters(filters)), filters);

  const partial = { q: '', price: '$', county: 'Milwaukee' };
  assert.deepEqual(parseFilters(serializeFilters(partial)), partial);

  const blank = emptyFilters();
  assert.equal(serializeFilters(blank), '');
  assert.deepEqual(parseFilters(serializeFilters(blank)), blank);

  // Values needing encoding survive the trip.
  const spaced = { q: 'garlic dill & ranch', price: '', county: 'St. Croix' };
  assert.deepEqual(parseFilters(serializeFilters(spaced)), spaced);
});

// 6
test('parseFilters — junk and unknown params are dropped, not thrown on', () => {
  assert.deepEqual(
    parseFilters('?q=curds&utm_source=twitter&sort=score&price=%F0%9F%A7%80'),
    { q: 'curds', price: '', county: '' }
  );

  assert.deepEqual(parseFilters(''), emptyFilters());
  assert.deepEqual(parseFilters('?'), emptyFilters());
  assert.deepEqual(parseFilters(undefined), emptyFilters());
  assert.deepEqual(parseFilters(null), emptyFilters());
  assert.deepEqual(parseFilters('%%%&&=='), emptyFilters());
  assert.deepEqual(parseFilters('?price=$$$$'), emptyFilters());
});

// 7
test('boundsOf — correct min and max for a normal set', () => {
  assert.deepEqual(boundsOf(PLACES), {
    south: 43.01170,
    west: -88.23150,
    north: 43.29650,
    east: -87.90650
  });
});

// 8
test('boundsOf — single place returns a valid box, not a zero-area point', () => {
  const box = boundsOf([PLACES[0]]);
  assert.ok(box.north > box.south, 'box has height');
  assert.ok(box.east > box.west, 'box has width');
  assert.ok(box.south < PLACES[0].lat && PLACES[0].lat < box.north);
  assert.ok(box.west < PLACES[0].lng && PLACES[0].lng < box.east);
});

// 9
test('boundsOf — empty array returns the default metro bounds', () => {
  assert.deepEqual(boundsOf([]), DEFAULT_BOUNDS);
  assert.deepEqual(boundsOf(undefined), DEFAULT_BOUNDS);
  assert.deepEqual(boundsOf([{ id: 'no-coords' }]), DEFAULT_BOUNDS);
});

// 10
test('formatScore — 4.25 renders as 4.2, count is pluralized', () => {
  assert.equal(formatScore({ avg: 4.25, count: 37 }), '4.2 · 37 scores');
  assert.equal(formatScore({ avg: 5, count: 3 }), '5.0 · 3 scores');
  assert.equal(formatScore({ avg: 3.999, count: 12 }), '3.9 · 12 scores');
  // Floats that arrive a hair under their true value still read cleanly.
  assert.equal(formatScore({ avg: 4.199999999999999, count: 8 }), '4.2 · 8 scores');
});

// 11
test('formatScore — count under 3 returns the "too few scores" string', () => {
  assert.equal(formatScore({ avg: 5, count: 2 }), COPY.tooFewScores);
  assert.equal(formatScore({ avg: 5, count: 1 }), COPY.tooFewScores);
  assert.equal(formatScore({ avg: 0, count: 0 }), COPY.tooFewScores);
});

// 12
test('formatScore — missing score entry does not throw', () => {
  assert.equal(formatScore(undefined), COPY.tooFewScores);
  assert.equal(formatScore(null), COPY.tooFewScores);
  assert.equal(formatScore({}), COPY.tooFewScores);
  assert.equal(formatScore({ avg: null, count: 40 }), COPY.tooFewScores);
  assert.equal(formatScore('4.2'), COPY.tooFewScores);
});

// 13
test('markerState — selected beats hovered beats default', () => {
  const id = 'the-curd-shack-cedarburg';

  assert.equal(markerState(id, { selectedId: id, hoveredId: id }), 'selected');
  assert.equal(markerState(id, { selectedId: id, hoveredId: 'other' }), 'selected');
  assert.equal(markerState(id, { selectedId: 'other', hoveredId: id }), 'hovered');
  assert.equal(markerState(id, { selectedId: 'other', hoveredId: 'other' }), 'default');
  assert.equal(markerState(id, {}), 'default');
  assert.equal(markerState(id), 'default');
  assert.equal(markerState(undefined, { selectedId: undefined }), 'default');
});

// 14
test('sortPlaces — stable order for equal scores', () => {
  const scores = {
    'the-curd-shack-cedarburg': { avg: 4.2, count: 10 },
    'golden-basket-milwaukee': { avg: 4.2, count: 10 },
    'fry-daddys-waukesha': { avg: 4.2, count: 10 }
  };

  const sorted = sortPlaces(PLACES, scores);
  assert.deepEqual(sorted.map((p) => p.id), PLACES.map((p) => p.id));

  // Same again with the input order reversed: ties still follow input order.
  const reversed = sortPlaces([...PLACES].reverse(), scores);
  assert.deepEqual(reversed.map((p) => p.id), [...PLACES].reverse().map((p) => p.id));

  // Unrated and thin-sample places sort last, and hold their order among themselves.
  const mixed = sortPlaces(PLACES, {
    'golden-basket-milwaukee': { avg: 4.8, count: 20 },
    'the-curd-shack-cedarburg': { avg: 5, count: 2 }
  });
  assert.deepEqual(mixed.map((p) => p.id), [
    'golden-basket-milwaukee',
    'the-curd-shack-cedarburg',
    'fry-daddys-waukesha'
  ]);

  // The input array is not mutated.
  assert.equal(PLACES[0].id, 'the-curd-shack-cedarburg');
});
