"use strict";

/* =====================================================================
   Catálogo de Juegos · MENÚ
   Para agregar un juego, añade una entrada a JUEGOS.

   - `colores`: arte de la portada mientras no haya imagen propia.
   - `verificado`: el usuario confirmó que funciona en su Tesla.
   - `mando`: true si funciona con mando, false si no lo detecta.
   - `coop`: se puede jugar con dos mandos.
   - `pendiente`: qué falta probar con ese enlace.

   Un enlace que falla sale de JUEGOS y pasa a DESCARTADOS, para recordar
   que ya se probó y no volver a agregarlo por error.
   ===================================================================== */
(function (raiz) {
  const JUEGOS = Object.freeze([
    {
      id: 'brotato',
      titulo: 'Brotato',
      categoria: 'Acción',
      descripcion: 'Oleadas de enemigos y mejoras sin parar, solo o en cooperativo con dos mandos.',
      url: 'https://wasm.rip/files/bpac/index.html',
      colores: ['#7a3412', '#fb923c'],
      verificado: true,
      mando: true,
      coop: true
    },
    {
      id: 'clover-pit',
      titulo: 'Clover Pit',
      categoria: 'Azar',
      descripcion: 'Tienta a la suerte en una máquina tragamonedas donde cada giro cuenta.',
      url: 'https://genizymath.github.io/iframe/716-fix3.html',
      colores: ['#14532d', '#a3e635'],
      verificado: true,
      mando: false
    },
    {
      id: 'clover-pit-2',
      titulo: 'Clover Pit · Enlace 2',
      categoria: 'Azar',
      descripcion: 'Segundo enlace de Clover Pit, para comprobar si este sí detecta el mando.',
      url: 'https://genizymath.github.io/games/clover-pit/',
      colores: ['#14532d', '#4ade80'],
      pendiente: 'Probar mando'
    },
    {
      id: 'buckshot-roulette-2',
      titulo: 'Buckshot Roulette · Enlace 2',
      categoria: 'Suspenso',
      descripcion: 'Segundo enlace de Buckshot Roulette, para comprobar si carga y detecta el mando.',
      url: 'https://genizymath.github.io/iframe/205-fix2.html',
      colores: ['#4c0d12', '#e23b3b'],
      pendiente: 'Probar carga y mando'
    },
    {
      id: 'fifa-14',
      titulo: 'FIFA 14',
      categoria: 'Deportes',
      descripcion: 'Fútbol en el navegador, con partidos rápidos para jugar desde el carro.',
      url: 'https://fifa14.online/',
      colores: ['#0b5d3b', '#34d399']
    },
    {
      id: 'gta-v',
      titulo: 'GTA V',
      categoria: 'Acción',
      descripcion: 'Mundo abierto en versión web. Por su tamaño, la carga puede ser exigente.',
      url: 'https://wasmarcade.com/gta-5',
      colores: ['#3f3a1c', '#d6b24c']
    },
    {
      id: 'black-ops-zombies',
      titulo: 'Black Ops Zombies',
      categoria: 'Disparos',
      descripcion: 'Sobrevive a oleadas de zombis en modo individual con armas clásicas.',
      url: 'https://vel.gg/bsz/kino?mode=single&guns=classic',
      colores: ['#2b2b33', '#b91c1c']
    },
    {
      id: 'halo-2',
      titulo: 'Halo 2',
      categoria: 'Disparos',
      descripcion: 'Combate de ciencia ficción en primera persona, directo desde el navegador.',
      url: 'https://www.halo2browser.com/',
      colores: ['#0f6b4f', '#7bd64f'],
      pendiente: 'Confirmar resultado'
    },
    {
      id: 'halo-online',
      titulo: 'Halo Online',
      categoria: 'Disparos',
      descripcion: 'Versión web de Open Halo CE para jugar en primera persona.',
      url: 'https://openhaloce.com/',
      colores: ['#123d7a', '#39b6ff'],
      pendiente: 'Confirmar resultado'
    },
    {
      id: 'geometry-dash',
      titulo: 'Geometry Dash',
      categoria: 'Ritmo',
      descripcion: 'Salta al ritmo de la música y esquiva obstáculos en niveles que no perdonan errores.',
      url: 'https://genizymath.github.io/iframe/868-F3.html',
      colores: ['#7c1fd1', '#16d6c4']
    },
    {
      id: 'gn-math',
      titulo: 'GN-Math',
      categoria: 'Catálogo',
      descripcion: 'La página principal con más juegos para explorar y probar en el Tesla.',
      url: 'https://genizymath.github.io/index.html',
      colores: ['#312e81', '#a78bfa']
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
    },
    {
      id: 'catalogo-web-ports',
      titulo: 'Catálogo de Web Ports',
      categoria: 'Catálogo',
      descripcion: 'Lista de cerca de 960 juegos para navegador. Muchos piden tus propios archivos del juego.',
      url: 'https://github.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports',
      colores: ['#1f2937', '#94a3b8']
    }
  ].map(Object.freeze));

  // Enlaces probados en el Tesla que no funcionaron. No volver a agregarlos.
  const DESCARTADOS = Object.freeze([
    {
      titulo: 'Counter-Strike 1.6',
      url: 'https://csjs.live/',
      resultado: 'No funcionó en el Tesla.',
      fecha: '2026-11-05'
    },
    {
      titulo: 'Buckshot Roulette · Enlace 1',
      url: 'https://genizymath.github.io/games/buckshot-roulette/',
      resultado: 'Falló en el Tesla: se reportó que no carga y también que no detecta el mando.',
      fecha: '2026-11-05'
    }
  ].map(Object.freeze));

  function urlValida(texto) {
    try {
      return new URL(texto).protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  // Índice al moverse una fila en la biblioteca; null si ya no hay fila en esa dirección.
  function indiceVertical(indice, columnas, total, paso) {
    const destino = indice + paso * columnas;
    if (destino < 0) return null;
    if (destino < total) return destino;
    const filaActual = Math.floor(indice / columnas);
    const ultimaFila = Math.floor((total - 1) / columnas);
    return paso > 0 && filaActual < ultimaFila ? total - 1 : null;
  }

  function insigniasDe(juego) {
    return [
      juego.verificado && { tipo: 'verificado', texto: 'Verificado' },
      juego.mando === true && { tipo: 'mando', texto: 'Con mando' },
      juego.mando === false && { tipo: 'sin-mando', texto: 'Sin mando' },
      juego.coop && { tipo: 'coop', texto: 'Coop 2 jugadores' }
    ].filter(Boolean);
  }

  const api = Object.freeze({ JUEGOS, DESCARTADOS, urlValida, indiceVertical, insigniasDe });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.VeloxJuegos = api;
})(typeof window !== 'undefined' ? window : globalThis);
