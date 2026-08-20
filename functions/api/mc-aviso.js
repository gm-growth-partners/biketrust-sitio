// Cloudflare Pages Function · POST /api/mc-aviso
//
// ⚠️ ALIAS HISTÓRICO. La implementación vive en `aviso-humano.js` desde el
// 2026-08-19, cuando este endpoint pasó a ser LA ENTRADA COMÚN de «esto necesita
// a una persona», con identidad multicanal, canal registrado y red (sello +
// barrido + briefing).
//
// Este archivo existe para que los flujos de ManyChat YA MONTADOS no haya que
// tocarlos: AB-2 (anti-bucle) y T-2 (pregunta técnica por chat) apuntan a
// `/api/mc-aviso` y siguen funcionando igual. Ninguno mapea la respuesta, así
// que el JSON más rico que devuelve ahora no rompe nada.
//
// Para montajes NUEVOS usa `/api/aviso-humano`.

import { onRequestPost as post, onRequestGet as get } from './aviso-humano.js';

export const onRequestPost = post;
export const onRequestGet = get;
