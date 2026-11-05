"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const { JUEGOS } = window.VeloxJuegos;

  const CLAVE_PRUEBAS = 'velox_juegos_pruebas_v1';
  const TEXTO_PRUEBA = { ok: 'Funciona', falla: 'Falla' };
  const BOTON_A = 0;
  const BOTON_IZQUIERDA = 14;
  const BOTON_DERECHA = 15;
  const UMBRAL_PALANCA = 0.6;
  const REPETICION_MS = 260;

  function cargarPruebas() {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE_PRUEBAS));
      if (!guardado || typeof guardado !== 'object') return {};
      return Object.fromEntries(Object.entries(guardado).filter(([, resultado]) => TEXTO_PRUEBA[resultado]));
    } catch (e) {
      console.warn('No se pudieron leer las pruebas guardadas:', e);
      return {};
    }
  }

  function guardarPruebas(pruebas) {
    try {
      localStorage.setItem(CLAVE_PRUEBAS, JSON.stringify(pruebas));
    } catch (e) {
      console.warn('No se pudieron guardar las pruebas:', e);
    }
  }

  let estado = { indice: 0, pruebas: cargarPruebas() };

  const juegoActual = () => JUEGOS[estado.indice];

  function aplicarColores(elemento, juego) {
    elemento.style.setProperty('--c1', juego.colores[0]);
    elemento.style.setProperty('--c2', juego.colores[1]);
  }

  function crearPortada(juego, indice) {
    const boton = document.createElement('button');
    boton.className = 'portada';
    boton.type = 'button';
    boton.textContent = juego.titulo;
    aplicarColores(boton, juego);
    boton.addEventListener('click', () => seleccionar(indice));
    return boton;
  }

  const portadas = JUEGOS.map(crearPortada);
  $('fila').append(...portadas);

  function pintarMarca(portada, resultado) {
    const anterior = portada.querySelector('.marca');
    if (anterior) anterior.remove();
    if (!resultado) return;
    const marca = document.createElement('span');
    marca.className = `marca ${resultado}`;
    marca.textContent = TEXTO_PRUEBA[resultado];
    portada.append(marca);
  }

  function pintar() {
    const juego = juegoActual();
    const resultado = estado.pruebas[juego.id];
    const probados = JUEGOS.filter(item => estado.pruebas[item.id]).length;

    aplicarColores(document.documentElement, juego);
    $('biblioteca').textContent = `Biblioteca ${JUEGOS.length} · ${probados} probados`;
    $('categoria').textContent = juego.categoria;
    $('titulo').textContent = juego.titulo;
    $('descripcion').textContent = juego.descripcion;
    $('btnAbrir').href = juego.url;
    $('btnPestana').href = juego.url;

    const etiqueta = $('etiquetaPrueba');
    etiqueta.textContent = resultado ? TEXTO_PRUEBA[resultado] : 'Sin probar';
    etiqueta.className = `etiqueta prueba ${resultado || ''}`.trim();

    $('btnFunciona').setAttribute('aria-pressed', String(resultado === 'ok'));
    $('btnFalla').setAttribute('aria-pressed', String(resultado === 'falla'));

    portadas.forEach((portada, indice) => {
      if (indice === estado.indice) portada.setAttribute('aria-current', 'true');
      else portada.removeAttribute('aria-current');
      pintarMarca(portada, estado.pruebas[JUEGOS[indice].id]);
    });
  }

  function seleccionar(indice) {
    estado = { ...estado, indice };
    pintar();
    portadas[indice].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function mover(paso) {
    seleccionar((estado.indice + paso + JUEGOS.length) % JUEGOS.length);
  }

  // Tocar el resultado ya marcado lo quita, por si se marcó por error.
  function marcarPrueba(resultado) {
    const { id } = juegoActual();
    const { [id]: anterior, ...resto } = estado.pruebas;
    const pruebas = anterior === resultado ? resto : { ...resto, [id]: resultado };
    estado = { ...estado, pruebas };
    guardarPruebas(pruebas);
    pintar();
  }

  function abrirJuego() {
    window.location.href = juegoActual().url;
  }

  $('btnFunciona').addEventListener('click', () => marcarPrueba('ok'));
  $('btnFalla').addEventListener('click', () => marcarPrueba('falla'));

  document.addEventListener('keydown', evento => {
    if (evento.key === 'ArrowRight') mover(1);
    else if (evento.key === 'ArrowLeft') mover(-1);
    else if (evento.key === 'Enter' && !evento.target.closest('a, button')) abrirJuego();
  });

  /* ---------- Mando: detección y navegación del menú ---------- */
  function pintarMando(claseEstado, texto) {
    $('mandoPunto').className = `punto ${claseEstado}`.trim();
    $('mandoTxt').textContent = texto;
  }

  function leerMando() {
    try {
      return Array.from(navigator.getGamepads()).find(Boolean) || null;
    } catch (e) {
      console.warn('No se pudo leer el mando:', e);
      return null;
    }
  }

  const botonPulsado = (mando, indice) => Boolean(mando.buttons[indice] && mando.buttons[indice].pressed);

  function direccionDe(mando) {
    const palanca = mando.axes[0] || 0;
    if (botonPulsado(mando, BOTON_DERECHA) || palanca > UMBRAL_PALANCA) return 1;
    if (botonPulsado(mando, BOTON_IZQUIERDA) || palanca < -UMBRAL_PALANCA) return -1;
    return 0;
  }

  let ultimoMovimiento = 0;
  let botonASuelto = false;
  let mandoVisible = false;

  function atenderMando(tiempo) {
    const mando = leerMando();

    if (mando && !mandoVisible) pintarMando('ok', 'Mando detectado');
    if (!mando && mandoVisible) pintarMando('', 'Mando: presiona un botón');
    mandoVisible = Boolean(mando);

    if (mando) {
      const direccion = direccionDe(mando);
      if (direccion && tiempo - ultimoMovimiento > REPETICION_MS) {
        ultimoMovimiento = tiempo;
        mover(direccion);
      }
      const aPulsado = botonPulsado(mando, BOTON_A);
      if (aPulsado && botonASuelto) abrirJuego();
      botonASuelto = !aPulsado;
    }

    requestAnimationFrame(atenderMando);
  }

  if (typeof navigator.getGamepads === 'function') requestAnimationFrame(atenderMando);
  else pintarMando('no', 'Mando no compatible');

  /* ---------- Reloj y pantalla completa ---------- */
  function actualizarReloj() {
    $('reloj').textContent = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  actualizarReloj();
  setInterval(actualizarReloj, 10000);

  const enPantallaCompleta = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

  $('btnPantalla').addEventListener('click', () => {
    const raiz = document.documentElement;
    const accion = enPantallaCompleta()
      ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      : (raiz.requestFullscreen || raiz.webkitRequestFullscreen).call(raiz);
    Promise.resolve(accion).catch(error => console.warn('Pantalla completa no disponible:', error));
  });

  pintar();
})();
