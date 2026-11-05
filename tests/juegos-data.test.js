"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { JUEGOS, urlValida, indiceVertical } = require('../js/juegos-data.js');

test('el catálogo trae los 9 enlaces entregados', () => {
  assert.equal(JUEGOS.length, 9);
});

test('cada entrada tiene los campos que necesita el menú', () => {
  for (const juego of JUEGOS) {
    for (const campo of ['id', 'titulo', 'categoria', 'descripcion', 'url']) {
      assert.ok(juego[campo], `${juego.id || juego.titulo}: falta ${campo}`);
    }
    assert.equal(juego.colores.length, 2, `${juego.id}: necesita dos colores`);
  }
});

test('los identificadores no se repiten', () => {
  const ids = JUEGOS.map(juego => juego.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('todas las URL del catálogo son https', () => {
  for (const juego of JUEGOS) {
    assert.ok(urlValida(juego.url), `${juego.id}: URL inválida`);
  }
});

test('urlValida rechaza esquemas peligrosos o texto suelto', () => {
  assert.equal(urlValida('javascript:alert(1)'), false);
  assert.equal(urlValida('http://ejemplo.com'), false);
  assert.equal(urlValida('no es una url'), false);
});

test('el enlace de Buckshot Roulette no lleva la /o que da error 404', () => {
  const buckshot = JUEGOS.find(juego => juego.id === 'buckshot-roulette');
  assert.equal(buckshot.url, 'https://genizymath.github.io/games/buckshot-roulette/');
});

test('indiceVertical baja una fila en la biblioteca', () => {
  assert.equal(indiceVertical(1, 4, 9, 1), 5);
});

test('indiceVertical baja al último juego si la fila inferior es más corta', () => {
  assert.equal(indiceVertical(7, 4, 9, 1), 8);
});

test('indiceVertical devuelve null al salir por arriba o por abajo', () => {
  assert.equal(indiceVertical(2, 4, 9, -1), null);
  assert.equal(indiceVertical(8, 4, 9, 1), null);
});
