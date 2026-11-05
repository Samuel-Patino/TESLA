"use strict";

/* =====================================================================
   Catálogo de Juegos · VELOX Drive
   Para agregar un juego, añade una entrada a esta lista.
   `colores` define el arte de la portada mientras no haya imagen propia.
   ===================================================================== */
(function (raiz) {
  const JUEGOS = Object.freeze([
    {
      id: 'geometry-dash',
      titulo: 'Geometry Dash',
      categoria: 'Ritmo',
      descripcion: 'Salta al ritmo de la música y esquiva obstáculos en niveles que no perdonan errores.',
      url: 'https://genizymath.github.io/iframe/868-F3.html',
      colores: ['#7c1fd1', '#16d6c4']
    },
    {
      id: 'halo-2',
      titulo: 'Halo 2',
      categoria: 'Disparos',
      descripcion: 'Combate de ciencia ficción en primera persona, directo desde el navegador.',
      url: 'https://www.halo2browser.com/',
      colores: ['#0f6b4f', '#7bd64f']
    },
    {
      id: 'halo-online',
      titulo: 'Halo Online',
      categoria: 'Disparos',
      descripcion: 'Versión web de Open Halo CE para jugar en primera persona.',
      url: 'https://openhaloce.com/',
      colores: ['#123d7a', '#39b6ff']
    },
    {
      id: 'counter-strike-16',
      titulo: 'Counter-Strike 1.6',
      categoria: 'Disparos',
      descripcion: 'El clásico de disparos por equipos, adaptado para jugarlo en el navegador.',
      url: 'https://csjs.live/',
      colores: ['#5a4a1f', '#e0a526']
    },
    {
      id: 'clover-pit',
      titulo: 'Clover Pit',
      categoria: 'Azar',
      descripcion: 'Tienta a la suerte en una máquina tragamonedas donde cada giro cuenta.',
      url: 'https://genizymath.github.io/iframe/716-fix3.html',
      colores: ['#14532d', '#a3e635']
    },
    {
      id: 'buckshot-roulette',
      titulo: 'Buckshot Roulette',
      categoria: 'Suspenso',
      descripcion: 'Un duelo de nervios y estrategia en el que cada turno puede ser el último.',
      url: 'https://genizymath.github.io/games/buckshot-roulette/',
      colores: ['#4c0d12', '#e23b3b']
    },
    {
      id: 'brotato',
      titulo: 'Brotato',
      categoria: 'Acción',
      descripcion: 'Oleadas de enemigos y mejoras sin parar. Es pesado: la primera carga puede tardar.',
      url: 'https://wasm.rip/files/bpac/index.html',
      colores: ['#7a3412', '#fb923c']
    },
    {
      id: 'portmaster',
      titulo: 'PortMaster',
      categoria: 'Catálogo',
      descripcion: 'Una página con más juegos para explorar y probar en el Tesla.',
      url: 'https://portmaster.base44.app/',
      colores: ['#1e2a78', '#818cf8']
    },
    {
      id: 'recompiled-games',
      titulo: 'Recompiled Games',
      categoria: 'Catálogo',
      descripcion: 'Una colección de juegos recompilados para jugar en el navegador.',
      url: 'https://recompiledgames.com/',
      colores: ['#0f4c5c', '#2dd4bf']
    }
  ].map(Object.freeze));

  function urlValida(texto) {
    try {
      return new URL(texto).protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  const api = Object.freeze({ JUEGOS, urlValida });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.VeloxJuegos = api;
})(typeof window !== 'undefined' ? window : globalThis);
