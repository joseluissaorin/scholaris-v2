/**
 * Las bibliotecas como objetos sociales, en la puerta (ver contrato/comunidad.ts).
 *
 * Todo lo que cruza estanterías vive aquí y no en la de un usuario: las
 * invitaciones y los enlaces están en las cuentas (D1), y la puerta es la única
 * que puede hablar con la estantería de otro (`pl.atender` con una sesión del
 * propietario encerrada en un `ambito`). Así:
 *
 *   · invitar, aceptar, seguir y dejar de seguir;
 *   · enlaces de solo lectura sin cuenta (`/publico/<token>/…`);
 *   · copiar a mi biblioteca: la estantería del dueño arma cada .spdf con las
 *     claves completas de sus binarios y la mía lo importa por referencia (ni se
 *     vuelve a leer nada ni se copian bytes);
 *   · buscar a la vez en lo mío y en lo que sigo.
 */
import type { Context, Hono } from 'hono';
import {
  DERECHOS, PREFIJO_API,
  type Biblioteca, type BibliotecaSeguida, type BuscarConjunta, type Copiar, type Derechos, type Enlace, type Invitacion, type InvitacionRecibida,
  type Invitar, type Miembro, type Notificacion, type NuevoEnlace, type OrigenPasaje, type Pagina, type PermisoInvitado, type RespuestaBusqueda,
  type RespuestaConjunta, type ResultadoConjunto, type ResultadoCopia, type ResumenDocumento, type TipoNotificacion, type VistaPublica,
} from '@scholaris/contrato';
import type { Plataforma } from '../app.js';
import type { UsuarioSesion } from '../puertos.js';
import { cuerpoError, cuerpoJson, exigir, ErrorScholaris, fallo, noEncontrado } from '../compartido/errores.js';
import { comprobarClave, type FilaComparticion, type FilaEnlace } from '../compartido/cuentas.js';
import { firmarBillete, verificarBillete } from '../compartido/firmas.js';

type Puerta = Hono<{ Variables: { usuario: UsuarioSesion } }>;
type C = Context<{ Variables: { usuario: UsuarioSesion } }>;

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PERMISOS: PermisoInvitado[] = ['lectura', 'edicion', 'administrador'];
const ahora = () => new Date().toISOString();

/** Correo de invitación (si la instancia sabe mandar correo). */
export interface MensajeCorreo { para: string; asunto: string; texto: string; html?: string }

