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
      id: 'guitar-hero-3',
      titulo: 'Guitar Hero III',
      categoria: 'Ritmo',
      descripcion: 'Toca la guitarra al ritmo de clásicos del rock siguiendo las notas en pantalla.',
      url: 'https://gh3.thediaryofchris.net/index.html',
      colores: ['#5b0f0f', '#f59e0b']
    },
    {
      id: 'halo-2',
      titulo: 'Halo 2',
      categoria: 'Disparos',
      descripcion: 'Combate de ciencia ficción en primera persona, directo desde el navegador.',
      url: 'https://www.halo2browser.com/',
      colores: ['#0f6b4f', '#7bd64f'],
      verificado: true
    },
    {
      id: 'halo-online',
      titulo: 'Halo Online',
      categoria: 'Disparos',
      descripcion: 'Versión web de Open Halo CE para jugar en primera persona.',
      url: 'https://openhaloce.com/',
      colores: ['#123d7a', '#39b6ff'],
      verificado: true
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
    },
    {
      titulo: 'Clover Pit · Enlace 2',
      url: 'https://genizymath.github.io/games/clover-pit/',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'Buckshot Roulette · Enlace 2',
      url: 'https://genizymath.github.io/iframe/205-fix2.html',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'FIFA 14',
      url: 'https://fifa14.online/',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'GTA V',
      url: 'https://wasmarcade.com/gta-5',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'Black Ops Zombies',
      url: 'https://vel.gg/bsz/kino?mode=single&guns=classic',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'Geometry Dash',
      url: 'https://genizymath.github.io/iframe/868-F3.html',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
    },
    {
      titulo: 'GN-Math',
      url: 'https://genizymath.github.io/index.html',
      resultado: 'Marcado como Falla en el Tesla.',
      fecha: '2026-11-15'
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
