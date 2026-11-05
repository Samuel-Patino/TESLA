"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const { JUEGOS, indiceVertical } = window.VeloxJuegos;

  const CLAVE_PRUEBAS = 'velox_juegos_pruebas_v1';
  const TEXTO_PRUEBA = { ok: 'Funciona', falla: 'Falla' };
  const BOTON_A = 0;
  const BOTON_ARRIBA = 12;
  const BOTON_ABAJO = 13;
  const BOTON_IZQUIERDA = 14;
  const BOTON_DERECHA = 15;
  const UMBRAL_PALANCA = 0.6;
  const REPETICION_MS = 260;
  const MORFOSIS_MS = 460;
  const PAUSA_RUEDA_MS = 650;
  const DESLIZAMIENTO_MIN = 50;

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

  let estado = { indice: 0, pruebas: cargarPruebas(), biblioteca: false };

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
    boton.addEventListener('click', () => {
      seleccionar(indice);
      if (estado.biblioteca) alternarBiblioteca(false);
    });
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

  /* ---------- Biblioteca: la fila se transforma en cuadrícula ---------- */
  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const elementosAnimados = [...portadas, $('filaCabecera')];
  let animaciones = [];

  // Técnica FLIP: mide, cambia el diseño y anima desde la posición anterior.
  function animarCambio(inicios) {
    animaciones.forEach(animacion => animacion.cancel());
    if (reducirMovimiento.matches || !Element.prototype.animate) {
      animaciones = [];
      return;
    }
    animaciones = elementosAnimados.map((elemento, indice) => {
      const fin = elemento.getBoundingClientRect();
      const inicio = inicios[indice];
      const dx = inicio.left - fin.left;
      const dy = inicio.top - fin.top;
      const escalaX = fin.width ? inicio.width / fin.width : 1;
      const escalaY = fin.height ? inicio.height / fin.height : 1;
      return elemento.animate(
        [
          { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${escalaX}, ${escalaY})` },
          { transformOrigin: 'top left', transform: 'none' }
        ],
        { duration: MORFOSIS_MS, delay: Math.min(indice, 8) * 12, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }
      );
    });
  }

  function alternarBiblioteca(abrir) {
    if (estado.biblioteca === abrir) return;
    const inicios = elementosAnimados.map(elemento => elemento.getBoundingClientRect());

    estado = { ...estado, biblioteca: abrir };
    document.body.classList.toggle('modo-biblioteca', abrir);
    $('filaTitulo').textContent = abrir ? 'Biblioteca de juegos' : 'Tus juegos';
    $('btnBibliotecaTxt').textContent = abrir ? 'Volver' : 'Ver biblioteca';
    $('btnBiblioteca').setAttribute('aria-expanded', String(abrir));

    if (!abrir) $('fila').scrollTop = 0;
    portadas[estado.indice].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    animarCambio(inicios);
  }

  const columnasBiblioteca = () => getComputedStyle($('fila')).gridTemplateColumns.split(' ').length;

  // Abajo abre la biblioteca; dentro recorre filas, y arriba desde la primera la cierra.
  function moverVertical(paso) {
    if (!estado.biblioteca) {
      if (paso > 0) alternarBiblioteca(true);
      return;
    }
    const destino = indiceVertical(estado.indice, columnasBiblioteca(), JUEGOS.length, paso);
    if (destino !== null) seleccionar(destino);
    else if (paso < 0) alternarBiblioteca(false);
  }

  function confirmar() {
    if (estado.biblioteca) alternarBiblioteca(false);
    else abrirJuego();
  }

  $('btnBiblioteca').addEventListener('click', () => alternarBiblioteca(!estado.biblioteca));

  let pausaRuedaHasta = 0;
  window.addEventListener('wheel', evento => {
    const vertical = Math.abs(evento.deltaY) > Math.abs(evento.deltaX);
    if (!vertical || evento.timeStamp < pausaRuedaHasta) return;
    const enLaCima = $('fila').scrollTop <= 0;
    const debeAbrir = !estado.biblioteca && evento.deltaY > 0;
    const debeCerrar = estado.biblioteca && enLaCima && evento.deltaY < 0;
    if (!debeAbrir && !debeCerrar) return;
    pausaRuedaHasta = evento.timeStamp + PAUSA_RUEDA_MS;
    alternarBiblioteca(debeAbrir);
  }, { passive: true });

  let toqueInicial = null;
  window.addEventListener('touchstart', evento => {
    const { clientX, clientY } = evento.touches[0];
    toqueInicial = { x: clientX, y: clientY, enLaCima: $('fila').scrollTop <= 0 };
  }, { passive: true });

  window.addEventListener('touchend', evento => {
    if (!toqueInicial) return;
    const { clientX, clientY } = evento.changedTouches[0];
    const dx = clientX - toqueInicial.x;
    const dy = clientY - toqueInicial.y;
    const { enLaCima } = toqueInicial;
    toqueInicial = null;
    if (Math.abs(dy) < DESLIZAMIENTO_MIN || Math.abs(dy) < Math.abs(dx)) return;
    if (!estado.biblioteca && dy < 0) alternarBiblioteca(true);
    else if (estado.biblioteca && enLaCima && dy > 0) alternarBiblioteca(false);
  }, { passive: true });

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
    else if (evento.key === 'ArrowDown') moverVertical(1);
    else if (evento.key === 'ArrowUp') moverVertical(-1);
    else if (evento.key === 'Enter' && !evento.target.closest('a, button')) confirmar();
    else return;
    if (evento.key !== 'Enter') evento.preventDefault();
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

  function direccionVerticalDe(mando) {
    const palanca = mando.axes[1] || 0;
    if (botonPulsado(mando, BOTON_ABAJO) || palanca > UMBRAL_PALANCA) return 1;
    if (botonPulsado(mando, BOTON_ARRIBA) || palanca < -UMBRAL_PALANCA) return -1;
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
      const vertical = direccionVerticalDe(mando);
      if ((direccion || vertical) && tiempo - ultimoMovimiento > REPETICION_MS) {
        ultimoMovimiento = tiempo;
        if (vertical) moverVertical(vertical);
        else mover(direccion);
      }
      const aPulsado = botonPulsado(mando, BOTON_A);
      if (aPulsado && botonASuelto) confirmar();
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
