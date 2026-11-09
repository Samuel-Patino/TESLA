"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { cifrar, descifrar } = require('../js/jarvis-cifrado.js');
const { CANDADO_JARVIS } = require('../js/jarvis-candado.js');

const ITERACIONES_PRUEBA = 1000;

test('descifra el texto con la clave correcta', async () => {
  const candado = await cifrar('https://ejemplo.com/', '000000', ITERACIONES_PRUEBA);
  assert.equal(await descifrar(candado, '000000'), 'https://ejemplo.com/');
});

test('rechaza una clave incorrecta', async () => {
  const candado = await cifrar('https://ejemplo.com/', '000000', ITERACIONES_PRUEBA);
  await assert.rejects(descifrar(candado, '111111'));
});

test('cada cifrado usa sal e iv distintos', async () => {
  const a = await cifrar('https://ejemplo.com/', '000000', ITERACIONES_PRUEBA);
  const b = await cifrar('https://ejemplo.com/', '000000', ITERACIONES_PRUEBA);
  assert.notEqual(a.sal, b.sal);
  assert.notEqual(a.iv, b.iv);
});

test('el candado publicado no deja ver el enlace ni la contraseña', () => {
  const texto = JSON.stringify(CANDADO_JARVIS);
  assert.ok(!texto.includes('vercel'), 'el enlace no debe ir en claro');
  assert.ok(CANDADO_JARVIS.iteraciones >= 600000);
});
