declare module 'citeproc' {
  const CSL: {
    Engine: new (sistema: { retrieveLocale(idioma: string): string | undefined; retrieveItem(id: string): unknown }, estilo: string | object, idioma?: string, forzar?: boolean) => MotorCiteproc;
    parseXml(xml: string): object;
  };
  export interface MotorCiteproc {
    updateItems(ids: string[]): void;
    restoreProcessorState(citas: object[]): void;
    updateUncitedItems(ids: string[]): void;
    setOutputFormat(formato: 'html' | 'text' | 'rtf'): void;
    processCitationCluster(cita: object, previas: Array<[string, number]>, siguientes: Array<[string, number]>): [{ bibchange: boolean; citation_errors: unknown[] }, Array<[number, string, string]>];
    makeCitationCluster(items: object[]): string;
    makeBibliography(): false | [{ entry_ids: string[][]; bibstart: string; bibend: string; [k: string]: unknown }, string[]];
    cslXml: unknown;
    opt: { xclass?: string; [k: string]: unknown };
  }
  export default CSL;
}
