"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const { descifrar } = window.JarvisCifrado;
  const candado = window.CANDADO_JARVIS;

  const LARGO_CLAVE = 6;
  const INTENTOS_MAXIMOS = 5;
  const BLOQUEO_MS = 30000;

  const dialogo = $('jarvisDialogo');
  const puntos = [...dialogo.querySelectorAll('.jarvis-puntos span')];
  const botones = [...dialogo.querySelectorAll('.jarvis-teclado button')];

  let estado = { clave: '', fallos: 0, bloqueadoHasta: 0, verificando: false };

  function pintar() {
    puntos.forEach((punto, indice) => punto.classList.toggle('lleno', indice < estado.clave.length));
    const bloqueado = Date.now() < estado.bloqueadoHasta;
    botones.forEach(boton => {
      boton.disabled = estado.verificando || (bloqueado && boton.dataset.accion !== 'cerrar');
    });
  }

  function mostrarMensaje(texto) {
    $('jarvisMensaje').textContent = texto;
  }

  function reiniciar() {
    estado = { ...estado, clave: '', verificando: false };
    dialogo.classList.remove('error');
    pintar();
  }

  function abrir(evento) {
    evento.preventDefault();
    reiniciar();
    mostrarMensaje('');
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
  }

  function cerrar() {
    if (typeof dialogo.close === 'function') dialogo.close();
    else dialogo.removeAttribute('open');
  }

  function registrarFallo() {
    const fallos = estado.fallos + 1;
    const bloquear = fallos >= INTENTOS_MAXIMOS;
    estado = {
      ...estado,
      clave: '',
      verificando: false,
      fallos: bloquear ? 0 : fallos,
      bloqueadoHasta: bloquear ? Date.now() + BLOQUEO_MS : estado.bloqueadoHasta
    };
    dialogo.classList.remove('error');
    void dialogo.offsetWidth; // reinicia la animación de sacudida
    dialogo.classList.add('error');
    mostrarMensaje(bloquear ? 'Demasiados intentos. Espera 30 segundos.' : 'Contraseña incorrecta');
    pintar();
    if (bloquear) {
      setTimeout(() => {
        mostrarMensaje('');
        pintar();
      }, BLOQUEO_MS);
    }
  }

  async function verificar() {
    estado = { ...estado, verificando: true };
    mostrarMensaje('');
    pintar();
    try {
      const destino = await descifrar(candado, estado.clave);
      if (new URL(destino).protocol !== 'https:') throw new Error('Destino no válido');
      window.location.href = destino;
    } catch (error) {
      registrarFallo();
    }
  }

  function escribir(digito) {
    if (estado.verificando || Date.now() < estado.bloqueadoHasta) return;
    if (estado.clave.length >= LARGO_CLAVE) return;
    dialogo.classList.remove('error');
    estado = { ...estado, clave: estado.clave + digito };
    pintar();
    if (estado.clave.length === LARGO_CLAVE) verificar();
  }

  function borrar() {
    if (estado.verificando) return;
    estado = { ...estado, clave: estado.clave.slice(0, -1) };
    pintar();
  }

  dialogo.querySelector('.jarvis-teclado').addEventListener('click', evento => {
    const boton = evento.target.closest('button');
    if (!boton || boton.disabled) return;
    if (boton.dataset.digito) escribir(boton.dataset.digito);
    else if (boton.dataset.accion === 'borrar') borrar();
    else if (boton.dataset.accion === 'cerrar') cerrar();
  });

  dialogo.addEventListener('keydown', evento => {
    if (/^[0-9]$/.test(evento.key)) escribir(evento.key);
    else if (evento.key === 'Backspace') borrar();
    else return;
    evento.preventDefault();
  });

  dialogo.addEventListener('click', evento => {
    if (evento.target === dialogo) cerrar();
  });

  $('openJarvis').addEventListener('click', abrir);
})();