export function montarSocial(app: Puerta, pl: Plataforma, fase: 'publico' | 'autenticado'): void {
  // -------------------------------------------------------------------------
  // Ayudantes
  // -------------------------------------------------------------------------

  const origenDe = (c: C) => new URL(c.req.url).origin;

  /** Pide algo a la estantería de una sesión y devuelve el JSON (o lanza el error tal cual). */
  async function pedir<T>(c: C, sesion: UsuarioSesion, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<T> {
    const r = await pedirBruto(c, sesion, metodo, ruta, cuerpo, cabeceras);
    const j = (await r.json().catch(() => null)) as T | { error?: { codigo: string; mensaje: string } } | null;
    if (!r.ok) {
      const e = (j as { error?: { codigo: string; mensaje: string } } | null)?.error;
      throw new ErrorScholaris((e?.codigo ?? 'interno') as never, e?.mensaje ?? `Error ${r.status}`);
    }
    return j as T;
  }

  function pedirBruto(c: C, sesion: UsuarioSesion, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<Response> {
    const h = new Headers(cabeceras);
    let body: BodyInit | undefined;
    if (cuerpo instanceof Uint8Array) body = cuerpo as Uint8Array<ArrayBuffer>;
    else if (cuerpo !== undefined) { body = JSON.stringify(cuerpo); h.set('content-type', 'application/json'); }
    return pl.atender(sesion, new Request(`${origenDe(c)}${PREFIJO_API}${ruta}`, { method: metodo, headers: h, body }));
  }

  /** La sesión del propietario (su estantería), encerrada en un ámbito. */
  async function sesionDe(usuario: string, ambito?: UsuarioSesion['ambito'], via: UsuarioSesion['via'] = 'clerk'): Promise<UsuarioSesion> {
    const d = await pl.cuentas.usuario(usuario);
    if (!d) noEncontrado('La biblioteca');
    return { id: d.id, correo: d.correo, nombre: d.nombre, plan: d.plan, funciones: d.plan === 'pro' ? ['scholaris'] : [], via, ...(ambito ? { ambito } : {}) };
  }

  /**
   * Quién manda en una biblioteca y con qué: soy el propietario, o un
   * administrador de la de otro. Devuelve la biblioteca vista desde su dueño.
   */
  async function gobierno(c: C, biblioteca: string, exigirAdmin = true): Promise<{ propietario: string; sesionDueno: UsuarioSesion; bib: Biblioteca; soyDueno: boolean }> {
    const yo = c.get('usuario');
    const r = await pedirBruto(c, yo, 'GET', `/bibliotecas/${encodeURIComponent(biblioteca)}`);
    if (r.ok) {
      const bib = (await r.json()) as Biblioteca;
      if (bib.permiso === 'propietario') return { propietario: yo.id, sesionDueno: yo, bib, soyDueno: true };
    }
    const p = await pl.cuentas.permisoSobre(biblioteca, yo.id);
    if (!p) noEncontrado('La biblioteca');
    if (exigirAdmin && p.permiso !== 'administrador') fallo('prohibido', 'Solo quien administra la biblioteca puede hacer esto.');
    const sesionDueno = await sesionDe(p.propietario, { biblioteca, permiso: p.permiso, invitado: { id: yo.id, correo: yo.correo, nombre: yo.nombre } }, yo.via);
    const bib = await pedir<Biblioteca>(c, sesionDueno, 'GET', `/bibliotecas/${encodeURIComponent(biblioteca)}`);
    return { propietario: p.propietario, sesionDueno, bib, soyDueno: false };
  }

  const enlaceInvitacion = (c: C, token: string) => `${origenDe(c)}/invitaciones?token=${encodeURIComponent(token)}`;
  const enlacePublico = (c: C, token: string) => `${origenDe(c)}/p/${encodeURIComponent(token)}`;

  function aMiembro(c: C, m: Awaited<ReturnType<typeof pl.cuentas.miembros>>[number]): Miembro {
    const x: Miembro = { correo: m.correo, permiso: m.permiso, pendiente: m.pendiente, estado: m.estado, invitacion: m.invitacion, desde: m.desde };
    if (m.usuario) x.usuario = m.usuario;
    if (m.nombre) x.nombre = m.nombre;
    if (m.caduca) x.caduca = m.caduca;
    if (m.pendiente && m.token) x.enlace = enlaceInvitacion(c, m.token);
    return x;
  }

  function aRecibida(f: FilaComparticion & { pnombre: string | null; pcorreo: string | null; inombre: string | null }): InvitacionRecibida {
    const r: InvitacionRecibida = {
      id: f.id, biblioteca: f.biblioteca, nombre: f.nombre ?? 'Biblioteca compartida', permiso: f.permiso, creada: f.desde, estado: f.estado,
      de: { id: f.invitador ?? f.propietario, nombre: f.inombre || f.pnombre || '', correo: f.invitador && f.invitador !== f.propietario ? '' : f.pcorreo ?? '' },
    };
    if (f.descripcion) r.descripcion = f.descripcion;
    if (f.derechos) r.derechos = f.derechos as Derechos;
    if (f.mensaje) r.mensaje = f.mensaje;
    if (f.caduca) r.caduca = f.caduca;
    return r;
  }

  function aSeguida(f: FilaComparticion & { pnombre: string | null; pcorreo: string | null }): BibliotecaSeguida {
    const s: BibliotecaSeguida = {
      biblioteca: f.biblioteca, nombre: f.nombre ?? 'Biblioteca compartida', permiso: f.permiso, desde: f.desde,
      propietario: { id: f.propietario, nombre: f.pnombre ?? '', correo: f.enlace ? '' : f.pcorreo ?? '' },
    };
    if (f.descripcion) s.descripcion = f.descripcion;
    if (f.derechos) s.derechos = f.derechos as Derechos;
    if (f.caduca) s.caduca = f.caduca;
    if (f.enlace) s.porEnlace = true;
    return s;
  }

  function aEnlace(c: C, e: FilaEnlace): Enlace {
    const x: Enlace = { id: e.id, url: enlacePublico(c, e.token), token: e.token, titulo: e.titulo, conClave: !!e.clave, creado: e.creado, visitas: e.visitas };
    if (e.biblioteca) x.biblioteca = e.biblioteca;
    if (e.documento) x.documento = e.documento;
    if (e.caduca) x.caduca = e.caduca;
    return x;
  }

  /** Un enlace que funciona ahora mismo, o el error que verá quien lo abra. */
  async function enlaceVivo(token: string): Promise<FilaEnlace> {
    const e = await pl.cuentas.enlacePorToken(token);
    if (!e || e.revocado) fallo('no_encontrado', 'Este enlace ya no funciona: quien lo compartió lo ha retirado.');
    if (e.caduca && e.caduca <= ahora()) fallo('no_encontrado', 'Este enlace ha caducado.');
    return e;
  }

  async function paseValido(e: FilaEnlace, pase: string | undefined | null): Promise<boolean> {
    if (!e.clave) return true;
    if (!pase) return false;
    const d = await verificarBillete<{ e: string }>(pl.secreto, pase);
    return d?.e === e.id;
  }

  /** La sesión del dueño de un enlace, para leer (sin cuenta, o para copiar desde él). */
  async function sesionEnlace(e: FilaEnlace, invitado: { id: string; correo: string; nombre: string }, publico: boolean): Promise<UsuarioSesion> {
    return sesionDe(e.propietario, {
      biblioteca: e.biblioteca ?? '', permiso: 'lectura', invitado,
      ...(e.documento ? { documento: e.documento } : {}), ...(publico ? { publico: true } : {}),
    }, 'clave_api');
  }

  // -------------------------------------------------------------------------
  // Sin cuenta: enlaces de solo lectura
  // -------------------------------------------------------------------------

  if (fase === 'publico') {
    const P = `${PREFIJO_API}/publico/:token`;

    app.get(P, async (c) => {
      const e = await enlaceVivo(c.req.param('token')!);
      const dueno = await pl.cuentas.usuario(e.propietario);
      const vista: VistaPublica = {
        tipo: e.documento ? 'documento' : 'biblioteca', titulo: e.titulo, derechos: 'sin_indicar', de: dueno?.nombre || 'Alguien',
        documentos: e.documento ? 1 : 0, conClave: !!e.clave,
        ...(e.biblioteca ? { biblioteca: e.biblioteca } : {}), ...(e.documento ? { documento: e.documento } : {}), ...(e.caduca ? { caduca: e.caduca } : {}),
      };
      const pase = c.req.header('x-scholaris-pase') ?? c.req.query('pase');
      if (e.biblioteca) {
        const s = await sesionEnlace(e, { id: 'anonimo', correo: '', nombre: '' }, true);
        const r = await pedirBruto(c as never, s, 'GET', `/bibliotecas/${encodeURIComponent(e.biblioteca)}`);
        if (r.ok) {
          const b = (await r.json()) as Biblioteca;
          vista.derechos = b.derechos ?? 'sin_indicar';
          vista.documentos = b.documentos;
          if (b.descripcion && (await paseValido(e, pase))) vista.descripcion = b.descripcion;
        }
      }
      await pl.cuentas.contarVisita(e.id).catch(() => undefined);
      c.header('x-robots-tag', 'noindex, nofollow');
      c.header('cache-control', 'no-store');
      return c.json(vista);
    });

    app.post(`${P}/acceso`, async (c) => {
      const e = await enlaceVivo(c.req.param('token')!);
      const b = await cuerpoJson<{ clave?: string }>(c as never);
      if (!e.clave) return c.json({ pase: '', caduca: '' });
      exigir(typeof b.clave === 'string' && b.clave.length > 0, 'Escribe la contraseña del enlace.');
      if (!(await comprobarClave(b.clave, e.clave))) fallo('prohibido', 'La contraseña no es correcta.');
      const segundos = 12 * 3600;
      return c.json({ pase: await firmarBillete(pl.secreto, { e: e.id }, segundos), caduca: new Date(Date.now() + segundos * 1000).toISOString() });
    });

    app.all(`${P}/*`, async (c) => {
      const token = c.req.param('token')!;
      const e = await enlaceVivo(token);
      if (!(await paseValido(e, c.req.header('x-scholaris-pase') ?? c.req.query('pase')))) fallo('no_autenticado', 'Este enlace tiene contraseña.');
      const sesion = await sesionEnlace(e, { id: 'anonimo', correo: '', nombre: '' }, true);
      const url = new URL(c.req.url);
      url.pathname = url.pathname.replace(`${PREFIJO_API}/publico/${token}`, PREFIJO_API).replace(`${PREFIJO_API}/publico/${encodeURIComponent(token)}`, PREFIJO_API);
      const h = new Headers(c.req.raw.headers);
      h.delete('authorization');
      const r = await pl.atender(sesion, new Request(url.toString(), new Request(c.req.raw, { headers: h })));
      const salida = new Response(r.body, r);
      salida.headers.set('x-robots-tag', 'noindex, nofollow');
      return salida;
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Invitar y gestionar miembros
  // -------------------------------------------------------------------------

  app.post(`${PREFIJO_API}/bibliotecas/:id/compartir`, async (c) => {
    const yo = c.get('usuario');
    if (yo.via === 'clave_api' && !yo.alcances?.includes('escritura')) fallo('prohibido', 'Esta clave de API es de solo lectura.');
    const id = c.req.param('id');
    const { propietario, bib } = await gobierno(c, id);
    const b = await cuerpoJson<Invitar>(c as never);
    exigir(typeof b.correo === 'string' && CORREO.test(b.correo.trim()), 'El correo no es válido.');
    exigir(PERMISOS.includes(b.permiso), 'El permiso debe ser «lectura», «edicion» o «administrador».');
    exigir(b.mensaje === undefined || (typeof b.mensaje === 'string' && b.mensaje.length <= 1000), 'El mensaje puede tener hasta 1000 caracteres.');
    exigir(b.caducaDias === undefined || (Number.isInteger(b.caducaDias) && b.caducaDias >= 1 && b.caducaDias <= 3650), 'La caducidad va en días (de 1 a 3650).');
    const correo = b.correo.trim().toLowerCase();
    const dueno = await pl.cuentas.usuario(propietario);
    if (correo === yo.correo.toLowerCase() || correo === dueno?.correo.toLowerCase()) fallo('peticion_invalida', 'Esa persona ya tiene la biblioteca.');
    const f = await pl.cuentas.invitar({
      biblioteca: id, propietario, invitador: yo.id, nombre: bib.nombre, descripcion: bib.descripcion ?? null, derechos: bib.derechos ?? null,
      correo, permiso: b.permiso, mensaje: b.mensaje?.trim() || null, caducaDias: b.caducaDias ?? null,
    });
    const enlace = enlaceInvitacion(c, f.token ?? '');
    let correoEnviado = false;
    if (pl.correo && f.estado === 'pendiente') {
      const quien = yo.nombre || yo.correo;
      const texto = [
        `${quien} te invita a ${b.permiso === 'lectura' ? 'leer' : 'trabajar en'} la biblioteca «${bib.nombre}» en Scholaris.`,
        ...(f.mensaje ? ['', f.mensaje] : []),
        '', `Para aceptarla, abre este enlace: ${enlace}`,
        '', 'Si no esperabas esta invitación, puedes ignorar este correo.',
      ].join('\n');
      correoEnviado = await pl.correo({ para: correo, asunto: `${quien} comparte contigo «${bib.nombre}»`, texto }).catch(() => false);
    }
    const inv: Invitacion = {
      id: f.id, biblioteca: id, correo: f.correo, permiso: f.permiso, estado: f.estado, creada: f.desde, enlace, correoEnviado,
      ...(f.mensaje ? { mensaje: f.mensaje } : {}), ...(f.caduca ? { caduca: f.caduca } : {}),
    };
    return c.json(inv, 201);
  });

  app.get(`${PREFIJO_API}/bibliotecas/:id/miembros`, async (c) => {
    const id = c.req.param('id');
    const { propietario } = await gobierno(c, id);
    const d = await pl.cuentas.usuario(propietario);
    const lista: Miembro[] = [
      { usuario: propietario, correo: d?.correo ?? '', ...(d?.nombre ? { nombre: d.nombre } : {}), permiso: 'propietario', pendiente: false, estado: 'aceptada', desde: '' },
      ...(await pl.cuentas.miembros(id)).map((m) => aMiembro(c, m)),
    ];
    return c.json(lista);
  });

  app.patch(`${PREFIJO_API}/bibliotecas/:id/miembros/:quien`, async (c) => {
    const id = c.req.param('id');
    const { propietario } = await gobierno(c, id);
    const b = await cuerpoJson<{ permiso: PermisoInvitado }>(c as never);
    exigir(PERMISOS.includes(b.permiso), 'El permiso debe ser «lectura», «edicion» o «administrador».');
    const quien = decodeURIComponent(c.req.param('quien'));
    if (!(await pl.cuentas.cambiarPermiso(id, propietario, quien, b.permiso))) noEncontrado('El miembro');
    const m = (await pl.cuentas.miembros(id)).find((x) => x.usuario === quien || x.correo === quien.toLowerCase());
    return c.json(aMiembro(c, m!));
  });

  app.delete(`${PREFIJO_API}/bibliotecas/:id/miembros/:quien`, async (c) => {
    const id = c.req.param('id');
    const { propietario } = await gobierno(c, id);
    await pl.cuentas.dejarDeCompartir(id, propietario, decodeURIComponent(c.req.param('quien')));
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Enlaces
  // -------------------------------------------------------------------------

  app.get(`${PREFIJO_API}/bibliotecas/:id/enlaces`, async (c) => {
    const id = c.req.param('id');
    const { propietario } = await gobierno(c, id);
    return c.json((await pl.cuentas.enlaces(propietario, id)).map((e) => aEnlace(c, e)));
  });

  app.post(`${PREFIJO_API}/enlaces`, async (c) => {
    const yo = c.get('usuario');
    if (yo.via === 'clave_api' && !yo.alcances?.includes('escritura')) fallo('prohibido', 'Esta clave de API es de solo lectura.');
    const b = await cuerpoJson<NuevoEnlace>(c as never);
    exigir(!!b.biblioteca !== !!b.documento, 'Indica una biblioteca o un documento (uno de los dos).');
    exigir(b.clave === undefined || (typeof b.clave === 'string' && b.clave.length >= 4 && b.clave.length <= 200), 'La contraseña necesita al menos 4 caracteres.');
    exigir(b.caducaDias === undefined || (Number.isInteger(b.caducaDias) && b.caducaDias >= 1 && b.caducaDias <= 3650), 'La caducidad va en días (de 1 a 3650).');
    let propietario = yo.id;
    let titulo: string;
    let abierto = false;
    if (b.biblioteca) {
      const g = await gobierno(c, b.biblioteca);
      propietario = g.propietario;
      titulo = g.bib.nombre;
      abierto = DERECHOS[g.bib.derechos ?? 'sin_indicar']?.abierto ?? false;
    } else {
      const d = await pedir<{ id: string; metadatos: { titulo?: string } }>(c, yo, 'GET', `/documentos/${encodeURIComponent(b.documento!)}`);
      titulo = d.metadatos.titulo || 'Documento';
    }
    if (!abierto && !b.confirmarDerechos) {
      fallo('conflicto', 'Antes de crear el enlace, confirma que lo compartes para uso privado con quien lo reciba: puede contener obras con derechos de autor.', { confirmarDerechos: true });
    }
    const e = await pl.cuentas.crearEnlace({ propietario, biblioteca: b.biblioteca ?? null, documento: b.documento ?? null, titulo, clave: b.clave ?? null, caducaDias: b.caducaDias ?? null });
    return c.json(aEnlace(c, e), 201);
  });

  app.delete(`${PREFIJO_API}/enlaces/:id`, async (c) => {
    const yo = c.get('usuario');
    const e = await pl.cuentas.enlace(c.req.param('id'));
    if (!e || e.revocado) noEncontrado('El enlace');
    let propietario = yo.id;
    if (e.propietario !== yo.id) {
      if (!e.biblioteca) noEncontrado('El enlace');
      propietario = (await gobierno(c, e.biblioteca)).propietario;
    }
    if (!(await pl.cuentas.revocarEnlace(propietario, e.id))) noEncontrado('El enlace');
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Invitaciones recibidas, bibliotecas que sigo, notificaciones
  // -------------------------------------------------------------------------

  app.get(`${PREFIJO_API}/invitaciones`, async (c) => {
    const yo = c.get('usuario');
    return c.json((await pl.cuentas.invitacionesPara(yo.id, yo.correo)).map(aRecibida));
  });

  app.get(`${PREFIJO_API}/invitaciones/token/:token`, async (c) => {
    const yo = c.get('usuario');
    const f = await pl.cuentas.invitacion(c.req.param('token')!);
    if (!f || f.token !== c.req.param('token')! || (f.usuario && f.usuario !== yo.id)) noEncontrado('La invitación');
    return c.json(aRecibida(f));
  });

  for (const accion of ['aceptar', 'rechazar'] as const) {
    app.post(`${PREFIJO_API}/invitaciones/:id/${accion}`, async (c) => {
      const yo = c.get('usuario');
      if (yo.via === 'clave_api') fallo('prohibido', 'Las invitaciones se aceptan desde la web.');
      const r = await pl.cuentas.responder(c.req.param('id'), yo, accion === 'aceptar');
      if (r === 'no_encontrada' || r === 'ajena') noEncontrado('La invitación');
      if (r === 'caducada') fallo('conflicto', 'La invitación ha caducado: pide otra a quien te la mandó.');
      if (accion === 'rechazar') return c.json({ ok: true });
      const fila = (await pl.cuentas.compartidasConmigo(yo.id)).find((x) => x.biblioteca === r.biblioteca);
      return c.json(fila ? aSeguida(fila) : { biblioteca: r.biblioteca, nombre: r.nombre ?? '', permiso: r.permiso, desde: ahora(), propietario: { id: r.propietario, nombre: '', correo: '' } });
    });
  }

  app.get(`${PREFIJO_API}/seguidas`, async (c) => c.json((await pl.cuentas.compartidasConmigo(c.get('usuario').id)).map(aSeguida)));

  /** Seguir una biblioteca desde un enlace de solo lectura (lectura, mientras viva el enlace). */
  app.post(`${PREFIJO_API}/seguidas`, async (c) => {
    const yo = c.get('usuario');
    const b = await cuerpoJson<{ enlace: string; pase?: string }>(c as never);
    exigir(typeof b.enlace === 'string', 'Falta el enlace.');
    const e = await enlaceVivo(b.enlace);
    if (!e.biblioteca) fallo('peticion_invalida', 'Un enlace a un solo documento no se puede seguir: cópialo a tu biblioteca.');
    if (!(await paseValido(e, b.pase))) fallo('no_autenticado', 'Este enlace tiene contraseña.');
    if (e.propietario === yo.id) fallo('conflicto', 'Esta biblioteca ya es tuya.');
    await pl.cuentas.seguirPorEnlace(e, yo, e.titulo);
    const fila = (await pl.cuentas.compartidasConmigo(yo.id)).find((x) => x.biblioteca === e.biblioteca);
    if (!fila) fallo('conflicto', 'Ya tenías una invitación a esta biblioteca: acéptala en Invitaciones.');
    return c.json(aSeguida(fila), 201);
  });

  app.delete(`${PREFIJO_API}/seguidas/:biblioteca`, async (c) => {
    if (!(await pl.cuentas.salir(c.req.param('biblioteca'), c.get('usuario').id))) noEncontrado('La biblioteca');
    return c.json({ ok: true });
  });

  app.get(`${PREFIJO_API}/notificaciones`, async (c) => {
    const yo = c.get('usuario');
    const filas = await pl.cuentas.notificaciones(yo.id, yo.correo, c.req.query('pendientes') === '1');
    return c.json(filas.map((f): Notificacion => ({
      id: f.id, tipo: f.tipo as TipoNotificacion, texto: f.texto, creada: f.creada, leida: !!f.leida,
      ...(f.biblioteca ? { biblioteca: f.biblioteca } : {}), ...(f.destino ? { destino: f.destino } : {}),
    })));
  });

  app.post(`${PREFIJO_API}/notificaciones/leidas`, async (c) => {
    const yo = c.get('usuario');
    const b = await cuerpoJson<{ ids?: string[] }>(c as never);
    exigir(b.ids === undefined || (Array.isArray(b.ids) && b.ids.length <= 200), 'Manda hasta 200 ids.');
    await pl.cuentas.marcarLeidas(yo.id, yo.correo, b.ids);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Copiar a mi biblioteca
  // -------------------------------------------------------------------------

  app.post(`${PREFIJO_API}/copias`, async (c) => {
    const yo = c.get('usuario');
    if (yo.via === 'clave_api' && !yo.alcances?.includes('escritura')) fallo('prohibido', 'Esta clave de API es de solo lectura.');
    const b = await cuerpoJson<Copiar>(c as never);
    exigir(b.origen && typeof b.origen === 'object', 'Indica el origen: { biblioteca } o { enlace }.');
    exigir(b.documentos === undefined || (Array.isArray(b.documentos) && b.documentos.length <= 5000), 'Demasiados documentos.');
    const invitado = { id: yo.id, correo: yo.correo, nombre: yo.nombre };
    // Origen: su dueño, la sesión con la que se lee y la biblioteca (si la hay).
    let propietario: string;
    let sesion: UsuarioSesion;
    let bibOrigen: string | undefined;
    let documentoUnico: string | undefined;
    if ('biblioteca' in b.origen) {
      bibOrigen = b.origen.biblioteca;
      const p = await pl.cuentas.permisoSobre(bibOrigen, yo.id);
      if (!p) {
        const propia = await pedirBruto(c, yo, 'GET', `/bibliotecas/${encodeURIComponent(bibOrigen)}`);
        if (propia.ok) fallo('conflicto', 'Esta biblioteca ya es tuya.');
        noEncontrado('La biblioteca');
      }
      propietario = p.propietario;
      sesion = await sesionDe(propietario, { biblioteca: bibOrigen, permiso: 'lectura', invitado }, yo.via);
    } else {
      const e = await enlaceVivo(b.origen.enlace);
      if (!(await paseValido(e, b.origen.pase))) fallo('no_autenticado', 'Este enlace tiene contraseña.');
      if (e.propietario === yo.id) fallo('conflicto', 'Esto ya es tuyo.');
      propietario = e.propietario;
      bibOrigen = e.biblioteca ?? undefined;
      documentoUnico = e.documento ?? undefined;
      // Para copiar no hace falta el ámbito «publico» (que no deja armar el .spdf): es la puerta quien lo pide.
      sesion = await sesionEnlace(e, invitado, false);
    }
    const dueno = await pl.cuentas.usuario(propietario);
    const de = dueno?.nombre || dueno?.correo || 'otra persona';
    const bib = bibOrigen ? await pedir<Biblioteca>(c, sesion, 'GET', `/bibliotecas/${encodeURIComponent(bibOrigen)}`) : null;

    // Qué copiar.
    let ids: string[];
    if (b.documentos?.length) ids = [...new Set(b.documentos)];
    else if (documentoUnico) ids = [documentoUnico];
    else {
      ids = [];
      let cursor: string | undefined;
      do {
        const pag = await pedir<Pagina<ResumenDocumento>>(c, sesion, 'GET', `/documentos?estado=listo&limite=200${cursor ? `&cursor=${cursor}` : ''}`);
        ids.push(...pag.elementos.map((d) => d.id));
        cursor = pag.siguiente;
      } while (cursor && ids.length < 5000);
    }

    // Adónde.
    let destino: string;
    const nueva = !b.destino || 'nombre' in b.destino;
    if (b.destino && 'biblioteca' in b.destino) {
      const mia = await pedir<Biblioteca>(c, yo, 'GET', `/bibliotecas/${encodeURIComponent(b.destino.biblioteca)}`);
      if (mia.permiso !== 'propietario') noEncontrado('La biblioteca de destino');
      destino = mia.id;
    } else {
      const nombre = (b.destino && 'nombre' in b.destino ? b.destino.nombre : null)?.trim() || bib?.nombre || 'Copia';
      const creada = await pedir<Biblioteca>(c, yo, 'POST', '/bibliotecas', {
        nombre: nombre.slice(0, 200),
        ...(bib?.descripcion ? { descripcion: bib.descripcion } : {}), ...(bib?.color ? { color: bib.color } : {}),
        derechos: bib?.derechos ?? 'sin_indicar', ...(bib?.notaDerechos ? { notaDerechos: bib.notaDerechos } : {}),
        copiadaDe: { biblioteca: bibOrigen ?? '', nombre: bib?.nombre ?? '', de, cuando: ahora() },
      });
      destino = creada.id;
    }

    const tanda = Math.min(25, Math.max(1, b.tanda ?? 10));
    const ahoraVan = ids.slice(0, tanda);
    const salida: ResultadoCopia = { biblioteca: destino, copiados: [], repetidos: [], fallidos: [], pendientes: ids.slice(tanda), total: ids.length };
    const importador: UsuarioSesion = { ...yo, importarDe: { propietario, ...(bibOrigen ? { biblioteca: bibOrigen } : {}), ...(bib ? { nombre: bib.nombre } : {}), de } };
    for (const id of ahoraVan) {
      try {
        const r = await pedirBruto(c, sesion, 'GET', `/documentos/${encodeURIComponent(id)}/spdf?incrustar=0&referencias=1`);
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { error?: { mensaje: string } } | null;
          throw new Error(j?.error?.mensaje ?? `Error ${r.status}`);
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        const imp = await pedir<{ documento: string; repetido?: boolean }>(c, importador, 'POST', `/documentos/importar?biblioteca=${encodeURIComponent(destino)}&deduplicar=1`, bytes, { 'content-type': 'application/x-spdf' });
        (imp.repetido ? salida.repetidos : salida.copiados).push({ origen: id, documento: imp.documento });
      } catch (e) {
        salida.fallidos.push({ origen: id, error: (e as Error).message });
      }
    }
    if (nueva && bibOrigen && salida.copiados.length) {
      await pl.cuentas.notificar({ usuario: propietario, tipo: 'biblioteca_copiada', texto: `${yo.nombre || yo.correo} ha copiado «${bib?.nombre ?? 'tu biblioteca'}» a su Scholaris.`, biblioteca: bibOrigen }).catch(() => undefined);
      await pl.cuentas.auditar(yo.id, 'biblioteca_copiada', { origen: bibOrigen, propietario, destino }).catch(() => undefined);
    }
    return c.json(salida, nueva ? 201 : 200);
  });

  // -------------------------------------------------------------------------
  // Búsqueda en lo mío y en lo que sigo
  // -------------------------------------------------------------------------

  app.post(`${PREFIJO_API}/busqueda/conjunta`, async (c) => {
    const yo = c.get('usuario');
    const t0 = Date.now();
    const b = await cuerpoJson<BuscarConjunta>(c as never);
    exigir(typeof b.consulta === 'string' && b.consulta.trim().length > 0, 'Escribe algo que buscar.');
    const alcance = b.alcance ?? 'todo';
    const seguidas = await pl.cuentas.compartidasConmigo(yo.id);
    const k = Math.min(100, Math.max(1, b.k ?? 20));
    const { alcance: _a, ...busqueda } = b;
    void _a;
    const tareas: Array<{ origen: OrigenPasaje; correr: () => Promise<RespuestaBusqueda> }> = [];
    let mias: string[] | null = null;
    let quiero = seguidas;
    if (typeof alcance === 'object') {
      exigir(Array.isArray(alcance.bibliotecas) && alcance.bibliotecas.length > 0 && alcance.bibliotecas.length <= 50, 'Indica entre 1 y 50 bibliotecas.');
      const ajenas = new Set(seguidas.map((s) => s.biblioteca));
      mias = alcance.bibliotecas.filter((x) => !ajenas.has(x));
      quiero = seguidas.filter((s) => alcance.bibliotecas.includes(s.biblioteca));
    } else if (alcance === 'mias') quiero = [];
    if (alcance === 'todo' || alcance === 'mias' || (mias && mias.length)) {
      const filtros = mias ? { ...(b.filtros ?? {}), bibliotecas: mias } : b.filtros;
      tareas.push({ origen: { propia: true }, correr: () => pedir<RespuestaBusqueda>(c, yo, 'POST', '/busqueda', { ...busqueda, k, ...(filtros ? { filtros } : {}) }) });
    }
    for (const s of quiero) {
      tareas.push({
        origen: { propia: false, biblioteca: s.biblioteca, nombre: s.nombre ?? '', de: s.pnombre ?? '' },
        correr: async () => pedir<RespuestaBusqueda>(c, await sesionDe(s.propietario, { biblioteca: s.biblioteca, permiso: s.permiso, invitado: { id: yo.id, correo: yo.correo, nombre: yo.nombre } }, yo.via),
          'POST', '/busqueda', { ...busqueda, k, sinHistorial: true }),
      });
    }
    const hechas = await Promise.all(tareas.map(async (t) => {
      try { return { t, r: await t.correr() }; } catch (e) { return { t, error: (e as Error).message }; }
    }));
    const resultados: ResultadoConjunto[] = [];
    const salida: RespuestaConjunta = { resultados, fuentes: [], ms: 0 };
    for (const h of hechas) {
      salida.fuentes.push({ ...h.t.origen, resultados: h.r?.resultados.length ?? 0, ...(h.error ? { error: h.error } : {}) });
      if (h.r) {
        if (h.t.origen.propia && h.r.intencion) salida.intencion = h.r.intencion;
        for (const r of h.r.resultados) resultados.push({ ...r, origen: h.t.origen });
      }
    }
    resultados.sort((x, y) => y.puntuacion - x.puntuacion);
    salida.resultados = resultados.slice(0, k);
    salida.ms = Date.now() - t0;
    return c.json(salida);
  });

  void cuerpoError;
}
