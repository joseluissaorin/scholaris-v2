/**
 * Firma SigV4 para prefirmar subidas y descargas directas contra un endpoint
 * S3 compatible (R2 o MinIO). Igual que en Andarama: solo PREFIRMA; las
 * operaciones de servidor usan el binding R2 o el disco.
 */
import { AwsClient } from 'aws4fetch';

export interface ConfigS3 {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class PrefirmadorS3 {
  private cliente: AwsClient;

  constructor(private cfg: ConfigS3) {
    this.cliente = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: cfg.region ?? 'auto' });
  }

  private url(clave: string): URL {
    return new URL(`${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${clave.split('/').map(encodeURIComponent).join('/')}`);
  }

  private async firmar(metodo: string, u: URL, segundos: number, cabeceras?: Record<string, string>): Promise<string> {
    u.searchParams.set('X-Amz-Expires', String(segundos));
    const r = await this.cliente.sign(new Request(u.toString(), { method: metodo, headers: cabeceras }), { aws: { signQuery: true } });
    return r.url;
  }

  put(clave: string, segundos = 3600): Promise<string> {
    return this.firmar('PUT', this.url(clave), segundos);
  }

  get(clave: string, segundos = 3600, o: { descarga?: string; tipo?: string } = {}): Promise<string> {
    const u = this.url(clave);
    if (o.descarga) u.searchParams.set('response-content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(o.descarga)}`);
    if (o.tipo) u.searchParams.set('response-content-type', o.tipo);
    return this.firmar('GET', u, segundos);
  }

  parte(clave: string, idSubida: string, numero: number, segundos = 3600): Promise<string> {
    const u = this.url(clave);
    u.searchParams.set('partNumber', String(numero));
    u.searchParams.set('uploadId', idSubida);
    return this.firmar('PUT', u, segundos);
  }
}
