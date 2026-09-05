export interface CepLookupResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * Contrato que qualquer provider externo de CEP precisa implementar.
 * Adicionar um terceiro provider = criar uma classe que implementa essa
 * interface + registrar 1 linha em cep.module.ts (ver CEP_PROVIDERS).
 * Nada em CepService, no controller, nas exceptions HTTP ou no circuit
 * breaker precisa mudar.
 */
export interface CepProvider {
  readonly name: string;
  lookup(cep: string): Promise<CepLookupResult>;
}
