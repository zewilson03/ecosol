export class FalhaDeIntegracaoBancaria extends Error {
  constructor(codigo, { seguroRepetir = false } = {}) {
    super("Falha na comunicação bancária.");
    this.name = "FalhaDeIntegracaoBancaria";
    this.codigo = codigo;
    this.seguroRepetir = seguroRepetir;
  }
}
