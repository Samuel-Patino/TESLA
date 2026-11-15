"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { JUEGOS, DESCARTADOS, urlValida, indiceVertical, insigniasDe } = require('../js/juegos-data.js');

const buscar = id => JUEGOS.find(juego => juego.id === id);
const textosDe = id => insigniasDe(buscar(id)).map(insignia => insignia.texto);

test('el catálogo trae los 8 enlaces activos', () => {
  assert.equal(JUEGOS.length, 8);
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

test('ningún enlace descartado sigue en el catálogo', () => {
  const activos = new Set(JUEGOS.map(juego => juego.url));
  for (const descartado of DESCARTADOS) {
    assert.equal(activos.has(descartado.url), false, `${descartado.titulo} sigue activo`);
  }
});

test('el registro guarda los enlaces que ya fallaron', () => {
  const urls = DESCARTADOS.map(descartado => descartado.url);
  assert.ok(urls.includes('https://csjs.live/'));
  assert.ok(urls.includes('https://genizymath.github.io/games/buckshot-roulette/'));
  for (const descartado of DESCARTADOS) {
    assert.ok(descartado.resultado && descartado.fecha, `${descartado.titulo}: registro incompleto`);
  }
});

test('Clover Pit queda verificado y sin mando', () => {
  assert.deepEqual(textosDe('clover-pit'), ['Verificado', 'Sin mando']);
});

test('Brotato queda verificado, con mando y cooperativo', () => {
  assert.deepEqual(textosDe('brotato'), ['Verificado', 'Con mando', 'Coop 2 jugadores']);
});

test('un juego sin probar no muestra insignias', () => {
  assert.deepEqual(textosDe('guitar-hero-3'), []);
});

test('Halo 2 y Halo Online quedan verificados', () => {
  assert.deepEqual(textosDe('halo-2'), ['Verificado']);
  assert.deepEqual(textosDe('halo-online'), ['Verificado']);
});

test('los juegos marcados como Falla pasan a descartados', () => {
  const urls = DESCARTADOS.map(descartado => descartado.url);
  assert.ok(urls.includes('https://fifa14.online/'));
  assert.ok(urls.includes('https://genizymath.github.io/iframe/205-fix2.html'));
  assert.equal(DESCARTADOS.length, 9);
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
