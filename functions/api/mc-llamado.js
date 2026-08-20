// Cloudflare Pages Function · POST /api/mc-llamado
//
// ⚠️ ALIAS HISTÓRICO. La implementación vive en `aviso-llamada.js` desde el
// 2026-08-19, cuando este endpoint pasó a ser LA ENTRADA COMÚN de «alguien dejó
// su teléfono» (venga de comentario, DM, WhatsApp o la web) en vez de «Puerta 2
// (región)», que es para lo que nació.
//
// Este archivo existe para que los flujos de ManyChat YA MONTADOS no haya que
// tocarlos: las Solicitudes externas que apuntan a `/api/mc-llamado` siguen
// funcionando igual, con el mismo body y las mismas claves de respuesta
// (`promesaLlamada`, `dentroDeHorario`, `llamadoId`, `biciNombre`,
// `llamarElLegible`), que es lo que mapean los flujos.
//
// Para montajes NUEVOS usa `/api/aviso-llamada`, que es el nombre que dice lo
// que hace. Cuando no quede ningún flujo apuntando acá, este archivo se borra.

import { onRequestPost as post, onRequestGet as get } from './aviso-llamada.js';

export const onRequestPost = post;
export const onRequestGet = get;
