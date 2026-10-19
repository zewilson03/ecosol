export class FalhaDeIntegracaoBancaria extends Error {
  constructor(
    codigo,
    { seguroRepetir = false, retryAfterMs = null, permanente = false } = {},
  ) {
    super("Falha na comunicação bancária.");
    this.name = "FalhaDeIntegracaoBancaria";
    this.codigo = codigo;
    this.seguroRepetir = seguroRepetir;
    this.permanente = Boolean(permanente);
    this.retryAfterMs =
      Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? Math.trunc(retryAfterMs)
        : null;
  }
}
